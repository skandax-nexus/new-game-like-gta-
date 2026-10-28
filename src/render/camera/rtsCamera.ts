/**
 * Cinematic RTS camera: smooth pan / zoom (cursor-anchored) / rotate / tilt, edge scroll, touch
 * gestures (via InputFrame), terrain clearance, bounds. OWNER: Lead Graphics Engineer (camera feel
 * with Lead UI/UX). Baseline by the CTO.
 *
 * TODO(owner): cinematic mode (slow orbit/dolly for screenshots and battle intros), follow
 * formation, camera shake on charges/elephants, collision with buildings, focus transitions.
 */
import * as THREE from 'three';
import type { InputFrame, Rect } from '../../core/types';
import type { TerrainQuery } from '../../core/types';
import { pickGround } from './picking';

export interface CameraState {
  x: number;
  z: number;
  distance: number;
  yaw: number;
  /** Extra tilt offset (radians) applied on top of the zoom-based pitch curve. */
  tilt: number;
}

export interface RtsCameraOptions {
  bounds: Rect;
  minDistance: number;
  maxDistance: number;
  /** Pitch (radians below horizon) at min and max distance. */
  pitchNear: number;
  pitchFar: number;
}

/** Subset of GameSettings the camera reads. */
export interface CameraInputSettings {
  edgeScroll: boolean;
  invertZoom: boolean;
  cameraSpeed: number;
}

function damp(a: number, b: number, lambda: number, dt: number): number {
  return a + (b - a) * (1 - Math.exp(-lambda * dt));
}

export class RtsCameraController {
  readonly target: CameraState;
  readonly current: CameraState;
  private readonly focusPoint = new THREE.Vector3();
  private readonly anchor = { x: 0, z: 0 };
  enabled = true;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly terrain: TerrainQuery,
    private opts: RtsCameraOptions,
  ) {
    const cx = (opts.bounds.minX + opts.bounds.maxX) / 2;
    const cz = (opts.bounds.minZ + opts.bounds.maxZ) / 2;
    this.target = { x: cx, z: cz, distance: (opts.minDistance + opts.maxDistance) / 2, yaw: 0, tilt: 0 };
    this.current = { ...this.target };
    this.apply();
  }

  setOptions(opts: Partial<RtsCameraOptions>): void {
    this.opts = { ...this.opts, ...opts };
  }

  /** Jump (or glide when `smooth`) to look at (x, z). */
  focus(x: number, z: number, distance: number | null = null, smooth = true): void {
    this.target.x = x;
    this.target.z = z;
    if (distance !== null) this.target.distance = THREE.MathUtils.clamp(distance, this.opts.minDistance, this.opts.maxDistance);
    if (!smooth) Object.assign(this.current, this.target);
    this.clampTarget();
  }

  setState(s: Partial<CameraState>, smooth = false): void {
    Object.assign(this.target, s);
    this.clampTarget();
    if (!smooth) Object.assign(this.current, this.target);
    this.apply();
  }

  getState(): CameraState {
    return { ...this.current };
  }

  /** Ground point the camera looks at (y = terrain height). */
  getFocus(out: THREE.Vector3 = this.focusPoint): THREE.Vector3 {
    return out.set(this.current.x, this.terrain.heightAt(this.current.x, this.current.z), this.current.z);
  }

  private pitchFor(distance: number, tilt: number): number {
    const t = (distance - this.opts.minDistance) / Math.max(1, this.opts.maxDistance - this.opts.minDistance);
    const p = THREE.MathUtils.lerp(this.opts.pitchNear, this.opts.pitchFar, Math.pow(THREE.MathUtils.clamp(t, 0, 1), 0.6));
    return THREE.MathUtils.clamp(p + tilt, 0.12, 1.45);
  }

  private clampTarget(): void {
    const b = this.opts.bounds;
    this.target.x = THREE.MathUtils.clamp(this.target.x, b.minX, b.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, b.minZ, b.maxZ);
    this.target.distance = THREE.MathUtils.clamp(this.target.distance, this.opts.minDistance, this.opts.maxDistance);
    this.target.tilt = THREE.MathUtils.clamp(this.target.tilt, -0.6, 0.5);
  }

  update(dt: number, input: InputFrame | null, settings: CameraInputSettings, viewportHeight: number): void {
    if (input && this.enabled) {
      const t = this.target;
      const speed = settings.cameraSpeed * t.distance * 1.1;
      // Keyboard / edge / stick pan, relative to yaw.
      const px = input.panX;
      const py = input.panY;
      if (px !== 0 || py !== 0) {
        const s = Math.sin(t.yaw);
        const c = Math.cos(t.yaw);
        // Screen up (py > 0) moves the view "forward" (away from camera).
        t.x += (px * c - py * s) * speed * dt;
        t.z += (-px * s - py * c) * speed * dt;
      }
      // Grab drag (pixels): move the ground with the pointer.
      if (input.dragX !== 0 || input.dragY !== 0) {
        const wpp = (2 * t.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / Math.max(1, viewportHeight);
        const s = Math.sin(t.yaw);
        const c = Math.cos(t.yaw);
        const dx = -input.dragX * wpp;
        const dy = -input.dragY * wpp;
        t.x += dx * c + dy * s;
        t.z += -dx * s + dy * c;
      }
      if (input.rotate !== 0) t.yaw += input.rotate;
      if (input.tilt !== 0) t.tilt += input.tilt;
      if (input.zoom !== 0) {
        const z = settings.invertZoom ? -input.zoom : input.zoom;
        const before = t.distance;
        t.distance *= Math.pow(0.85, z);
        t.distance = THREE.MathUtils.clamp(t.distance, this.opts.minDistance, this.opts.maxDistance);
        // Anchor: move toward the point under the cursor proportionally to the zoom.
        if (input.zoomAnchor && pickGround(this.camera, input.zoomAnchor.ndcX, input.zoomAnchor.ndcY, this.terrain, 30000, this.anchor)) {
          const f = 1 - t.distance / before;
          t.x += (this.anchor.x - t.x) * f;
          t.z += (this.anchor.z - t.z) * f;
        }
      }
      this.clampTarget();
    }
    const c = this.current;
    const t = this.target;
    c.x = damp(c.x, t.x, 9, dt);
    c.z = damp(c.z, t.z, 9, dt);
    c.distance = damp(c.distance, t.distance, 8, dt);
    c.yaw = damp(c.yaw, t.yaw, 10, dt);
    c.tilt = damp(c.tilt, t.tilt, 10, dt);
    this.apply();
  }

  private apply(): void {
    const c = this.current;
    const pitch = this.pitchFor(c.distance, c.tilt);
    const fy = this.terrain.heightAt(c.x, c.z);
    const horiz = Math.cos(pitch) * c.distance;
    const cx = c.x + Math.sin(c.yaw) * horiz;
    const cz = c.z + Math.cos(c.yaw) * horiz;
    let cy = fy + Math.sin(pitch) * c.distance;
    const ground = Math.max(this.terrain.heightAt(cx, cz), this.terrain.spec.waterLevel);
    if (cy < ground + 4) cy = ground + 4;
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(c.x, fy + Math.min(6, c.distance * 0.02), c.z);
    this.camera.updateMatrixWorld();
  }
}
