/**
 * Load the TypeScript audio modules in node through Vite's SSR module loader (Vite is a direct
 * devDependency; no extra tooling). OWNER: Audio Developer (AUD-01).
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Returns { mod, close }: `mod` is the loaded module namespace, `close()` shuts the Vite server down. */
export async function loadTs(rel) {
  const server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const mod = await server.ssrLoadModule(rel.startsWith('/') ? rel : `/${rel}`);
  return { mod, close: () => server.close() };
}
