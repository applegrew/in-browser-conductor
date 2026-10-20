import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Map a URL path to a filesystem path relative to the repo root.
 *   /                 -> demo/index.html
 *   /cossb(/...)      -> cossb/... (directory -> index.html, SPA fallback)
 *   /vendor/*, /samples.js, /demo.js -> demo assets (demo uses relative paths)
 *   /demo/..., /dist/ -> as-is
 */
function mapPath(pathname) {
  if (pathname === '/' || pathname === '') return '/demo/index.html';
  if (pathname === '/cossb') return '/cossb/index.html';
  if (pathname.startsWith('/cossb/')) return pathname;
  if (pathname.startsWith('/vendor/')) return '/demo' + pathname;
  if (pathname === '/samples.js' || pathname === '/demo.js') return '/demo' + pathname;
  if (pathname.startsWith('/dist/')) return pathname;
  if (pathname === '/demo' || pathname.startsWith('/demo/')) return pathname;
  // Unknown path: fall back to the demo.
  return '/demo/index.html';
}

async function tryServe(file) {
  const full = normalize(join(root, file));
  if (!full.startsWith(root + '/') && full !== root) {
    return { status: 403, body: 'Forbidden', type: 'text/plain' };
  }
  try {
    let data = await readFile(full);
    return { status: 200, body: data, type: MIME[extname(full)] || 'application/octet-stream' };
  } catch (e) {
    if (e.code === 'EISDIR') {
      return tryServe(file.replace(/\/?$/, '/index.html'));
    }
    return null; // ENOENT etc.
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    let mapped = mapPath(pathname);

    let result = await tryServe(mapped);

    // SPA fallback: unknown /cossb/* paths (e.g. /cossb/workflow/{id}) -> shell.
    if (!result && mapped.startsWith('/cossb/')) {
      result = await tryServe('/cossb/index.html');
    }

    if (!result) {
      result = { status: 404, body: 'Not found', type: 'text/plain' };
    }

    res.writeHead(result.status, {
      'Content-Type': result.type,
      'Cache-Control': 'no-cache',
    });
    res.end(result.body);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error: ' + e.message);
  }
});

server.listen(port, () => {
  console.log('');
  console.log('  In-Browser Conductor');
  console.log('  ────────────────────');
  console.log(`  Demo (getting started):  http://localhost:${port}/`);
  console.log(`  Control plane:           http://localhost:${port}/cossb/executions`);
  console.log('');
});
