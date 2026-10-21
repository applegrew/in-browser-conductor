import { MemoryStore } from './memory.js';
import { LocalStorageStore } from './localstorage.js';
import { SqliteStore } from './sqlite.js';

export { MemoryStore } from './memory.js';
export { LocalStorageStore } from './localstorage.js';
export { SqliteStore } from './sqlite.js';

/**
 * Create a store from a spec. Supported:
 *   - 'memory' / MemoryStore
 *   - 'localstorage' / LocalStorageStore (default)
 *   - 'sqlite' / SqliteStore
 *   - any Store instance (returned as-is)
 */
export function createStore(spec = 'localstorage', options = {}) {
  // Any Store instance (memory, localStorage, sqlite) is passed through.
  if (spec instanceof MemoryStore || spec instanceof LocalStorageStore || spec instanceof SqliteStore) {
    return spec;
  }
  switch (spec) {
    case 'memory':
      return new MemoryStore();
    case 'localstorage':
      return new LocalStorageStore(options);
    case 'sqlite':
      return new SqliteStore(options);
    default:
      throw new Error(`Unknown store: ${spec}`);
  }
}
