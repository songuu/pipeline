import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  GitReferenceType,
  RemoteRepositoryRefs,
  ResolvedRemoteRepository,
  SourceCommit,
  SourceRepository,
  SourceRepositoryProvider,
} from "@deploy-management/shared";
import { CodeReposRepository } from "./code-repos.repository";
import type { RemoteRepositoryRefsDto, ResolveRepositoryDto } from "./dto/remote-repository.dto";

type ParsedRemoteRepository = {
  provider: SourceRepositoryProvider;
  host: string;
  owner: string;
  repo: string;
  projectPath: string;
  cloneUrl: string;
  apiBaseUrl: string;
};

type RemoteRepositoryMetadata = {
  name?: string;
  owner?: string;
  cloneUrl?: string;
  defaultBranch?: string;
};

type RemoteRefsPage = {
  refs: string[];
  hasMore: boolean;
  page: number;
  perPage: number;
};

type RemoteRefsOptions = {
  page?: number;
  perPage?: number;
  search?: string;
  preferredRef?: string;
};

type ResolveCommitInput = {
  url: string;
  provider?: SourceRepositoryProvider;
  accessToken?: string;
  refType: GitReferenceType;
  refName: string;
  commitSha?: string;
};

const REMOTE_PAGE_SIZE = 100;
const MAX_SEARCH_REF_PAGES = 5;

@Injectable()
export class CodeReposService {
  constructor(@Inject(CodeReposRepository) private readonly repo: CodeReposRepository) {}

  list(): SourceRepository[] {
    return this.repo.snapshot();
  }

  get(id: string): SourceRepository {
    const repository = this.repo.snapshot().find((item) => item.id === id);
    if (!repository) {
      throw new NotFoundException(`Repository ${id} not found`);
    }
    return repository;
  }

  assertReference(repository: SourceRepository, refType: GitReferenceType, refName: string): void {
    const refs = refType === "branch" ? repository.branches : repository.tags;
    if (!refs.includes(refName)) {
      throw new BadRequestException(`${repository.name} does not contain ${refType} ${refName}`);
    }
  }

  async resolveRemote(input: ResolveRepositoryDto): Promise<ResolvedRemoteRepository> {
    const parsed = parseRemoteRepository(input.url, input.provider);
    if (!supportsRemoteRefs(parsed.provider)) {
      return {
        provider: parsed.provider,
        repositoryId: repositoryIdFor(parsed),
        name: parsed.repo,
        owner: parsed.owner,
        repo: parsed.repo,
        url: parsed.cloneUrl,
        defaultBranch: "main",
        branches: [],
        tags: [],
        recentCommits: [],
        warnings: [`${parsed.provider} 暂未配置远程 refs adapter，请先手动填写分支或 Tag。`],
      };
    }

    const metadata = await this.fetchRepositoryMetadata(parsed, input.accessToken).catch(() => undefined);
    const branchesPage = await this.fetchRefs(parsed, "branch", input.accessToken, {
      preferredRef: metadata?.defaultBranch,
    });
    const tagsPage = await this.fetchRefs(parsed, "tag", input.accessToken).catch(() => ({
      refs: [],
      hasMore: false,
      page: 1,
      perPage: REMOTE_PAGE_SIZE,
    }));
    const branches = uniqueRefs([metadata?.defaultBranch, ...branchesPage.refs]);
    const tags = tagsPage.refs;
    const defaultBranch = pickDefaultBranch(branches, metadata?.defaultBranch);
    const recentCommits = defaultBranch
      ? await this.fetchRecentCommits(parsed, defaultBranch, input.accessToken).catch(() => [])
      : [];

    return {
      provider: parsed.provider,
      repositoryId: repositoryIdFor(parsed),
      name: metadata?.name ?? parsed.repo,
      owner: metadata?.owner ?? parsed.owner,
      repo: parsed.repo,
      url: metadata?.cloneUrl ?? parsed.cloneUrl,
      defaultBranch,
      branches,
      tags,
      recentCommits,
    };
  }

