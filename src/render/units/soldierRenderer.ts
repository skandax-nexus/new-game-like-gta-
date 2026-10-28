/**
 * Instanced soldier renderer with GPU (vertex-shader) animation. Reads SoldierBuffers (SoA) written
 * by sim/tactical/soldiers.ts and interpolates prev -> current with the loop alpha.
 * OWNER: Lead Graphics Engineer. Baseline by the CTO.
 *
 * - One InstancedMesh per unit class (distinct silhouettes), compacted every frame: only soldiers
 *   inside the frustum and LOD range are written, so 5,000 combatants cost ~9 draw calls (+ shadows).
 * - Per-instance attributes: aAnim (anim id, anim time, speed, variant), aTeamColor (faction color).
 * - Animations: idle, walk, run, attack, shoot, hit, die, dead, rout, cheer, brace, work.
 *
 * TODO(owner): LOD1/LOD2 meshes + impostors for far soldiers, per-soldier selection tint, blood/dust
 * on hits (fx), cloth sway, horse gallop blend, elephant trunk swing, banners on standard bearers.
 */
import * as THREE from 'three';
import type { QualitySettings, SoldierBuffers, UnitClass } from '../../core/types';
import { SOLDIER_ANIM, SOLDIER_LOD, UNIT_CLASSES } from '../../core/types';
import { UNITS } from '../../data/units';
import { buildUnitGeometry } from './unitModels';

const POSE_COMMON = /* glsl */ `
attribute float aPart;
attribute vec3 aPivot;
attribute float aTeam;
attribute vec4 aAnim;
attribute vec3 aTeamColor;
varying float vTeam;
varying vec3 vTeamColor;
varying float vVariant;
uniform float uMounted;
mat3 sRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 sRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void soldierPose(vec3 pos, vec3 nrm, out vec3 oPos, out vec3 oNrm) {
  int a = int(aAnim.x + 0.5);
  float t = aAnim.y;
  float vr = aAnim.w;
  float legA = 0.0, armL = 0.0, armR = 0.0, lean = 0.0, bob = 0.0, fall = 0.0, mleg = 0.0;
  if (a == 1) { float ph = t * 6.2831 * 1.6; legA = sin(ph) * 0.55; armL = -legA * 0.6; armR = legA * 0.35; bob = abs(sin(ph)) * 0.035; mleg = sin(ph) * 0.45; }
  else if (a == 2 || a == 8) { float ph = t * 6.2831 * 2.4; legA = sin(ph) * 0.85; armL = -legA * 0.8; armR = legA * 0.5; bob = abs(sin(ph)) * 0.07; lean = 0.18; mleg = sin(ph) * 0.9; if (a == 8) { armL = -2.3; armR = -2.1; } }
  else if (a == 3) { float ph = t * 6.2831 * 0.95 + vr * 6.2831; armR = -1.25 + sin(ph) * 0.85; armL = -0.55; lean = 0.12 + sin(ph) * 0.07; legA = 0.25; }
  else if (a == 4) { armL = -1.45; armR = -1.25 + clamp(t * 1.3, 0.0, 1.0) * 0.45; lean = -0.04; }
  else if (a == 5) { lean = -0.25; }
  else if (a == 6) { fall = clamp(t / 0.9, 0.0, 1.0); fall *= fall; }
  else if (a == 7) { fall = 1.0; }
  else if (a == 9) { armL = -2.6 + sin(t * 8.0) * 0.3; armR = -2.6 + cos(t * 8.0) * 0.3; bob = abs(sin(t * 8.0)) * 0.05; }
  else if (a == 10) { armR = -0.85; armL = -0.45; legA = 0.35; bob = -0.12; lean = 0.15; }
  else if (a == 11) { float w = abs(sin(t * 4.0)); armR = -1.9 + w * 1.6; lean = 0.25 + w * 0.12; }
  else { bob = sin(t * 1.6 + vr * 6.0) * 0.008; armL = sin(t * 1.1) * 0.04; armR = -sin(t * 1.1) * 0.04; }
  int part = int(aPart + 0.5);
  float ang = 0.0;
  if (part == 1) ang = legA;
  else if (part == 2) ang = -legA;
  else if (part == 3 || part == 10) ang = (part == 10) ? armL * 0.5 : armL;
  else if (part == 4 || part == 5) ang = armR;
  else if (part == 7) ang = mleg;
  else if (part == 8) ang = -mleg;
  else if (part == 11) ang = -t * 4.0;
  mat3 R = sRotX(ang);
  vec3 p = R * (pos - aPivot) + aPivot;
  vec3 n = R * nrm;
  bool upper = part == 0 || part == 3 || part == 4 || part == 5 || part == 10;
  if (upper && uMounted < 0.5) {
    vec3 hip = vec3(0.0, 0.88, 0.0);
    mat3 L = sRotX(lean);
    p = L * (p - hip) + hip;
    n = L * n;
  }
  if (part != 1 && part != 2 && part != 7 && part != 8 && part != 11) p.y += bob;
  if (fall > 0.0) {
    mat3 F = uMounted > 0.5 ? sRotZ(fall * (vr > 0.5 ? 1.45 : -1.45)) : sRotX(-fall * 1.5 + (vr - 0.5) * 0.3);
    p = F * p;
    n = F * n;
    p.y += fall * (uMounted > 0.5 ? 0.25 : 0.12);
  }
  oPos = p;
  oNrm = n;
}
`;

