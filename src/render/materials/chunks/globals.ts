/**
 * Frame-global shader data shared by EVERY material without per-material setup. OWNER: Graphics Developer -
 * Lighting, Atmosphere & Post (GFX-01).
 *
 * How it reaches materials: three clones `ShaderLib[id].uniforms` into each built-in material at compile time and
 * `UniformsUtils.merge/clone` copies arrays with `slice()`, i.e. the array is new but its Vector4 ELEMENTS are
 * shared. `installShaderGlobals()` therefore injects one uniform `samG` (an array of Vector4) into every ShaderLib
 * entry that uses fog / lights and into `UniformsLib.fog`, so MeshStandard/Physical/Lambert/Phong/Toon/Basic/Points/
 * Sprite materials - and custom ShaderMaterials that merge `UniformsLib.fog` - all read the same live Vector4s.
 * Writers update the elements in place (never replace them). Custom ShaderMaterials that do NOT merge UniformsLib
 * call `injectShaderGlobals(uniforms)` (or `injectHeightFog(shader)` from environment/atmosphere).
 *
 * Every slot is designed so that ZERO means "neutral" (classic fog, no cascades, no boosts): a program that
 * declares `samG` but whose material never received the uniform behaves exactly like stock three.js.
 *
 * GLSL side: chunks include `SAM_G_DECL` (guarded, so several chunks can include it) and index with the
 * `SAM_G_*` defines generated from `G` below. Fragment shaders only (never declare it in a vertex shader).
 */
import * as THREE from 'three';

/** Slot indices into `samG` (one vec4 each). Keep GLSL `SAM_G_DEFINES` in sync (generated from this table). */
export const G = {
  /** rgb = fog colour (radiance, away from the sun), w = mode: 0 classic three fog, 1 height fog, 2 height + mist noise. */
  FOG_COLOR: 0,
  /** rgb = in-scatter colour (radiance, toward the sun), w = in-scatter lobe power. */
  FOG_INSCATTER: 1,
  /** xyz = unit vector toward the sun (or moon), w = max fog opacity (readability clamp). */
  FOG_SUN: 2,
  /** x = density (1/m, already x ZoomLook fogDensityScale), y = height falloff (1/m), z = base height (m), w = mist top (absolute m). */
  FOG_DENSITY: 3,
  /** x = mist extra density (1/m), y = mist noise amplitude (0..1), z/w = noise scroll offset (m, wind x 0.3 x t). */
  FOG_MIST: 4,
  /** x = aerial-perspective strength 0..1 (0 = off), y = edge fade inner (m from map centre, Chebyshev), z = edge fade outer, w = 1 when map bounds are known. */
  FOG_AERIAL: 5,
  /** xy = map centre (world x, z), z = aerial reference distance (m), w = sky-dome fog clamp (0.6). */
  FOG_MAP: 6,
  /** 8 slots: horizon sky colour (radiance, sky fog included) at azimuth k x 45 deg, k = 0..7 (atan(z, x) order). */
  HORIZON_RING: 7,
  /** x = sky-dome fog distance (m, 20 000), y = mist noise 1/scale octave 1 (1/40 m), z = octave 2 (1/9 m), w = time (s). */
  FOG_SKY: 15,
  /** 4 slots, cascade i: x = split near (view depth m), y = split far, z = world size of one shadow texel (m), w = shadow camera depth range (m). */
  CSM_CASCADE: 16,
  /** x = cascade count (0 = plain three lights), y = filter: 0 hard / 1 PCF / 2 PCSS, z = debug colours (?csm=1), w = blend band (fraction of a cascade). */
  CSM_PARAMS: 20,
  /** x = tan(sun angular radius) (PCSS light size), y = PCSS blocker samples, z = PCSS filter samples, w = max penumbra (texels). */
  CSM_PCSS: 21,
  /** ZoomLook material weights stored as 1 - w (zero = full detail): x = detail normal, y = macro, z = parallax, w = specular AA. */
  MATERIAL_LOOK: 22,
  /** x = emissive boost - 1 (low tier 0.3), y = baked AO boost - 1 (low tier 0.2), z = SSR roughness cut-off (0 = SSR mask off), w = rain wetness. */
  MATERIAL_BOOST: 23,
} as const;

