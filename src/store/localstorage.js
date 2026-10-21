import { Store, createCollections } from './memory.js';

const DEFAULT_KEY = 'conductor.browser.db.v1';

/**
 * Persists the entire database as a single JSON document in localStorage.
 * Writes are debounced to avoid serialising large datasets on every
 * mutation. In-memory Maps provide fast reads; localStorage is the durable
 * source of truth and survives page reloads.
 */
export class LocalStorageStore extends Store {
  constructor({ storageKey = DEFAULT_KEY, storage = null, debounceMs = 0 } = {}) {
    super();
    this.storageKey = storageKey;
    this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    this.debounceMs = debounceMs;
    this.data = createCollections();
    this._timer = null;
  }

  _coll(name) {
    if (!this.data.has(name)) this.data.set(name, new Map());
    return this.data.get(name);
  }

  async init() {
    await this.reload();
  }

  async reload() {
    if (!this.storage) return;
    const raw = this.storage.getItem(this.storageKey);
    this.data = createCollections();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      for (const [coll, entries] of Object.entries(parsed || {})) {
        const map = new Map(Object.entries(entries));
        this.data.set(coll, map);
      }
    } catch (e) {
      // Corrupt snapshot: start fresh rather than throwing on init.
      console.warn('[in-browser-conductor] failed to read persisted db, starting fresh', e);
    }
  }

  _schedulePersist() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this._persist();
    }, this.debounceMs);
  }

  _persist() {
    if (!this.storage) return;
    const snapshot = {};
    for (const [coll, map] of this.data.entries()) {
      snapshot[coll] = Object.fromEntries(map.entries());
    }
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(snapshot));
    } catch (e) {
      console.warn('[in-browser-conductor] failed to persist db (quota?)', e);
    }
  }

  async get(collection, key) {
    return this._coll(collection).get(key);
  }

  async put(collection, key, value) {
    this._coll(collection).set(key, value);
    if (this.debounceMs > 0) this._schedulePersist();
    else this._persist();
    return value;
  }

  async delete(collection, key) {
    const existed = this._coll(collection).delete(key);
    if (this.debounceMs > 0) this._schedulePersist();
    else this._persist();
    return existed;
  }

  async list(collection) {
    return Array.from(this._coll(collection).values());
  }

  async clear(collection) {
    if (collection) this._coll(collection).clear();
    else this.data.clear();
    this._persist();
  }

  async flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._persist();
  }
}
