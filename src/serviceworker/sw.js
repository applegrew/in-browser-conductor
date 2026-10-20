/**
 * Service worker: relays `/api/*` requests to the in-browser Conductor engine
 * running on the controlling page. Register with `registerServiceWorker(...)`
 * (or manually) so that any HTTP client in the same origin — including
 * workers and other tabs — can reach the engine.
 */

const MESSAGE_TYPE = 'IN_BROWSER_CONDUCTOR_REQUEST';
const API_PREFIX = '/api/';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(API_PREFIX)) return;
  event.respondWith(relay(event.request, event.clientId));
});

async function relay(request, clientId) {
  try {
    let client = clientId ? await self.clients.get(clientId) : null;
    if (!client) {
      const all = await self.clients.matchAll({ type: 'window' });
      client = all[0];
    }
    if (!client) {
      return respond(503, { message: 'Conductor engine not reachable (no client window)' });
    }

    const method = request.method;
    const headers = {};
    if (request.headers) request.headers.forEach((v, k) => (headers[k] = v));
    let body = null;
    if (method !== 'GET' && method !== 'HEAD') body = await request.text();

    const response = await new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => resolve(e.data);
      client.postMessage(
        { type: MESSAGE_TYPE, request: { method, url: request.url, body, headers } },
        [channel.port2]
      );
    });

    return new Response(response.body != null ? response.body : null, {
      status: response.status || 200,
      headers: response.headers || {},
    });
  } catch (e) {
    return respond(500, { message: e && e.message ? e.message : String(e) });
  }
}

function respond(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
