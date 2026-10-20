import { ConductorServer } from './engine/server.js';
import { handleHttpRequest, toFetchResponse } from './api/http.js';
import { ConductorClient } from './client/client.js';
import { ConductorWorker } from './client/worker.js';
import { createStore, MemoryStore, LocalStorageStore, SqliteStore } from './store/index.js';

export { ConductorServer } from './engine/server.js';
export { ConductorClient } from './client/client.js';
export { ConductorWorker } from './client/worker.js';
export { handleHttpRequest, toFetchResponse } from './api/http.js';
export { MemoryStore, LocalStorageStore, SqliteStore, createStore } from './store/index.js';
export { Decider } from './engine/decider.js';
export * as enums from './enums.js';
export { ApplicationException, ConductorError, NotFoundError, BadRequestError, ConflictError } from './errors.js';
export { jsonPath, substitute, buildContext } from './expression.js';

/**
 * Create and initialise a browser Conductor server.
 *
 *   const server = await createServer({ store: 'localstorage' });
 */
export async function createServer({
  store = 'localstorage',
  storeOptions = {},
  logger = null,
  sweeperIntervalMs = 500,
} = {}) {
  const s = createStore(store, storeOptions);
  const server = new ConductorServer({ store: s, logger, sweeperIntervalMs });
  await server.init();
  return server;
}

/**
 * Intercept same-origin `fetch('/api/...')` calls in-process and serve them
 * from the engine. This makes the engine a transparent drop-in for any
 * fetch-based Conductor client, with no network and no service worker —
 * including on `file://`.
 *
 * Returns an uninstall function.
 */
export function patchFetch(server, { basePath = '/api' } = {}) {
  if (typeof window === 'undefined' || typeof window.fetch === 'undefined') return () => {};
  const original = window.fetch;
  const self = window;

  self.fetch = async function (input, init) {
    let url;
    let method;
    let body;
    try {
      url = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(url, self.location ? self.location.href : 'http://localhost');
      const sameOrigin = !self.location || u.origin === self.location.origin;
      const inPath = u.pathname === basePath || u.pathname.startsWith(basePath + '/');
      if (sameOrigin && inPath) {
        method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        body = init && init.body != null ? init.body : undefined;
        if (body != null && typeof body !== 'string') {
          body = typeof body === 'object' ? JSON.stringify(body) : String(body);
        }
        const res = await handleHttpRequest({ method, url: u.href, body }, server, { basePath });
        return toFetchResponse(res);
      }
    } catch (e) {
      /* fall through to native fetch */
    }
    return original.apply(self, arguments);
  };

  return () => {
    self.fetch = original;
  };
}

/**
 * Register a service worker that relays real `/api/*` HTTP requests to the
 * engine on the page. Requires a secure context (https or localhost) and a
 * page that hosts the engine. Returns `{ unregister }`.
 */
export async function registerServiceWorker(server, { swPath = '/sw.js', basePath = '/api' } = {}) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return { unregister: () => {} };

  const onMessage = (event) => {
    const msg = event.data;
    if (msg && msg.type === 'IN_BROWSER_CONDUCTOR_REQUEST' && msg.port) {
      handleHttpRequest(msg.request, server, { basePath })
        .then((res) => msg.port.postMessage({ status: res.status, headers: res.headers, body: res.body }))
        .catch((e) => msg.port.postMessage({ status: e.status || 500, headers: {}, body: JSON.stringify({ message: e.message }) }));
    }
  };
  navigator.serviceWorker.addEventListener('message', onMessage);

  let registration = null;
  try {
    registration = await navigator.serviceWorker.register(swPath);
  } catch (e) {
    /* service worker unavailable (e.g. file://) — patchFetch covers it */
  }

  return {
    registration,
    unregister: () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      if (registration) registration.unregister();
    },
  };
}

/**
 * One-call setup: create the server, patch fetch, and (optionally) register a
 * service worker. Returns `{ server, client, uninstall }`.
 */
export async function install({
  store = 'localstorage',
  storeOptions = {},
  basePath = '/api',
  patchFetch: doPatchFetch = true,
  serviceWorker = false,
  swPath = '/sw.js',
  sweeperIntervalMs = 500,
} = {}) {
  const server = await createServer({ store, storeOptions, sweeperIntervalMs });
  const uninstallers = [];
  if (doPatchFetch) uninstallers.push(patchFetch(server, { basePath }));
  let sw = null;
  if (serviceWorker) sw = await registerServiceWorker(server, { swPath, basePath });

  const client = new ConductorClient({ baseURL: basePath });

  return {
    server,
    client,
    uninstall: () => {
      uninstallers.forEach((fn) => fn && fn());
      if (sw) sw.unregister();
    },
  };
}

export default {
  createServer,
  install,
  patchFetch,
  registerServiceWorker,
  ConductorServer,
  ConductorClient,
  ConductorWorker,
  createStore,
  MemoryStore,
  LocalStorageStore,
  SqliteStore,
};
