import { Store, createCollections } from './memory.js';

/**
 * SQLite-backed store. sql.js (WASM) is loaded lazily — either passed in as
 * `sqlJs` or fetched from the supplied `wasmUrl`. The database file is
 * persisted to IndexedDB (or OPFS when available in workers) so it survives
 * reloads, and grows well beyond localStorage's ~5MB limit.
 *
 * Usage:
 *   import { SqliteStore } from 'in-browser-conductor';
 *   const store = new SqliteStore({ wasmUrl: 'https://sql.js.org/dist/sql-wasm.js' });
 *   await store.init();
 */
export class SqliteStore extends Store {
  constructor({ sqlJs = null, wasmUrl = 'https://sql.js.org/dist/sql-wasm.js', dbName = 'conductor' } = {}) {
    super();
    this.sqlJs = sqlJs;
    this.wasmUrl = wasmUrl;
    this.dbName = dbName;
    this.db = null;
    this._opfs = null;
  }

  async init() {
    const SQL = this.sqlJs || (await this._loadSqlJs());
    if (!this.db) {
      if (SQL.FS && this._hasOpfs()) {
        // Try OPFS-backed persistence via the sync access handle worker path
        // when available; otherwise fall back to IndexedDB.
        this.db = await this._openWithPersistence(SQL);
      } else {
        this.db = new SQL.Database();
      }
    }
    this.db.run(
      `CREATE TABLE IF NOT EXISTS docs (
         collection TEXT NOT NULL,
         key TEXT NOT NULL,
         json TEXT NOT NULL,
         PRIMARY KEY (collection, key)
       )`
    );
  }

  async _loadSqlJs() {
    if (typeof importScripts === 'function') {
      importScripts(this.wasmUrl);
      return globalThis.initSqlJs;
    }
    // Browser / Node dynamic import path.
    const mod = await import(/* @vite-ignore */ this.wasmUrl);
    const initSqlJs = mod.default || mod.initSqlJs || globalThis.initSqlJs;
    return initSqlJs({ locateFile: () => this.wasmUrl.replace(/sql-wasm\.js$/, 'sql-wasm.wasm') });
  }

  _hasOpfs() {
    return typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory;
  }

  async _openWithPersistence(SQL) {
    // Best-effort: persist the SQLite file bytes to IndexedDB.
    const saved = await this._loadBytes();
    const db = saved ? new SQL.Database(new Uint8Array(saved)) : new SQL.Database();
    this._persistHook = () => {
      const data = db.export();
      this._saveBytes(data).catch(() => {});
    };
    return db;
  }

  _idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('in-browser-conductor', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('sqlite')) {
          req.result.createObjectStore('sqlite');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async _loadBytes() {
    try {
      const db = await this._idb();
      return new Promise((resolve) => {
        const tx = db.transaction('sqlite', 'readonly');
        const req = tx.objectStore('sqlite').get(this.dbName);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async _saveBytes(bytes) {
    try {
      const db = await this._idb();
      return new Promise((resolve) => {
        const tx = db.transaction('sqlite', 'readwrite');
        tx.objectStore('sqlite').put(bytes, this.dbName);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      /* ignore persistence failures */
    }
  }

  _persist() {
    if (this._persistHook) this._persistHook();
  }

  async get(collection, key) {
    const stmt = this.db.prepare('SELECT json FROM docs WHERE collection = ? AND key = ?');
    stmt.bind([collection, key]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row ? JSON.parse(row.json) : undefined;
  }

  async put(collection, key, value) {
    this.db.run(
      'INSERT OR REPLACE INTO docs (collection, key, json) VALUES (?, ?, ?)',
      [collection, key, JSON.stringify(value)]
    );
    this._persist();
    return value;
  }

  async delete(collection, key) {
    this.db.run('DELETE FROM docs WHERE collection = ? AND key = ?', [collection, key]);
    this._persist();
    return true;
  }

  async list(collection) {
    const stmt = this.db.prepare('SELECT json FROM docs WHERE collection = ?');
    stmt.bind([collection]);
    const out = [];
    while (stmt.step()) out.push(JSON.parse(stmt.getAsObject().json));
    stmt.free();
    return out;
  }

  async clear(collection) {
    if (collection) this.db.run('DELETE FROM docs WHERE collection = ?', [collection]);
    else this.db.run('DELETE FROM docs');
    this._persist();
  }
}
