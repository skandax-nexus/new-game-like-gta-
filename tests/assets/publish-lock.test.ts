/**
 * Publish concurrency (TA-07 A1). OWNER: Technical Artist G (TA-07).
 *
 * Runs the real runner (tools/assets/build.mjs --republish) in a sandbox (path overrides from
 * tools/assets/config.mjs) for two different pipeline-test ids at the same time, with the critical
 * section widened by SAMRAJYA_PUBLISH_LOCK_HOLD_MS so the runs overlap. Before the lock, each run rewrote
 * published.json from its own start-of-run snapshot and the slower one dropped the other's entry.
 * Also covers the STUDIO.md W3 convention (`flock .publish.lock npm run assets -- ...`) mixed with plain
 * runs, stale-lock recovery, and the two races found in the CTO review (rework round 1):
 *   - double acquire: the old O_EXCL create left the lock path EMPTY until the record was written, and an empty
 *     file with no flock holder reads as a free flock(1) sentinel -> a second runner took it too. The record is
 *     now hard-linked into place; the test stalls right after the lock path appears (SAMRAJYA_PUBLISH_LOCK_TEST_
 *     PAUSE_MS=create:...) while other runners poll it.
 *   - stale break: read / compare / unlink was not atomic, so two waiters breaking the same stale record could
 *     delete the fresh lock one of them had just created. The test stalls inside the break (break:...).
 * Every critical section is traced (SAMRAJYA_PUBLISH_LOCK_TRACE): sections must strictly alternate enter/exit.
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
const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  SAMRAJYA_ASSETS_SCRIPTS: path.join(box, 'scripts'),
  SAMRAJYA_ASSETS_CACHE: path.join(box, 'cache'),
  SAMRAJYA_ASSETS_PUBLIC: path.join(box, 'public'),
  SAMRAJYA_ASSETS_RECORD: path.join(box, 'published.json'),
  SAMRAJYA_ASSETS_MANIFEST: path.join(box, 'manifest.ts'),
  SAMRAJYA_PUBLISH_LOCK_HOLD_MS: '1200',
  SAMRAJYA_PUBLISH_LOCK_TRACE: tracePath(),
  ...extra,
});
const lockPath = (): string => path.join(box, 'cache', '.publish.lock');
const tracePath = (): string => path.join(box, 'lock-trace.txt');

interface Run {
  code: number;
  out: string;
}

function run(args: string[], wrapFlock = false, extra: NodeJS.ProcessEnv = {}): Promise<Run> {
  return new Promise((resolve) => {
    const cmd = wrapFlock ? 'flock' : process.execPath;
    const argv = wrapFlock ? [lockPath(), process.execPath, BUILD, ...args] : [BUILD, ...args];
    const child = spawn(cmd, argv, { cwd: ROOT, env: env(extra), stdio: ['ignore', 'pipe', 'pipe'] });
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
  for (const p of ['published.json', 'manifest.ts', 'lock-trace.txt']) fs.rmSync(path.join(box, p), { force: true });
  fs.rmSync(path.join(box, 'public'), { recursive: true, force: true });
  fs.rmSync(lockPath(), { force: true });
}

/** Critical sections from the trace: must strictly alternate enter/exit of the same pid (never two inside). */
function expectSerialized(sections: number): void {
  const lines = fs.readFileSync(tracePath(), 'utf8').trim().split('\n');
  expect(lines.length, lines.join('\n')).toBe(sections * 2);
  for (let i = 0; i < lines.length; i += 2) {
    const [e, pidIn] = lines[i]!.split(' ');
    const [x, pidOut] = lines[i + 1]!.split(' ');
    expect(`${e} ${x}`, lines.join('\n')).toBe('enter exit');
    expect(pidOut, lines.join('\n')).toBe(pidIn);
  }
}

/** No temp / aside / break files may be left behind in the cache dir. */
function expectNoLockLitter(): void {
  const left = fs.readdirSync(path.join(box, 'cache')).filter((n) => n.startsWith('.publish.lock.'));
  expect(left).toEqual([]);
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
    expectSerialized(2);
    expectNoLockLitter();
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
    expectSerialized(3);
  }, 90_000);

  it('recovers a stale lock left by a dead process', async () => {
    reset();
    fs.mkdirSync(path.dirname(lockPath()), { recursive: true });
    fs.writeFileSync(lockPath(), JSON.stringify({ pid: 999_999_9, host: os.hostname(), startedAt: Date.now() - 5000, nonce: 'dead', ids: 'crashed' }));
    const r = await run(['--republish', 'lock_test_a']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('removing stale publish lock');
    expect(Object.keys(record().assets)).toEqual(['lock_test_a']);
    expectNoLockLitter();
  }, 60_000);

  it('the lock path is never empty while an excl lock is being taken (no double acquire)', async () => {
    reset();
    // Every runner stalls 600 ms right after its lock path appears. Before the fix the path was still EMPTY at
    // this point (open O_EXCL, then write): pollers saw a free flock(1) sentinel and entered as well.
    const pause = { SAMRAJYA_PUBLISH_LOCK_TEST_PAUSE_MS: 'create:600', SAMRAJYA_PUBLISH_LOCK_HOLD_MS: '300' };
    const runs = await Promise.all([
      run(['--republish', 'lock_test_a'], false, pause),
      run(['--republish', 'lock_test_b'], false, pause),
      run(['--republish', 'lock_test_c'], false, pause),
    ]);
    for (const r of runs) expect(r.code, r.out).toBe(0);
    const out = runs.map((r) => r.out).join('\n');
    expect(out).not.toMatch(/flock-helper|sentinel\)/);
    expect((out.match(/publish lock acquired \(excl/g) ?? []).length).toBe(3);
    expectSerialized(3);
    expect(Object.keys(record().assets).sort()).toEqual(['lock_test_a', 'lock_test_b', 'lock_test_c']);
    expect(fs.existsSync(lockPath())).toBe(false);
    expectNoLockLitter();
  }, 90_000);

  it('two waiters breaking the same stale lock: exactly one breaks it, sections stay serialized', async () => {
    reset();
    fs.mkdirSync(path.dirname(lockPath()), { recursive: true });
    const stale = JSON.stringify({ pid: 999_999_8, host: os.hostname(), startedAt: Date.now() - 5000, nonce: 'dead2', ids: 'crashed' });
    fs.writeFileSync(lockPath(), stale);
    // Both runners see the same stale record at start; the breaker stalls 500 ms mid-break. Before the fix the
    // second waiter's compare-then-unlink could delete the lock the first one had just created.
    const pause = { SAMRAJYA_PUBLISH_LOCK_TEST_PAUSE_MS: 'break:500' };
    const [a, b] = await Promise.all([run(['--republish', 'lock_test_a'], false, pause), run(['--republish', 'lock_test_b'], false, pause)]);
    expect(a.code, a.out).toBe(0);
    expect(b.code, b.out).toBe(0);
    const out = `${a.out}\n${b.out}`;
    expect((out.match(/removing stale publish lock/g) ?? []).length, out).toBe(1);
    expect(out).not.toContain('taken over while held');
    expectSerialized(2);
    expect(Object.keys(record().assets).sort()).toEqual(['lock_test_a', 'lock_test_b']);
    expect(fs.existsSync(lockPath())).toBe(false);
    expectNoLockLitter();
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
