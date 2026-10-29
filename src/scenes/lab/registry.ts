/**
 * Feature-lab discovery. OWNER: Engine Developer - Contracts (CORE-01). Used by LabScene and __SAMRAJYA__.labs().
 *
 * A lab is any `src/**\/<id>.lab.ts` module exporting `LAB: LabModule` with `LAB.id === <id>` (file name = id).
 * Modules are discovered with a NON-eager import.meta.glob, so each lab is its own lazily loaded chunk that
 * players never download; the single-file build (`vite build --mode single`) discovers none at all.
 * Put labs inside your ticket's own directories (STUDIO.md W6), e.g. src/render/post/post-hero.lab.ts.
 */
import type { LabModule } from './types';

export type LabLoader = () => Promise<unknown>;

export interface LabIndexEntry {
  id: string;
  path: string;
  load: LabLoader;
}

export interface LabIndex {
  /** Lab id -> module (ids sorted). */
  entries: Record<string, LabIndexEntry>;
  /** Discovery problems (duplicate ids, bad file names). */
  errors: string[];
}

const LAB_FILE = /(?:^|\/)([a-z0-9][a-z0-9_-]*)\.lab\.ts$/;

/** '/src/render/post/post-hero.lab.ts' -> 'post-hero' (null for names that are not valid lab ids). */
export function labIdFromPath(path: string): string | null {
  const m = LAB_FILE.exec(path);
  return m ? (m[1] ?? null) : null;
}

/** Index discovered lab modules by id (deterministic: sorted paths; the first path wins a duplicate id). */
export function buildLabIndex(modules: Readonly<Record<string, LabLoader>>): LabIndex {
  const entries: Record<string, LabIndexEntry> = {};
  const errors: string[] = [];
  for (const path of Object.keys(modules).sort()) {
    const id = labIdFromPath(path);
    const load = modules[path];
    if (!id || !load) {
      errors.push(`${path}: lab files must be named <id>.lab.ts with a lower-case id ([a-z0-9_-])`);
      continue;
    }
    const prev = entries[id];
    if (prev) {
      errors.push(`${path}: lab id '${id}' is already used by ${prev.path}`);
      continue;
    }
    entries[id] = { id, path, load };
  }
  return { entries, errors };
}

/** Narrow a loaded module namespace to its LabModule (throws a readable error otherwise). */
export function labFromModule(mod: unknown, id: string, path: string): LabModule {
  const lab = typeof mod === 'object' && mod !== null ? (mod as { LAB?: unknown }).LAB : undefined;
  if (typeof lab !== 'object' || lab === null) throw new Error(`${path} does not export LAB (a LabModule)`);
  const l = lab as Partial<LabModule>;
  if (l.id !== id) throw new Error(`${path}: LAB.id '${String(l.id)}' must equal the file name id '${id}'`);
  if (typeof l.title !== 'string' || typeof l.setup !== 'function') throw new Error(`${path}: LAB needs a title and a setup(ctx, host) function`);
  return lab as LabModule;
}

/** All discovered labs (empty in the single-file build, which ships no labs). */
export const LAB_INDEX: LabIndex = buildLabIndex(import.meta.env.MODE === 'single' ? {} : import.meta.glob('/src/**/*.lab.ts'));

export function listLabs(): string[] {
  return Object.keys(LAB_INDEX.entries).sort();
}

/** Load a lab module by id (null when no such lab exists). */
export async function loadLab(id: string): Promise<{ lab: LabModule; path: string } | null> {
  const e = LAB_INDEX.entries[id];
  if (!e) return null;
  return { lab: labFromModule(await e.load(), id, e.path), path: e.path };
}
