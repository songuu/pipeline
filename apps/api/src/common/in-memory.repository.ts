import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Repository<T> 的持久化 facade。类名保留为 InMemoryRepository 是为了
 * 不扩大迁移面；默认落盘到 DEPLOYMENT_DATA_DIR，设置
 * DEPLOYMENT_STORAGE=supabase 后会改用 Supabase 领域表。
 */
export interface Repository<T extends { id: string }> {
  list(): Promise<T[]>;
  findById(id: string): Promise<T | null>;
  create(entity: T): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
  /** Replace the entire dataset; useful for seed loading. */
  seed(items: T[]): void;
  /** Snapshot of all entities (synchronous, for read aggregations). */
  snapshot(): T[];
  /** Insert at the head; preserves "newest first" ordering for run/audit lists. */
  prepend(entity: T): Promise<T>;
}

export class InMemoryRepository<T extends { id: string }> implements Repository<T> {
  private items: T[] = [];
  private readonly store?: RepositoryStore<T>;
  private hydrated = true;
  private hydratePromise?: Promise<void>;

  constructor(initial: T[] = [], collectionName?: string) {
    this.store = collectionName ? createRepositoryStore<T>(collectionName) : undefined;
    this.items = [...initial];
    if (this.store?.loadSync) {
      this.items = this.store.loadSync(initial);
    } else if (this.store) {
      this.hydrated = false;
    }
  }

  async onModuleInit(): Promise<void> {
    await this.ensureHydrated();
  }

  async list(): Promise<T[]> {
    await this.ensureHydrated();
    return [...this.items];
  }

  async findById(id: string): Promise<T | null> {
    await this.ensureHydrated();
    return this.items.find((item) => item.id === id) ?? null;
  }

  async create(entity: T): Promise<T> {
    await this.ensureHydrated();
    this.items = [...this.items, entity];
    await this.persist();
    return entity;
  }

  async prepend(entity: T): Promise<T> {
    await this.ensureHydrated();
    this.items = [entity, ...this.items];
    await this.persist();
    return entity;
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    await this.ensureHydrated();
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error(`Entity ${id} not found`);
    }
    const merged = { ...this.items[index], ...patch } as T;
    this.items = this.items.map((item, i) => (i === index ? merged : item));
    await this.persist();
    return merged;
  }

  async delete(id: string): Promise<void> {
    await this.ensureHydrated();
    this.items = this.items.filter((item) => item.id !== id);
    await this.persist();
  }

  seed(items: T[]): void {
    this.items = [...items];
    void this.persist();
  }

  snapshot(): T[] {
    return [...this.items];
  }

  private async ensureHydrated(): Promise<void> {
    if (this.hydrated || !this.store?.load) return;
    this.hydratePromise ??= this.store
      .load(this.items)
      .then((items) => {
        this.items = items;
        this.hydrated = true;
      })
      .catch((error) => {
        this.hydratePromise = undefined;
        throw error;
      });
    await this.hydratePromise;
  }

  private async persist(): Promise<void> {
    await this.store?.save(this.items);
  }
}

export type DeploymentStorageCollection = {
  collection: string;
  tableName: string;
  description: string;
};

export const DEPLOYMENT_STORAGE_COLLECTIONS: readonly DeploymentStorageCollection[] = [
  { collection: "applications", tableName: "dm_applications", description: "应用、负责人和默认仓库关系" },
  { collection: "code-repositories", tableName: "dm_source_repositories", description: "代码仓库、provider、分支和 tag 缓存" },
  { collection: "pipelines", tableName: "dm_pipelines", description: "流水线定义、阶段、变量、构建和镜像配置" },
  { collection: "runs", tableName: "dm_pipeline_runs", description: "PipelineRun 主记录和阶段状态快照" },
  { collection: "run-events", tableName: "dm_run_events", description: "运行事件、命令流、日志和执行器状态回写" },
  { collection: "artifacts", tableName: "dm_artifacts", description: "镜像、包、SBOM、provenance 等制品" },
  { collection: "releases", tableName: "dm_releases", description: "上线部署主记录和当前灰度流量" },
  { collection: "deployment-targets", tableName: "dm_deployment_targets", description: "环境部署目标、namespace、workload 和健康检查配置" },
  { collection: "environment-locks", tableName: "dm_environment_locks", description: "同应用同环境的上线锁" },
  { collection: "release-plans", tableName: "dm_release_plans", description: "制品上线计划和灰度策略" },
  { collection: "release-executions", tableName: "dm_release_executions", description: "上线执行、步骤和回滚锚点" },
  { collection: "release-events", tableName: "dm_release_events", description: "灰度推进、暂停、恢复、全量、回滚事件流" },
  { collection: "approvals", tableName: "dm_approvals", description: "审批请求与决策" },
  { collection: "audit-events", tableName: "dm_audit_events", description: "控制面审计事件" },
  { collection: "environments", tableName: "dm_environments", description: "部署环境状态、当前版本和活跃锁" },
  { collection: "runner-pools", tableName: "dm_runner_pools", description: "执行池容量与队列状态" },
] as const;

