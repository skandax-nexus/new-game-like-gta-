import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

function gitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'nogit';
  }
}

export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    define: {
      __BUILD_VERSION__: JSON.stringify(`${pkg.version}+${gitHash()}`),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    plugins: single ? [viteSingleFile()] : [],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2022',
      sourcemap: !single,
      chunkSizeWarningLimit: 2500,
      assetsInlineLimit: single ? 100_000_000 : 4096,
      rollupOptions: single
        ? {}
        : {
            output: {
              manualChunks(id: string): string | undefined {
                if (id.includes('node_modules/three')) return 'three';
                return undefined;
              },
            },
          },
    },
    server: { host: true },
    preview: { host: '127.0.0.1' },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
      testTimeout: 30_000,
      pool: 'threads',
    },
  };
});
