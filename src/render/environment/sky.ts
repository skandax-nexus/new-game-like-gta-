/**
 * Physically based sky (Preetham via three/examples Sky) + sun position + IBL environment map.
 * OWNER: Lead Graphics Engineer. Baseline by the CTO.
 *
 * TODO(owner): volumetric/procedural clouds, monsoon overcast dome, stars + moon at night,
 * Hillaire-style multiple scattering, aerial perspective LUT shared with fog.
 */
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { EnvironmentState } from '../../core/types';

/** Sun direction (unit vector, world space; +Y up, +X east, -Z north) for an environment state. */
export function sunDirection(env: EnvironmentState, out: THREE.Vector3): THREE.Vector3 {
  // Indian calendar day 0 (Chaitra 1) ~ March 21 => Gregorian day ~80.
  const n = (env.dayOfYear + 80) % 365;
  const decl = THREE.MathUtils.degToRad(23.44) * Math.sin((2 * Math.PI * (284 + n)) / 365);
  const lat = THREE.MathUtils.degToRad(env.latitude);
  const H = THREE.MathUtils.degToRad((env.hour - 12) * 15);
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const alt = Math.asin(THREE.MathUtils.clamp(sinAlt, -1, 1));
  const az = Math.atan2(-Math.sin(H), Math.tan(decl) * Math.cos(lat) - Math.sin(lat) * Math.cos(H));
  out.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
  return out.normalize();
}

export class SkySystem {
  readonly mesh: Sky;
  private readonly envScene = new THREE.Scene();
  private readonly envSky: Sky;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private lastEnvDir = new THREE.Vector3(0, -1, 0);
  private lastCloud = -1;
  readonly sunDir = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly pmrem: THREE.PMREMGenerator,
    private readonly envMapSize: number,
  ) {
    this.mesh = new Sky();
    this.mesh.scale.setScalar(45000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
  }

  /** Update sky uniforms from the environment. */
  setEnvironment(env: EnvironmentState): void {
    sunDirection(env, this.sunDir);
    const w = env.weather;
    const cloud = w.cloudCover;
    for (const sky of [this.mesh, this.envSky]) {
      const u = sky.material.uniforms;
      u.turbidity!.value = 2.5 + cloud * 8 + (w.kind === 'hazy' || w.kind === 'dust_storm' ? 6 : 0);
      u.rayleigh!.value = 1.2 + (1 - cloud) * 1.2 - (this.sunDir.y < 0.15 ? 0 : 0.3);
      u.mieCoefficient!.value = 0.004 + cloud * 0.01 + (w.kind === 'fog' ? 0.02 : 0);
      u.mieDirectionalG!.value = 0.82;
      (u.sunPosition!.value as THREE.Vector3).copy(this.sunDir).multiplyScalar(1000);
    }
  }

  /** Regenerate the PMREM environment if the sun moved / weather changed enough. Returns the env texture. */
  updateEnvironmentMap(cloudCover: number, force = false): THREE.Texture | null {
    if (this.envMapSize <= 0) return null;
    const moved = this.lastEnvDir.angleTo(this.sunDir) > THREE.MathUtils.degToRad(2);
    if (!force && !moved && Math.abs(cloudCover - this.lastCloud) < 0.05 && this.envTarget) return this.envTarget.texture;
    this.lastEnvDir.copy(this.sunDir);
    this.lastCloud = cloudCover;
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
    return this.envTarget.texture;
  }

  get envMap(): THREE.Texture | null {
    return this.envTarget?.texture ?? null;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.envSky.geometry.dispose();
    this.envSky.material.dispose();
    this.envTarget?.dispose();
  }
}
