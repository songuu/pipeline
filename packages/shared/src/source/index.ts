import type { GitReferenceType, SourceCommit, SourceRepositoryProvider } from "../platform";

export type ResolveRepositoryRequest = {
  url: string;
  provider?: SourceRepositoryProvider;
  accessToken?: string;
};

export type RemoteRepositoryRefRequest = ResolveRepositoryRequest & {
  refType: GitReferenceType;
  search?: string;
  page?: number;
  perPage?: number;
};

export type RemoteRepositoryRefs = {
  provider: SourceRepositoryProvider;
  repositoryId: string;
  name: string;
  url: string;
  refType: GitReferenceType;
  refs: string[];
  defaultRef?: string;
  hasMore?: boolean;
  page?: number;
  perPage?: number;
  recentCommits?: SourceCommit[];
  warnings?: string[];
};

export type ResolvedRemoteRepository = {
  provider: SourceRepositoryProvider;
  repositoryId: string;
  name: string;
  owner: string;
  repo: string;
  url: string;
  defaultBranch: string;
  branches: string[];
  tags: string[];
  recentCommits: SourceCommit[];
  warnings?: string[];
};