  async listRemoteRefs(input: RemoteRepositoryRefsDto): Promise<RemoteRepositoryRefs> {
    const parsed = parseRemoteRepository(input.url, input.provider);
    if (!supportsRemoteRefs(parsed.provider)) {
      return {
        provider: parsed.provider,
        repositoryId: repositoryIdFor(parsed),
        name: parsed.repo,
        url: parsed.cloneUrl,
        refType: input.refType,
        refs: [],
        warnings: [`${parsed.provider} 暂未配置远程 refs adapter，请先手动填写 ${input.refType === "branch" ? "分支" : "Tag"}。`],
      };
    }

    const metadata =
      input.refType === "branch"
        ? await this.fetchRepositoryMetadata(parsed, input.accessToken).catch(() => undefined)
        : undefined;
    const refsPage = await this.fetchRefs(parsed, input.refType, input.accessToken, {
      page: input.page,
      perPage: input.perPage,
      search: input.search,
      preferredRef: metadata?.defaultBranch,
    });
    const filtered = input.search ? refsPage.refs.filter((ref) => ref.includes(input.search ?? "")) : refsPage.refs;
    const defaultRef = input.refType === "branch" ? pickDefaultBranch(filtered, metadata?.defaultBranch) : filtered[0];
    const recentCommits =
      input.refType === "branch" && defaultRef
        ? await this.fetchRecentCommits(parsed, defaultRef, input.accessToken).catch(() => [])
        : [];

    return {
      provider: parsed.provider,
      repositoryId: repositoryIdFor(parsed),
      name: metadata?.name ?? parsed.repo,
      url: metadata?.cloneUrl ?? parsed.cloneUrl,
      refType: input.refType,
      refs: filtered,
      defaultRef,
      hasMore: refsPage.hasMore,
      page: refsPage.page,
      perPage: refsPage.perPage,
      recentCommits,
    };
  }

  async resolveCommit(input: ResolveCommitInput): Promise<string> {
    const explicitCommit = input.commitSha?.trim();
    if (explicitCommit) return explicitCommit;

    const parsed = parseRemoteRepository(input.url, input.provider);
    if (!supportsRemoteRefs(parsed.provider)) {
      throw new BadRequestException(`${parsed.provider} 暂不支持运行时解析真实 commit，请在运行参数中固定 commitSha`);
    }

    const token = resolveToken(parsed.provider, input.accessToken);
    requireProviderToken(parsed.provider, token);
    const url = recentCommitsUrl(parsed, input.refName, token);
    if (!url) {
      throw new BadRequestException(`${parsed.provider} 暂不支持解析 ${input.refType} ${input.refName} 的 commit`);
    }
    const payload = await this.fetchJson(url, parsed.provider, token);
    const [commit] = extractCommits(payload);
    if (!commit?.sha) {
      throw new BadRequestException(`无法解析 ${parsed.provider} ${input.refType} ${input.refName} 的真实 commit`);
    }
    return commit.sha;
  }

  private async fetchRefs(
    repository: ParsedRemoteRepository,
    refType: GitReferenceType,
    explicitToken?: string,
    options: RemoteRefsOptions = {},
  ): Promise<RemoteRefsPage> {
    const token = resolveToken(repository.provider, explicitToken);
    requireProviderToken(repository.provider, token);
    const page = options.page ?? 1;
    const perPage = Math.min(options.perPage ?? REMOTE_PAGE_SIZE, REMOTE_PAGE_SIZE);
    const search = options.search?.trim();
    let nextUrl: string | undefined = remoteRefsUrl(repository, refType, token, page, perPage, search);
    const maxPages = search && repository.provider === "github" ? MAX_SEARCH_REF_PAGES : 1;
    const payloads: unknown[] = [];

    for (let pageIndex = 0; nextUrl && pageIndex < maxPages; pageIndex += 1) {
      const { payload, headers } = await this.fetchJsonWithHeaders(nextUrl, repository.provider, token);
      if (Array.isArray(payload)) {
        payloads.push(...payload);
      }
      nextUrl = nextPageUrl(repository.provider, nextUrl, headers, payload);
    }

    return {
      refs: uniqueRefs([options.preferredRef, ...extractNames(payloads)]),
      hasMore: Boolean(nextUrl),
      page,
      perPage,
    };
  }

