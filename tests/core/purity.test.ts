/**
 * Architecture guard: the simulation layer must stay engine-agnostic and deterministic.
 * - src/sim/**, src/data/** and the three-free core files must not import three / DOM layers.
 * - src/sim/** and src/core/terrain/** must not use non-deterministic or implementation-defined APIs.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const THREE_FREE = [
  ...files(join(ROOT, 'src/sim')),
  ...files(join(ROOT, 'src/data')),
  ...files(join(ROOT, 'src/core/terrain')),
  ...['types', 'constants', 'ids', 'rng', 'math', 'events', 'loop', 'spatial', 'save', 'params'].map((f) => join(ROOT, `src/core/${f}.ts`)),
];
const DETERMINISTIC = [...files(join(ROOT, 'src/sim')), ...files(join(ROOT, 'src/core/terrain'))];

const FORBIDDEN_IMPORT = /from\s+['"](three|three\/.*|\.\.?\/.*\b(render|ui|scenes|input|audio|app)\b\/.*)['"]/;
const FORBIDDEN_API = [
  /Math\.random\s*\(/,
  /Date\.now\s*\(/,
  /new Date\s*\(/,
  /performance\.now\s*\(/,
  /Math\.(sin|cos|tan|asin|acos|atan|atan2|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt|sinh|cosh|tanh)\s*\(/,
  /[^*/]\*\*[^*/]/,
  /\bwindow\./,
  /\bdocument\./,
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('architecture purity', () => {
  it('sim/data/core-logic files do not import three or presentation layers', () => {
    const bad: string[] = [];
    for (const f of THREE_FREE) {
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const line of src.split('\n')) if (FORBIDDEN_IMPORT.test(line)) bad.push(`${relative(ROOT, f)}: ${line.trim()}`);
    }
    expect(bad).toEqual([]);
  });

  it('deterministic code avoids non-deterministic / implementation-defined APIs', () => {
    const bad: string[] = [];
    for (const f of DETERMINISTIC) {
      const src = stripComments(readFileSync(f, 'utf8'));
      src.split('\n').forEach((line, i) => {
        for (const re of FORBIDDEN_API) if (re.test(line)) bad.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
