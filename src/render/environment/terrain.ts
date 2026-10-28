/**
 * Terrain renderer: chunked heightfield meshes with biome splat coloring, slope rock, procedural
 * detail (albedo + normal), season tint and wetness. OWNER: Lead Graphics Engineer. Baseline by the CTO.
 *
 * TODO(owner): triplanar rock on steep slopes, 8-layer splat textures (grass, dry grass, soil, rock,
 * sand, farmland furrows, mud, road), field patchwork + furrow direction in farmland, CDLOD/geomorph
 * LOD, outer apron beyond battle bounds, road decals, footprint/scorch decals.
 */
import * as THREE from 'three';
import type { EnvironmentState, QualitySettings } from '../../core/types';
import { BIOMES } from '../../core/types';
import type { Heightfield } from '../../core/terrain/heightfield';
import { hash2 } from '../../core/math';
import { BIOME_COLORS, MATERIALS, SEASON_TINT } from '../style/palette';
import { createDetailTexture, createNoiseNormalMap } from './textures';

export interface TerrainRenderOptions {
  quality: QualitySettings;
  /** Max chunks per side (frustum culling granularity). */
  maxChunksPerSide?: number;
  /** World-space tile size of the detail textures (m). */
  detailTile?: number;
}

const BIOME_RGB = BIOMES.map((b) => new THREE.Color(BIOME_COLORS[b]));
const ROCK = new THREE.Color(MATERIALS.granite);
const SAND = new THREE.Color(BIOME_COLORS.sandbank);

export class TerrainRenderer {
  readonly object = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  private readonly detail: THREE.DataTexture;
  private readonly normal: THREE.DataTexture;
  private readonly uniforms = {
    uDetail: { value: null as THREE.Texture | null },
    uDetailScale: { value: 1 / 24 },
    uSeasonTint: { value: new THREE.Color(1, 1, 1) },
    uWetness: { value: 0 },
  };

  constructor(
    private readonly hf: Heightfield,
    opts: TerrainRenderOptions,
  ) {
    this.object.name = 'terrain';
    this.detail = createDetailTexture(256, 7);
    this.normal = createNoiseNormalMap(256, 11, 3, 8);
    this.uniforms.uDetail.value = this.detail;
    this.uniforms.uDetailScale.value = 1 / (opts.detailTile ?? 24);
    const q = opts.quality;
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0,
      normalMap: q.terrain.detailTextures ? this.normal : null,
      normalScale: new THREE.Vector2(0.6, 0.6),
    });
    if (this.material.normalMap) this.material.normalMap.repeat.set(1, 1);
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vWorldPos;\nuniform sampler2D uDetail;\nuniform float uDetailScale;\nuniform vec3 uSeasonTint;\nuniform float uWetness;',
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float d1 = texture2D(uDetail, vWorldPos.xz * uDetailScale).r;
          float d2 = texture2D(uDetail, vWorldPos.xz * uDetailScale * 0.17 + 0.37).r;
          diffuseColor.rgb *= mix(0.78, 1.2, d1 * 0.6 + d2 * 0.4);
          diffuseColor.rgb *= uSeasonTint;
          diffuseColor.rgb *= 1.0 - uWetness * 0.28;`,
        );
    };
    this.build(opts);
  }

  private build(opts: TerrainRenderOptions): void {
    const hf = this.hf;
    const q = opts.quality;
    const res = hf.resolution;
    const targetSegments = q.tier === 'low' ? 160 : q.tier === 'medium' ? 256 : 512;
    const step = Math.max(1, Math.floor((res - 1) / targetSegments));
    const cellsPerSide = Math.floor((res - 1) / step);
    const maxChunks = opts.maxChunksPerSide ?? (q.tier === 'low' ? 4 : 8);
    let chunks = Math.max(1, Math.min(maxChunks, Math.round(hf.spec.sizeMeters / 700)));
    while (cellsPerSide % chunks !== 0 && chunks > 1) chunks--;
    const cellsPerChunk = cellsPerSide / chunks;
    const color = new THREE.Color();
    for (let cz = 0; cz < chunks; cz++) {
      for (let cx = 0; cx < chunks; cx++) {
        const n = cellsPerChunk + 1;
        const pos = new Float32Array(n * n * 3);
        const col = new Float32Array(n * n * 3);
        const uv = new Float32Array(n * n * 2);
        for (let j = 0; j < n; j++) {
          for (let i = 0; i < n; i++) {
            const gx = (cx * cellsPerChunk + i) * step;
            const gz = (cz * cellsPerChunk + j) * step;
            const k = j * n + i;
            const x = hf.worldX(gx);
            const z = hf.worldZ(gz);
            const h = hf.heights[gz * res + gx] as number;
            pos[k * 3] = x;
            pos[k * 3 + 1] = h;
            pos[k * 3 + 2] = z;
            uv[k * 2] = x / 18;
            uv[k * 2 + 1] = z / 18;
            const bi = hf.biomes[gz * res + gx] as number;
            color.copy(BIOME_RGB[bi] as THREE.Color);
            const slope = hf.slopeAt(x, z);
            const rock = THREE.MathUtils.smoothstep(slope, 0.35, 0.8);
            color.lerp(ROCK, rock);
            const wl = hf.spec.waterLevel;
            if (h < wl + 0.8 && h > wl - 2) color.lerp(SAND, 0.55);
            if (h <= wl - 2) color.multiplyScalar(0.55);
            const v = 0.9 + hash2(gx, gz, 99) * 0.2;
            const m = hf.moistureGrid[gz * res + gx] as number;
            color.multiplyScalar(v * (0.95 + (m / 255) * 0.1));
            col[k * 3] = color.r;
            col[k * 3 + 1] = color.g;
            col[k * 3 + 2] = color.b;
          }
        }
        const idx = new Uint32Array(cellsPerChunk * cellsPerChunk * 6);
        let t = 0;
        for (let j = 0; j < cellsPerChunk; j++) {
          for (let i = 0; i < cellsPerChunk; i++) {
            const a = j * n + i;
            const b = a + 1;
            const c = a + n;
            const d = c + 1;
            idx[t++] = a;
            idx[t++] = c;
            idx[t++] = b;
            idx[t++] = b;
            idx[t++] = c;
            idx[t++] = d;
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeVertexNormals();
        geo.computeBoundingSphere();
        geo.computeBoundingBox();
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = q.tier === 'ultra';
        mesh.name = `terrain_${cx}_${cz}`;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.object.add(mesh);
      }
    }
  }

  setEnvironment(env: EnvironmentState): void {
    const t = SEASON_TINT[env.season];
    this.uniforms.uSeasonTint.value.setRGB(t[0], t[1], t[2]);
    this.uniforms.uWetness.value = env.weather.wetness;
  }

  update(camera: THREE.Camera): void {
    void camera;
  }

  dispose(): void {
    for (const c of this.object.children) (c as THREE.Mesh).geometry.dispose();
    this.material.dispose();
    this.detail.dispose();
    this.normal.dispose();
  }
}