  private async fetchRecentCommits(
    repository: ParsedRemoteRepository,
    branch: string,
    explicitToken?: string,
  ): Promise<SourceCommit[]> {
    const token = resolveToken(repository.provider, explicitToken);
    requireProviderToken(repository.provider, token);
    const url = recentCommitsUrl(repository, branch, token);
    if (!url) return [];
    const payload = await this.fetchJson(url, repository.provider, token);
    return extractCommits(payload);
  }

  private async fetchRepositoryMetadata(
    repository: ParsedRemoteRepository,
    explicitToken?: string,
  ): Promise<RemoteRepositoryMetadata> {
    const token = resolveToken(repository.provider, explicitToken);
    requireProviderToken(repository.provider, token);
    const url = repositoryMetadataUrl(repository, token);
    if (!url) return {};
    const payload = await this.fetchJson(url, repository.provider, token);
    return extractRepositoryMetadata(payload, repository);
  }

  private async fetchJson(url: string, provider: SourceRepositoryProvider, token?: string): Promise<unknown> {
    const { payload } = await this.fetchJsonWithHeaders(url, provider, token);
    return payload;
  }

  private async fetchJsonWithHeaders(
    url: string,
    provider: SourceRepositoryProvider,
    token?: string,
  ): Promise<{ payload: unknown; headers: Headers }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(url, {
        headers: remoteHeaders(provider, token),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new BadRequestException(
          `无法拉取 ${provider} 仓库数据: HTTP ${response.status}${body ? ` - ${body.slice(0, 180)}` : ""}`,
        );
      }
      return { payload: (await response.json()) as unknown, headers: response.headers };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const message = error instanceof Error ? error.message : "未知错误";
      throw new BadRequestException(`无法连接 ${provider} 仓库接口: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function supportsRemoteRefs(provider: SourceRepositoryProvider): boolean {
  return ["github", "gitlab", "gitcode"].includes(provider);
}

// Exported so unit tests in `remote-url.spec.ts` can exercise the parser
// directly without spinning up the full Nest module graph.
export function parseRemoteRepository(rawUrl: string, explicitProvider?: SourceRepositoryProvider): ParsedRemoteRepository {
  const normalized = rawUrl.trim();
  const sshMatch = normalized.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/);
  const host = sshMatch ? sshMatch[1] : parseHttpHost(normalized);
  const provider = explicitProvider ?? inferProvider(host);
  const rawPath = sshMatch ? sshMatch[2] : parseHttpPath(normalized);
  const pathSegments = normalizeRepositoryPath(host, rawPath);
  if (pathSegments.length < 2) {
    throw new BadRequestException("仓库地址需要包含 owner/repository，例如 https://github.com/org/repo.git");
  }

  const repo = stripGitSuffix(pathSegments[pathSegments.length - 1]);
  const ownerSegments = pathSegments.slice(0, -1);
  const owner = ownerSegments.join("/");
  const projectPath = [...ownerSegments, repo].join("/");
  const protocol = host === "api.gitcode.com" ? "https" : "https";
  const cloneHost = host === "api.gitcode.com" ? "gitcode.com" : host;

  return {
    provider,
    host: cloneHost,
    owner,
    repo,
    projectPath,
    cloneUrl: `${protocol}://${cloneHost}/${projectPath}.git`,
    apiBaseUrl: apiBaseUrlFor(provider, cloneHost),
  };
}

function parseHttpHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).host;
  } catch {
    throw new BadRequestException("仓库地址格式不正确，请填写 HTTPS 或 SSH clone URL");
  }
}

function parseHttpPath(rawUrl: string): string {
  return new URL(rawUrl).pathname;
}

function normalizeRepositoryPath(host: string, rawPath: string): string[] {
  let segments = rawPath
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (host === "api.gitcode.com" && segments[0] === "api" && segments[2] === "repos") {
    segments = segments.slice(3);
  }

  const markerIndex = findRepositoryPathMarkerIndex(segments);
  if (markerIndex >= 0) {
    segments = segments.slice(0, markerIndex);
  }

  if (segments.length > 0) {
    segments[segments.length - 1] = stripGitSuffix(segments[segments.length - 1]);
  }
  return segments;
}

