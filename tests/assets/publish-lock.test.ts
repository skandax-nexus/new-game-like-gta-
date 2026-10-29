/**
 * Publish concurrency (TA-07 A1). OWNER: Technical Artist G (TA-07).
 *
 * Runs the real runner (tools/assets/build.mjs --republish) in a sandbox (path overrides from
 * tools/assets/config.mjs) for two different pipeline-test ids at the same time, with the critical
 * section widened by SAMRAJYA_PUBLISH_LOCK_HOLD_MS so the runs overlap. Before the lock, each run rewrote
 * published.json from its own start-of-run snapshot and the slower one dropped the other's entry.
 * Also covers the STUDIO.md W3 convention (`flock .publish.lock npm run assets -- ...`) mixed with plain
 * runs, and stale-lock recovery.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(__dirname, '..', '..');
const BUILD = path.join(ROOT, 'tools', 'assets', 'build.mjs');
const HAS_FLOCK = spawnSync('flock', ['--version']).status === 0;

let box = '';
const env = (): NodeJS.ProcessEnv => ({
  ...process.env,
  SAMRAJYA_ASSETS_SCRIPTS: path.join(box, 'scripts'),
  SAMRAJYA_ASSETS_CACHE: path.join(box, 'cache'),
  SAMRAJYA_ASSETS_PUBLIC: path.join(box, 'public'),
  SAMRAJYA_ASSETS_RECORD: path.join(box, 'published.json'),
  SAMRAJYA_ASSETS_MANIFEST: path.join(box, 'manifest.ts'),
  SAMRAJYA_PUBLISH_LOCK_HOLD_MS: '1200',
});
const lockPath = (): string => path.join(box, 'cache', '.publish.lock');

interface Run {
  code: number;
  out: string;
}

function run(args: string[], wrapFlock = false): Promise<Run> {
  return new Promise((resolve) => {
    const cmd = wrapFlock ? 'flock' : process.execPath;
    const argv = wrapFlock ? [lockPath(), process.execPath, BUILD, ...args] : [BUILD, ...args];
    const child = spawn(cmd, argv, { cwd: ROOT, env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}

async function makeAsset(id: string, rgb: [number, number, number]): Promise<void> {
  fs.writeFileSync(
    path.join(box, 'scripts', 'pipeline_test', `${id}.py`),
    `"""\n@asset ${id}\n@kind image\n\nPublish-lock test image (never built by Blender: the test seeds its cache).\n"""\n`,
  );
  const dir = path.join(box, 'cache', id);
  fs.mkdirSync(dir, { recursive: true });
  await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .png()
    .toFile(path.join(dir, 'image.png'));
  fs.writeFileSync(
    path.join(dir, 'asset.json'),
    JSON.stringify({
      schema: 1,
      id,
      kind: 'image',
      category: 'pipeline_test',
      draft: false,
      blender: 'test',
      files: [{ role: 'image', path: 'image.png' }],
      image: { description: `lock test ${id}`, usage: 'test', alpha: false, tierPx: { ultra: 64, high: 32, mobile: 16 } },
    }),
  );
}

function record(): { assets: Record<string, unknown> } {
  return JSON.parse(fs.readFileSync(path.join(box, 'published.json'), 'utf8')) as { assets: Record<string, unknown> };
}

function reset(): void {
  for (const p of ['published.json', 'manifest.ts']) fs.rmSync(path.join(box, p), { force: true });
  fs.rmSync(path.join(box, 'public'), { recursive: true, force: true });
  fs.rmSync(lockPath(), { force: true });
}

beforeAll(async () => {
  box = fs.mkdtempSync(path.join(os.tmpdir(), 'samrajya-publock-'));
  fs.mkdirSync(path.join(box, 'scripts', 'pipeline_test'), { recursive: true });
  await makeAsset('lock_test_a', [200, 80, 40]);
  await makeAsset('lock_test_b', [40, 80, 200]);
  await makeAsset('lock_test_c', [80, 200, 40]);
});

afterAll(() => {
  if (box) fs.rmSync(box, { recursive: true, force: true });
});

describe('publish lock', () => {
  it('two concurrent publish runs keep both entries (record + manifest)', async () => {
    reset();
    const [a, b] = await Promise.all([run(['--republish', 'lock_test_a']), run(['--republish', 'lock_test_b'])]);
    expect(a.code, a.out).toBe(0);
    expect(b.code, b.out).toBe(0);
    // The runs really overlapped: one of them had to wait for the other's critical section.
    expect(`${a.out}\n${b.out}`).toMatch(/waited [\d.]+ s|waiting for the publish lock/);
    const rec = record();
    expect(Object.keys(rec.assets).sort()).toEqual(['lock_test_a', 'lock_test_b']);
    const manifest = fs.readFileSync(path.join(box, 'manifest.ts'), 'utf8');
    expect(manifest).toContain('"lock_test_a"');
    expect(manifest).toContain('"lock_test_b"');
    expect(manifest).toContain('export type ImageAssetId');
    expect(fs.existsSync(lockPath())).toBe(false);
  }, 60_000);

  it.runIf(HAS_FLOCK)('flock(1)-wrapped runs (STUDIO W3) mixed with plain runs neither deadlock nor lose entries', async () => {
    reset();
    const runs = await Promise.all([
      run(['--republish', 'lock_test_a'], true),
      run(['--republish', 'lock_test_b']),
      run(['--republish', 'lock_test_c'], true),
    ]);
    for (const r of runs) expect(r.code, r.out).toBe(0);
    expect(runs.map((r) => r.out).join('\n')).toMatch(/publish lock acquired \((flock-outer|flock-helper|excl)/);
    expect(Object.keys(record().assets).sort()).toEqual(['lock_test_a', 'lock_test_b', 'lock_test_c']);
    const manifest = fs.readFileSync(path.join(box, 'manifest.ts'), 'utf8');
    for (const id of ['lock_test_a', 'lock_test_b', 'lock_test_c']) expect(manifest).toContain(`"${id}"`);
    // flock(1) leaves its (now empty) sentinel file behind; our record is gone either way.
    const left = fs.existsSync(lockPath()) ? fs.readFileSync(lockPath(), 'utf8') : '';
    expect(left).toBe('');
  }, 90_000);

  it('recovers a stale lock left by a dead process', async () => {
    reset();
    fs.mkdirSync(path.dirname(lockPath()), { recursive: true });
    fs.writeFileSync(lockPath(), JSON.stringify({ pid: 999_999_9, host: os.hostname(), startedAt: Date.now() - 5000, nonce: 'dead', ids: 'crashed' }));
    const r = await run(['--republish', 'lock_test_a']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('removing stale publish lock');
    expect(Object.keys(record().assets)).toEqual(['lock_test_a']);
  }, 60_000);

  it('--check stays lock-free (runs while the lock is held)', async () => {
    fs.writeFileSync(lockPath(), JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: Date.now(), nonce: 'held', ids: 'test' }));
    try {
      const r = await run(['--check']);
      expect(r.out).not.toContain('waiting for the publish lock');
      expect(r.code, r.out).toBe(0);
    } finally {
      fs.rmSync(lockPath(), { force: true });
    }
  }, 60_000);
});
