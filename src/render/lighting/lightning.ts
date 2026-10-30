/**
 * Lightning flashes (ART_BIBLE §4.6): a `lightningFlash` DirectionalLight (#d8e2ff, intensity 9, no shadows) on for
 * 80-160 ms as a double flash, the sky dome +2 EV for the same frames. OWNER: Graphics Developer - Lighting,
 * Atmosphere & Post (GFX-01). Triggered by EnvironmentRig.triggerLightning() (GFX-02 weather calls it in storms;
 * thunder 1-4 s later is audio's job). Render-side randomness (not simulation): Math.random is fine here.
 */
import * as THREE from 'three';
import { PRACTICAL_LIGHTS } from '../style/lighting';

/** Sky multiplier while the flash is lit (+2 EV). */
export const LIGHTNING_SKY_EV = 2;
/** Distance of the flash light from its target (m); only the direction matters for a DirectionalLight. */
export const LIGHTNING_DISTANCE_M = 1000;

interface Pulse {
  start: number;
  end: number;
  gain: number;
}

export class LightningFlash {
  readonly light: THREE.DirectionalLight;
  private readonly pulses: Pulse[] = [
    { start: 0, end: 0, gain: 0 },
    { start: 0, end: 0, gain: 0 },
  ];
  private t = 0;
  private active = false;
  /** 0..1 strength of the current frame (drives the sky +2 EV). */
  level = 0;
  /** Light position relative to the target (direction toward the flash x LIGHTNING_DISTANCE_M). */
  private readonly offset = new THREE.Vector3(0, LIGHTNING_DISTANCE_M, 0);

  constructor(private readonly random: () => number = Math.random) {
    const p = PRACTICAL_LIGHTS.lightningFlash;
    this.light = new THREE.DirectionalLight(p.color, 0);
    this.light.name = 'lightningFlash';
    this.light.castShadow = false;
    // Always present once added (intensity 0 when idle): toggling `visible` would change the light count and
    // recompile every lit material on each flash. EnvironmentRig adds it when the weather can storm.
  }

  /**
   * Start a double flash from a random bearing high in the sky (or `direction`, unit vector toward the flash).
   * Durations: first 80-160 ms, a 40-110 ms gap, then a shorter, weaker second flash.
   */
  trigger(direction?: THREE.Vector3): void {
    const r = this.random;
    const first = 0.08 + r() * 0.08;
    const gap = 0.04 + r() * 0.07;
    const second = 0.05 + r() * 0.06;
    this.pulses[0]!.start = 0;
    this.pulses[0]!.end = first;
    this.pulses[0]!.gain = 1;
    this.pulses[1]!.start = first + gap;
    this.pulses[1]!.end = first + gap + second;
    this.pulses[1]!.gain = 0.55 + r() * 0.3;
    this.t = 0;
    this.active = true;
    if (direction) this.offset.copy(direction).normalize().multiplyScalar(LIGHTNING_DISTANCE_M);
    else {
      const a = r() * Math.PI * 2;
      const el = 0.6 + r() * 0.5;
      this.offset.set(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)).multiplyScalar(LIGHTNING_DISTANCE_M);
    }
  }

  /** Advance (seconds). Returns the sky multiplier for this frame (1 when idle, up to 2^2 at the flash peak). */
  update(dt: number, target: THREE.Vector3): number {
    if (!this.active) {
      this.level = 0;
      this.light.intensity = 0;
      return 1;
    }
    this.t += dt;
    let lvl = 0;
    for (const p of this.pulses) if (this.t >= p.start && this.t < p.end) lvl = Math.max(lvl, p.gain);
    if (this.t >= this.pulses[1]!.end) this.active = false;
    this.level = lvl;
    this.light.intensity = PRACTICAL_LIGHTS.lightningFlash.intensity * lvl;
    // Anchored on the camera focus every frame: the flash direction is `offset` wherever the camera is.
    this.light.target.position.copy(target);
    this.light.target.updateMatrixWorld();
    this.light.position.copy(target).add(this.offset);
    return 1 + (Math.pow(2, LIGHTNING_SKY_EV) - 1) * lvl;
  }

  get flashing(): boolean {
    return this.active;
  }

  dispose(): void {
    this.light.dispose();
  }
}
