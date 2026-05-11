"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryRepository = void 0;
class InMemoryRepository {
    items = [];
    constructor(initial = []) {
        this.items = [...initial];
    }
    async list() {
        return [...this.items];
    }
    async findById(id) {
        return this.items.find((item) => item.id === id) ?? null;
    }
    async create(entity) {
        this.items = [...this.items, entity];
        return entity;
    }
    async prepend(entity) {
        this.items = [entity, ...this.items];
        return entity;
    }
    async update(id, patch) {
        const index = this.items.findIndex((item) => item.id === id);
        if (index === -1) {
            throw new Error(`Entity ${id} not found`);
        }
        const merged = { ...this.items[index], ...patch };
        this.items = this.items.map((item, i) => (i === index ? merged : item));
        return merged;
    }
    async delete(id) {
        this.items = this.items.filter((item) => item.id !== id);
    }
    seed(items) {
        this.items = [...items];
    }
    snapshot() {
        return [...this.items];
    }
}
exports.InMemoryRepository = InMemoryRepository;
//# sourceMappingURL=in-memory.repository.js.map