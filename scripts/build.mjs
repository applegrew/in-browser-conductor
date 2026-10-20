import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { cpSync, mkdirSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const shared = {
  bundle: true,
  sourcemap: true,
  target: ['es2020'],
  logLevel: 'info',
};

await Promise.all([
  // IIFE bundle for `<script src>` usage in any static page.
  build({
    ...shared,
    entryPoints: [resolve(root, 'src/index.js')],
    outfile: resolve(root, 'dist/in-browser-conductor.js'),
    format: 'iife',
    globalName: 'InBrowserConductor',
  }),
  // ESM bundle for module consumers.
  build({
    ...shared,
    entryPoints: [resolve(root, 'src/index.js')],
    outfile: resolve(root, 'dist/in-browser-conductor.esm.js'),
    format: 'esm',
  }),
  // Service worker bundle.
  build({
    ...shared,
    entryPoints: [resolve(root, 'src/serviceworker/sw.js')],
    outfile: resolve(root, 'dist/sw.js'),
    format: 'iife',
  }),
  // Node-friendly ESM (for tests / server-side tooling).
  build({
    ...shared,
    entryPoints: [resolve(root, 'src/index.js')],
    outfile: resolve(root, 'dist/in-browser-conductor.cjs'),
    format: 'cjs',
    platform: 'node',
  }),
]);

console.log('Build complete: dist/');

// Make the demo fully self-contained by vendoring the bundles into demo/.
const vendor = resolve(root, 'demo/vendor');
mkdirSync(vendor, { recursive: true });
cpSync(resolve(root, 'dist/in-browser-conductor.js'), resolve(vendor, 'in-browser-conductor.js'));
cpSync(resolve(root, 'dist/sw.js'), resolve(vendor, 'sw.js'));
console.log('Vendored into demo/vendor/');

// Vendor the bundle into the control-plane console (cossb/).
const consoleVendor = resolve(root, 'cossb/vendor');
mkdirSync(consoleVendor, { recursive: true });
cpSync(resolve(root, 'dist/in-browser-conductor.js'), resolve(consoleVendor, 'in-browser-conductor.js'));
cpSync(resolve(root, 'dist/sw.js'), resolve(consoleVendor, 'sw.js'));
console.log('Vendored into cossb/vendor/');

// The control plane is served from /cossb/<route>. Copy the SPA shell into each
// fixed route directory so it works with *any* static server (no SPA fallback
// needed for the top-level routes).
for (const route of ['executions', 'workflows', 'tasks', 'queues']) {
  const dir = resolve(root, 'cossb', route);
  mkdirSync(dir, { recursive: true });
  cpSync(resolve(root, 'cossb/index.html'), resolve(dir, 'index.html'));
}
console.log('Generated /cossb/{executions,workflows,tasks,queues}/index.html shims');

// Copy TypeScript declarations.
cpSync(resolve(root, 'types/index.d.ts'), resolve(root, 'dist/index.d.ts'));
