/**
 * 内存版 Repository<T>。仅在本 sprint 作为持久层占位，
 * 后续可替换为 Prisma/TypeORM 实现而不动业务层代码。
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

  constructor(initial: T[] = []) {
    this.items = [...initial];
  }

  async list(): Promise<T[]> {
    return [...this.items];
  }

  async findById(id: string): Promise<T | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  async create(entity: T): Promise<T> {
    this.items = [...this.items, entity];
    return entity;
  }

  async prepend(entity: T): Promise<T> {
    this.items = [entity, ...this.items];
    return entity;
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error(`Entity ${id} not found`);
    }
    const merged = { ...this.items[index], ...patch } as T;
    this.items = this.items.map((item, i) => (i === index ? merged : item));
    return merged;
  }

  async delete(id: string): Promise<void> {
    this.items = this.items.filter((item) => item.id !== id);
  }

  seed(items: T[]): void {
    this.items = [...items];
  }

  snapshot(): T[] {
    return [...this.items];
  }
}