function findRepositoryPathMarkerIndex(segments: string[]): number {
  const markers = new Set(["-", "tree", "blob", "branches", "tags", "commits", "releases"]);
  return segments.findIndex((segment, index) => index >= 2 && markers.has(segment));
}

function stripGitSuffix(value: string): string {
  return decodeURIComponent(value).replace(/\.git$/i, "");
}

function inferProvider(host: string): SourceRepositoryProvider {
  if (host.includes("github.com")) return "github";
  if (host.includes("gitlab")) return "gitlab";
  if (host.includes("gitcode")) return "gitcode";
  if (host.includes("gitea")) return "gitea";
  return "codeup";
}

function apiBaseUrlFor(provider: SourceRepositoryProvider, host: string): string {
  if (provider === "github") return "https://api.github.com";
  if (provider === "gitlab") return `https://${host}/api/v4`;
  if (provider === "gitcode") return "https://api.gitcode.com/api/v5";
  return `https://${host}`;
}

export function repositoryIdFor(repository: ParsedRemoteRepository): string {
  return `${repository.provider}:${repository.projectPath}`;
}

export type { ParsedRemoteRepository };

function repositoryMetadataUrl(repository: ParsedRemoteRepository, token?: string): string | undefined {
  if (repository.provider === "github") {
    return `${repository.apiBaseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
  }
  if (repository.provider === "gitlab") {
    return `${repository.apiBaseUrl}/projects/${encodeURIComponent(repository.projectPath)}`;
  }
  if (repository.provider === "gitcode") {
    return withQuery(
      `${repository.apiBaseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`,
      { access_token: token },
    );
  }
  return undefined;
}

function remoteRefsUrl(
  repository: ParsedRemoteRepository,
  refType: GitReferenceType,
  token?: string,
  page = 1,
  perPage = REMOTE_PAGE_SIZE,
  search?: string,
): string {
  if (repository.provider === "github") {
    return withQuery(
      `${repository.apiBaseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/${refType === "branch" ? "branches" : "tags"}`,
      { per_page: String(perPage), page: String(page) },
    );
  }
  if (repository.provider === "gitlab") {
    const projectId = encodeURIComponent(repository.projectPath);
    return withQuery(
      `${repository.apiBaseUrl}/projects/${projectId}/repository/${refType === "branch" ? "branches" : "tags"}`,
      { per_page: String(perPage), page: String(page), search },
    );
  }
  if (repository.provider === "gitcode") {
    return withQuery(
      `${repository.apiBaseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/${refType === "branch" ? "branches" : "tags"}`,
      { per_page: String(perPage), page: String(page), search, access_token: token },
    );
  }
  throw new BadRequestException(`${repository.provider} 暂不支持远程 refs 拉取`);
}

function recentCommitsUrl(repository: ParsedRemoteRepository, branch: string, token?: string): string | undefined {
  if (repository.provider === "github") {
    return withQuery(`${repository.apiBaseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/commits`, {
      sha: branch,
      per_page: "5",
    });
  }
  if (repository.provider === "gitlab") {
    return withQuery(`${repository.apiBaseUrl}/projects/${encodeURIComponent(repository.projectPath)}/repository/commits`, {
      ref_name: branch,
      per_page: "5",
    });
  }
  if (repository.provider === "gitcode") {
    return withQuery(`${repository.apiBaseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/commits`, {
      sha: branch,
      per_page: "5",
      access_token: token,
    });
  }
  return undefined;
}

function withQuery(baseUrl: string, params: Record<string, string | undefined>): string {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return url.toString();
}

function nextPageUrl(
  provider: SourceRepositoryProvider,
  currentUrl: string,
  headers: Headers,
  payload: unknown,
): string | undefined {
  if (provider === "github") {
    return parseGithubNextUrl(headers.get("link"));
  }

  const url = new URL(currentUrl);
  if (provider === "gitlab") {
    const nextPage = headers.get("x-next-page");
    if (!nextPage) return undefined;
    url.searchParams.set("page", nextPage);
    return url.toString();
  }

  if (provider === "gitcode" && Array.isArray(payload) && payload.length >= Number(url.searchParams.get("per_page") ?? REMOTE_PAGE_SIZE)) {
    const currentPage = Number(url.searchParams.get("page") ?? "1");
    url.searchParams.set("page", String(currentPage + 1));
    return url.toString();
  }

  return undefined;
}

function parseGithubNextUrl(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined;
  const next = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.includes('rel="next"'));
  return next?.match(/<([^>]+)>/)?.[1];
}

function resolveToken(provider: SourceRepositoryProvider, explicitToken?: string): string | undefined {
  const token = explicitToken?.trim();
  if (token) return token;
  if (provider === "github") return process.env.GITHUB_TOKEN?.trim();
  if (provider === "gitlab") return process.env.GITLAB_TOKEN?.trim();
  if (provider === "gitcode") return process.env.GITCODE_TOKEN?.trim();
  return undefined;
}

function requireProviderToken(provider: SourceRepositoryProvider, token?: string): void {
  if (provider !== "gitcode" || token) return;
  throw new BadRequestException("缺少 GitCode 仓库访问令牌：请设置后端环境变量 GITCODE_TOKEN，或在流水线源的访问令牌输入框填写 GitCode 私人令牌。");
}

function remoteHeaders(provider: SourceRepositoryProvider, token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: provider === "github" ? "application/vnd.github+json" : "application/json",
    "User-Agent": "deploy-management-cicd",
  };
  if (provider === "github") headers["X-GitHub-Api-Version"] = "2022-11-28";
  if (!token) return headers;
  if (provider === "github") headers.Authorization = `Bearer ${token}`;
  if (provider === "gitlab") headers["PRIVATE-TOKEN"] = token;
  if (provider === "gitcode") headers["private-token"] = token;
  return headers;
}

function extractNames(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  return Array.from(
    new Set(
      payload
        .map((item) => (isRecord(item) && typeof item.name === "string" ? item.name : ""))
        .filter(Boolean),
    ),
  );
}

function uniqueRefs(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function extractCommits(payload: unknown): SourceCommit[] {
  if (!Array.isArray(payload)) return [];
  return payload.slice(0, 5).flatMap((item) => {
    if (!isRecord(item)) return [];
    const sha = stringFrom(item.sha) ?? stringFrom(recordFrom(item.commit)?.sha);
    if (!sha) return [];
    const commit = recordFrom(item.commit);
    const commitAuthor = recordFrom(commit?.author);
    const author = commitAuthor ?? recordFrom(item.author) ?? recordFrom(item.committer);
    return [
      {
        sha,
        message: stringFrom(commit?.message) ?? stringFrom(item.message) ?? "remote commit",
        author: stringFrom(author?.name) ?? stringFrom(item.author_name) ?? "remote",
        createdAt:
          stringFrom(commitAuthor?.date) ??
          stringFrom(author?.date) ??
          stringFrom(item.committed_date) ??
          stringFrom(item.created_at) ??
          new Date().toISOString(),
      },
    ];
  });
}

function extractRepositoryMetadata(payload: unknown, fallback: ParsedRemoteRepository): RemoteRepositoryMetadata {
  if (!isRecord(payload)) return {};
  const namespace = recordFrom(payload.namespace);
  const owner = stringFrom(recordFrom(payload.owner)?.login) ?? stringFrom(namespace?.full_path) ?? stringFrom(namespace?.path);
  const defaultBranch =
    stringFrom(payload.default_branch) ??
    stringFrom(payload.defaultBranch) ??
    stringFrom(payload.default_branch_name);
  return {
    name: stringFrom(payload.name) ?? stringFrom(payload.path) ?? fallback.repo,
    owner,
    cloneUrl:
      stringFrom(payload.clone_url) ??
      stringFrom(payload.http_url_to_repo) ??
      stringFrom(payload.html_url) ??
      fallback.cloneUrl,
    defaultBranch,
  };
}

function pickDefaultBranch(branches: string[], preferred?: string): string {
  return (
    (preferred && branches.includes(preferred) ? preferred : undefined) ??
    branches.find((branch) => branch === "main") ??
    branches.find((branch) => branch === "master") ??
    branches[0] ??
    preferred ??
    "main"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordFrom(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
