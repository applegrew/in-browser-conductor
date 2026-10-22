/**
 * Store abstraction. The engine persists documents in named collections
 * (workflowDefs, taskDefs, workflows, tasks, eventHandlers, queue, meta).
 * Adapters provide the same async CRUD surface; the engine keeps hot state
 * in memory and pushes writes through the adapter.
 *
 * Collections used by the engine:
 *   - workflowDefs      keyed `${name}:${version}`
 *   - taskDefs          keyed `name`
 *   - workflows         keyed `workflowId`
 *   - tasks             keyed `taskId`
 *   - eventHandlers     keyed `name`
 */

export class Store {
  async init() {}
  async reload() {}
  async get() { return undefined; }
  getSync() { return undefined; }
  async put() {}
  async delete() {}
  async list() { return []; }
  async clear() {}
}

/** Shared in-memory map backing that the adapters reuse. */
export function createCollections() {
  return new Map();
}

/** Synchronous in-memory implementation. */
export class MemoryStore extends Store {
  constructor() {
    super();
    this.data = createCollections();
  }

  _coll(name) {
    if (!this.data.has(name)) this.data.set(name, new Map());
    return this.data.get(name);
  }

  async init() {}

  async get(collection, key) {
    return this._coll(collection).get(key);
  }

  getSync(collection, key) {
    return this._coll(collection).get(key);
  }

  async put(collection, key, value) {
    this._coll(collection).set(key, value);
    return value;
  }

  async delete(collection, key) {
    return this._coll(collection).delete(key);
  }

  async list(collection) {
    return Array.from(this._coll(collection).values());
  }

  async clear(collection) {
    if (collection) this._coll(collection).clear();
    else this.data.clear();
  }
}