export const SAM_G_SIZE = 24;

/** The shared uniform (value elements are live; update them in place with `.set()`). */
export const SAM_GLOBALS: { value: THREE.Vector4[] } = {
  // Explicit zeros: THREE.Vector4() defaults to w = 1, which would switch every "w = enabled" slot on.
  value: Array.from({ length: SAM_G_SIZE }, () => new THREE.Vector4(0, 0, 0, 0)),
};

/** Element accessor (typed, no bounds checks needed at call sites). */
export function g(slot: number): THREE.Vector4 {
  return SAM_GLOBALS.value[slot] as THREE.Vector4;
}

/** GLSL defines for the slot indices (so chunks read `samG[ SAM_G_FOG_COLOR ]`). */
export const SAM_G_DEFINES = Object.entries(G)
  .map(([k, v]) => `#define SAM_G_${k} ${v}`)
  .join('\n');

/** Guarded declaration: include in every fragment chunk that reads samG. */
export const SAM_G_DECL = /* glsl */ `
#ifndef SAM_G_DECLARED
#define SAM_G_DECLARED
uniform vec4 samG[ ${SAM_G_SIZE} ];
${SAM_G_DEFINES}
#endif
`;

/** Reset every slot to neutral (no rig bound to the frame being rendered). Allocation-free. */
export function resetShaderGlobals(): void {
  for (const v of SAM_GLOBALS.value) v.set(0, 0, 0, 0);
}

/** Add the shared uniform to a uniforms object (custom ShaderMaterials). Returns the same object. */
export function injectShaderGlobals<T extends Record<string, THREE.IUniform>>(uniforms: T): T {
  (uniforms as Record<string, THREE.IUniform>).samG = SAM_GLOBALS;
  return uniforms;
}

/** Chunk transforms registered by GFX-01 modules (fog, shadows, material globals), applied once by install. */
type ChunkName = keyof typeof THREE.ShaderChunk;
const chunkPatches: { name: ChunkName; patch: (src: string) => string; id: string }[] = [];
let installed = false;

/**
 * Register a transform of a three.js shader chunk. Applied immediately when globals are already installed.
 * Transforms must be surgical (replace exact lines and keep everything else, including strings other modules
 * hook into, e.g. TA-07's FLIP_CHUNK_HOOKS) and idempotent per id.
 */
export function registerChunkPatch(name: ChunkName, id: string, patch: (src: string) => string): void {
  if (chunkPatches.some((p) => p.id === id)) return;
  const entry = { name, patch, id };
  chunkPatches.push(entry);
  if (installed) applyPatch(entry);
}

const applied = new Set<string>();
function applyPatch(p: { name: ChunkName; patch: (src: string) => string; id: string }): void {
  if (applied.has(p.id)) return;
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  const src = chunks[p.name];
  if (typeof src !== 'string') throw new Error(`registerChunkPatch: unknown chunk ${String(p.name)}`);
  const out = p.patch(src);
  if (out === src) throw new Error(`registerChunkPatch: ${p.id} did not change ${String(p.name)} (three.js upgrade?)`);
  chunks[p.name] = out;
  applied.add(p.id);
}

/** Has installShaderGlobals() run (tests, diagnostics)? */
export function shaderGlobalsInstalled(): boolean {
  return installed;
}

/**
 * Install the shared uniform into ShaderLib / UniformsLib and apply every registered chunk patch. Idempotent.
 * Must run before the first material compiles (RenderContext's constructor calls it; so does EnvironmentRig).
 */
export function installShaderGlobals(): void {
  if (installed) return;
  installed = true;
  const lib = THREE.ShaderLib as unknown as Record<string, { uniforms: Record<string, THREE.IUniform> }>;
  for (const key of Object.keys(lib)) {
    const u = lib[key]?.uniforms;
    if (!u) continue;
    if ('fogColor' in u || 'ambientLightColor' in u) u.samG = SAM_GLOBALS;
  }
  const ulib = THREE.UniformsLib as unknown as Record<string, Record<string, THREE.IUniform>>;
  if (ulib.fog) ulib.fog.samG = SAM_GLOBALS;
  if (ulib.lights) ulib.lights.samG = SAM_GLOBALS;
  for (const p of chunkPatches) applyPatch(p);
}