function patchStandard(shader: THREE.WebGLProgramParametersWithUniforms, uniforms: Record<string, THREE.IUniform>): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${POSE_COMMON}\nvec3 sPosePos;`)
    .replace(
      '#include <beginnormal_vertex>',
      `vec3 sPoseNrm;\nsoldierPose(position, normal, sPosePos, sPoseNrm);\nvec3 objectNormal = sPoseNrm;\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif`,
    )
    .replace('#include <begin_vertex>', 'vec3 transformed = sPosePos;\nvTeam = aTeam;\nvTeamColor = aTeamColor;\nvVariant = aAnim.w;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vTeam;\nvarying vec3 vTeamColor;\nvarying float vVariant;')
    .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb * (0.86 + vVariant * 0.28), vTeamColor, vTeam);');
}

function patchDepth(shader: THREE.WebGLProgramParametersWithUniforms, uniforms: Record<string, THREE.IUniform>): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${POSE_COMMON}`)
    .replace('#include <begin_vertex>', 'vec3 transformed; vec3 sN; soldierPose(position, vec3(0.0, 1.0, 0.0), transformed, sN);');
}

interface ClassMesh {
  cls: UnitClass;
  mesh: THREE.InstancedMesh;
  anim: THREE.InstancedBufferAttribute;
  team: THREE.InstancedBufferAttribute;
  material: THREE.MeshStandardMaterial;
  depth: THREE.MeshDepthMaterial;
  scale: number;
}

export interface SoldierRendererOptions {
  quality: QualitySettings;
  /** Faction colors per side (sRGB hex). */
  sideColors: [string, string];
}

export class SoldierRenderer {
  readonly object = new THREE.Group();
  private readonly classes: (ClassMesh | null)[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly sideColors: [THREE.Color, THREE.Color];
  private quality: QualitySettings;
  private readonly counts: Int32Array;
  visibleCount = 0;

  constructor(
    private readonly buffers: SoldierBuffers,
    opts: SoldierRendererOptions,
  ) {
    this.object.name = 'soldiers';
    this.quality = opts.quality;
    this.sideColors = [new THREE.Color(opts.sideColors[0]), new THREE.Color(opts.sideColors[1])];
    this.counts = new Int32Array(UNIT_CLASSES.length);
    const counts = new Array<number>(UNIT_CLASSES.length).fill(0);
    for (let i = 0; i < buffers.count; i++) counts[buffers.unitClass[i] as number]!++;
    UNIT_CLASSES.forEach((cls, ci) => {
      const n = counts[ci] as number;
      if (n === 0) {
        this.classes.push(null);
        return;
      }
      const geo = buildUnitGeometry(cls);
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      anim.setUsage(THREE.DynamicDrawUsage);
      const team = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      team.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      geo.setAttribute('aTeamColor', team);
      const mounted = UNITS[cls].visual.mount !== 'none';
      const uniforms = { uMounted: { value: mounted ? 1 : 0 } };
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05 });
      material.onBeforeCompile = (s) => patchStandard(s, uniforms);
      material.customProgramCacheKey = () => `soldier-${mounted ? 1 : 0}`;
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      depth.onBeforeCompile = (s) => patchDepth(s, uniforms);
      depth.customProgramCacheKey = () => `soldier-depth-${mounted ? 1 : 0}`;
      const mesh = new THREE.InstancedMesh(geo, material, n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.customDepthMaterial = depth;
      mesh.frustumCulled = false;
      mesh.castShadow = opts.quality.shadows.enabled && opts.quality.tier !== 'low';
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.name = `soldiers_${cls}`;
      this.object.add(mesh);
      this.classes.push({ cls, mesh, anim, team, material, depth, scale: UNITS[cls].visual.scale });
    });
  }

