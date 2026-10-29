/**
 * Feature-lab contract (`?scene=lab&lab=<id>`). OWNER: Engine Developer - Contracts (CORE-01).
 *
 * Graphics and gameplay tickets demonstrate features that the game scenes do not drive yet in labs
 * (STUDIO.md W6). A lab module `src/<your dirs>/<id>.lab.ts` exports:
 *
 *   export const LAB: LabModule = {
 *     id: '<id>', title: 'Post stack - hero distance',
 *     async setup(ctx, host) {
 *       host.setEnvironment({ hour: 17.4 });            // EnvironmentRig drives sun, sky, IBL, fog, grade
 *       const mesh = host.own(new THREE.Mesh(...));      // own() = disposed with the lab
 *       host.scene.add(mesh); host.frame({ x: 0, y: 1, z: 0 }, 8, 30, 12);
 *       return { update(dt) { ... }, dispose() { ... }, debugCommand(name, args) { ... } };
 *     },
 *   };
 *
 * The LabScene owns the renderer view, the orbit camera, the EnvironmentRig, the ground plane, an optional
 * region-terrain window, the lab HUD and every resource passed to host.own(); the lab disposes what it creates
 * otherwise. Freeze / screenshot / sceneReady work exactly like any scene (window.__SAMRAJYA__).
 */
import type * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AppContext, EnvironmentOverride } from '../../app/contracts';
import type { TerrainPreset, Vec3 } from '../../core/types';
import type { Heightfield } from '../../core/terrain/heightfield';
import type { EnvironmentRig } from '../../render/environment/environment';

export interface LabTerrainOptions {
  /** World position of the window centre on the region terrain (default: the Rajapura site). */
  centerX?: number;
  centerZ?: number;
  /** Window size (m, default 1,024) and samples per side (default 257 low / 513 otherwise). */
  sizeMeters?: number;
  resolution?: number;
  preset?: TerrainPreset;
  /** Add the water surface (default true). */
  water?: boolean;
}

export interface LabTerrain {
  readonly heightfield: Heightfield;
  /** Terrain (+ water) root in the lab scene. */
  readonly object: THREE.Object3D;
  /** The ground plane is hidden while a terrain window is shown. */
  heightAt(x: number, z: number): number;
}

export interface LabHost {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Orbit controls (mouse / touch); `controls.target` is the focus used for shadows and HUD distance. */
  readonly controls: OrbitControls;
  /** The regular environment rig (GFX-01 evolves it; labs get every improvement). */
  readonly env: EnvironmentRig;
  /** 800 m ground disc at y = 0 (procedural dry earth). Hide it if the lab brings its own ground. */
  readonly ground: THREE.Mesh;
  /** Lab id (file name) for HUD / logs. */
  readonly labId: string;
  /** Show a window of the region terrain (procedural terrain + water renderers). One per lab. */
  addTerrain(opts?: LabTerrainOptions): Promise<LabTerrain>;
  /** Time of day / season / weather (URL ?hour= ?season= ?weather= are applied at start). */
  setEnvironment(patch: EnvironmentOverride): void;
  /** Orbit the camera around `target` at `distance` m, yaw (deg, 0 = from +Z) and pitch (deg above horizon). */
  frame(target: Vec3, distance: number, yawDeg?: number, pitchDeg?: number): void;
  /** Register a GPU / DOM resource disposed when the lab exits (returns it). */
  own<T extends { dispose(): void }>(resource: T): T;
  /** Lines under the lab title in the HUD (hidden with ?noui=1). */
  setInfo(lines: readonly string[]): void;
  /** Loading-screen progress while setup() runs. */
  progress(fraction: number, label: string): void;
}

export interface LabInstance {
  /** Per rendered frame before the render (dt = real seconds). */
  update(dt: number): void;
  /** Free everything not registered with host.own(). */
  dispose(): void;
  /**
   * Lab-specific QA commands for __SAMRAJYA__.call(name, ...args); return DEBUG_UNHANDLED (app/contracts) for
   * names the lab does not know.
   */
  debugCommand?(name: string, args: readonly unknown[]): unknown;
}

export interface LabModule {
  /** Must equal the file name: `<id>.lab.ts`. */
  id: string;
  title: string;
  /** One line shown in the lab HUD. */
  description?: string;
  setup(ctx: AppContext, host: LabHost): LabInstance | Promise<LabInstance>;
}