export function deploymentStorageCollections(): DeploymentStorageCollection[] {
  return [...DEPLOYMENT_STORAGE_COLLECTIONS];
}

export function supabaseStorageTargetForCollection(collectionName: string): DeploymentStorageCollection {
  const target = DEPLOYMENT_STORAGE_COLLECTIONS.find((item) => item.collection === collectionName);
  if (!target) {
    throw new Error(
      `Supabase storage collection ${collectionName} is not mapped to a domain table. ` +
        "Add it to DEPLOYMENT_STORAGE_COLLECTIONS and the Supabase domain-table migration first.",
    );
  }
  return target;
}

interface RepositoryStore<T extends { id: string }> {
  loadSync?: (seed: T[]) => T[];
  load?: (seed: T[]) => Promise<T[]>;
  save: (items: T[]) => void | Promise<void>;
}

function createRepositoryStore<T extends { id: string }>(collectionName: string): RepositoryStore<T> {
  if (process.env.DEPLOYMENT_STORAGE === "supabase") {
    return new SupabaseRepositoryStore<T>(supabaseStorageTargetForCollection(collectionName));
  }
  return new JsonRepositoryStore<T>(collectionName);
}

class JsonRepositoryStore<T extends { id: string }> implements RepositoryStore<T> {
  private readonly filePath: string;

  constructor(collectionName: string) {
    this.filePath = path.join(repositoryDataDir(), `${safeFileName(collectionName)}.json`);
  }

  loadSync(seed: T[]): T[] {
    if (!existsSync(this.filePath)) {
      if (seed.length > 0) this.save(seed);
      return [...seed];
    }

    const raw = readFileSync(this.filePath, "utf8");
    if (!raw.trim()) return [...seed];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`Repository data file must contain an array: ${this.filePath}`);
    }
    return parsed as T[];
  }

  save(items: T[]): void {
    const dir = path.dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = `${JSON.stringify(items, null, 2)}\n`;
    writeFileSync(tmpPath, payload, "utf8");
    try {
      renameSync(tmpPath, this.filePath);
    } catch (error) {
      if (!isWindowsAtomicRenameError(error)) throw error;
      writeFileSync(this.filePath, payload, "utf8");
      try {
        rmSync(tmpPath, { force: true });
      } catch {
        // Windows dev sandboxes can deny temp-file cleanup; the committed JSON is already written.
      }
    }
  }
}

class SupabaseRepositoryStore<T extends { id: string }> implements RepositoryStore<T> {
  private readonly collectionName: string;
  private readonly tableName: string;
  private readonly restUrl: string;
  private readonly rpcUrl: string;
  private readonly headers: Record<string, string>;

  constructor(target: DeploymentStorageCollection) {
    this.collectionName = target.collection;
    this.tableName = target.tableName;
    const baseUrl = requiredEnv("SUPABASE_URL").replace(/\/+$/, "");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const schema = process.env.SUPABASE_SCHEMA ?? "public";
    this.restUrl = `${baseUrl}/rest/v1/${target.tableName}`;
    this.rpcUrl = `${baseUrl}/rest/v1/rpc/replace_dm_records`;
    this.headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Profile": schema,
      "Content-Profile": schema,
    };
  }

  async load(seed: T[]): Promise<T[]> {
    const url = `${this.restUrl}?select=payload&order=sort_order.asc`;
    const response = await fetch(url, { headers: this.headers });
    if (!response.ok) {
      throw new Error(`Supabase load ${this.collectionName} from ${this.tableName} failed: ${response.status} ${await readResponseText(response)}`);
    }
    const rows = (await response.json()) as Array<{ payload: T }>;
    if (rows.length === 0 && seed.length > 0) {
      await this.save(seed);
      return [...seed];
    }
    return rows.map((row) => row.payload);
  }

  async save(items: T[]): Promise<void> {
    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        p_table: this.tableName,
        p_records: items,
      }),
    });
    if (!response.ok) {
      throw new Error(`Supabase save ${this.collectionName} to ${this.tableName} failed: ${response.status} ${await readResponseText(response)}`);
    }
  }
}

function repositoryDataDir(): string {
  return path.resolve(process.env.DEPLOYMENT_DATA_DIR ?? path.join(process.cwd(), ".deploy-data"));
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function isWindowsAtomicRenameError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPERM" || code === "EACCES";
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required when DEPLOYMENT_STORAGE=supabase`);
  }
  return value;
}

async function readResponseText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text || response.statusText;
}