  setQuality(q: QualitySettings): void {
    this.quality = q;
    for (const c of this.classes) if (c) c.mesh.castShadow = q.shadows.enabled && q.tier !== 'low';
  }

  /** Write visible instances (interpolated with alpha) for this frame. */
  update(alpha: number, camera: THREE.Camera): void {
    const b = this.buffers;
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cams = camera.position;
    const far = this.quality.soldierLod.far * 1.6;
    const far2 = far * far;
    const corpse2 = this.quality.soldierLod.mid * this.quality.soldierLod.mid * 2;
    const counts = this.counts;
    counts.fill(0);
    let visible = 0;
    for (let i = 0; i < b.count; i++) {
      const ci = b.unitClass[i] as number;
      const c = this.classes[ci];
      if (!c) continue;
      const x = (b.prevX[i] as number) + ((b.posX[i] as number) - (b.prevX[i] as number)) * alpha;
      const y = (b.prevY[i] as number) + ((b.posY[i] as number) - (b.prevY[i] as number)) * alpha;
      const z = (b.prevZ[i] as number) + ((b.posZ[i] as number) - (b.prevZ[i] as number)) * alpha;
      const dx = x - cams.x;
      const dy = y - cams.y;
      const dz = z - cams.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > far2) continue;
      const dead = b.anim[i] === SOLDIER_ANIM.dead;
      if (dead && d2 > corpse2) continue;
      if (b.lod[i] === SOLDIER_LOD.culled && d2 > far2 * 0.5) continue;
      this.sphere.center.set(x, y + 1, z);
      this.sphere.radius = 4;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const k = counts[ci] as number;
      counts[ci] = k + 1;
      // Facing interpolation (shortest arc).
      const f0 = b.prevFacing[i] as number;
      let df = (b.facing[i] as number) - f0;
      if (df > Math.PI) df -= Math.PI * 2;
      else if (df < -Math.PI) df += Math.PI * 2;
      const th = f0 + df * alpha;
      const v = (b.variant[i] as number) / 255;
      const s = c.scale * (0.94 + v * 0.12);
      const cs = Math.cos(th) * s;
      const sn = Math.sin(th) * s;
      const m = c.mesh.instanceMatrix.array as Float32Array;
      const o = k * 16;
      m[o] = cs;
      m[o + 1] = 0;
      m[o + 2] = -sn;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = s;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = sn;
      m[o + 9] = 0;
      m[o + 10] = cs;
      m[o + 11] = 0;
      m[o + 12] = x;
      m[o + 13] = y;
      m[o + 14] = z;
      m[o + 15] = 1;
      const an = c.anim.array as Float32Array;
      an[k * 4] = b.anim[i] as number;
      an[k * 4 + 1] = b.animTime[i] as number;
      an[k * 4 + 2] = b.animSpeed[i] as number;
      an[k * 4 + 3] = v;
      const tc = this.sideColors[(b.side[i] as number) & 1] as THREE.Color;
      const ta = c.team.array as Float32Array;
      ta[k * 3] = tc.r;
      ta[k * 3 + 1] = tc.g;
      ta[k * 3 + 2] = tc.b;
      visible++;
    }
    for (let ci = 0; ci < this.classes.length; ci++) {
      const c = this.classes[ci];
      if (!c) continue;
      c.mesh.count = counts[ci] as number;
      c.mesh.instanceMatrix.needsUpdate = true;
      c.anim.needsUpdate = true;
      c.team.needsUpdate = true;
    }
    this.visibleCount = visible;
  }

  dispose(): void {
    for (const c of this.classes) {
      if (!c) continue;
      c.mesh.geometry.dispose();
      c.material.dispose();
      c.depth.dispose();
      c.mesh.dispose();
    }
  }
}
