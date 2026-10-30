/**
 * HDR lighting composite (high / ultra): applies GTAO, screen-space contact shadows and SSR to the scene colour
 * (ART_BIBLE §4.7: opaque -> GTAO -> SSR). Runs only when at least one of them is active this frame; the defines
 * follow the tier (rebuild), the per-frame on / off goes through 1x1 neutral textures, so nothing recompiles
 * while zooming. OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01).
 */
import * as THREE from 'three';
import { colorTarget, postMaterial, QuadPass, type PostFrame } from './shared';

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tAo;
uniform sampler2D tContact;
uniform sampler2D tSsr;
uniform float uContactStrength;
varying vec2 vUv;
void main() {
  vec4 c = texture2D( tScene, vUv );
  vec3 col = c.rgb;
#ifdef USE_AO
  col *= texture2D( tAo, vUv ).r;
#endif
#ifdef USE_CONTACT
  col *= 1.0 - uContactStrength * ( 1.0 - texture2D( tContact, vUv ).r );
#endif
#ifdef USE_SSR
  vec4 s = texture2D( tSsr, vUv );
  col = mix( col, s.rgb, s.a );
#endif
  gl_FragColor = vec4( col, 1.0 );
}
`;

/** 1x1 neutral textures: white (no occlusion) and transparent black (no reflection). */
export function neutralTexture(r: number, g: number, b: number, a: number, name: string): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.name = name;
  t.needsUpdate = true;
  return t;
}

export class CompositePass extends QuadPass {
  readonly name = 'composite';
  private readonly out: THREE.WebGLRenderTarget;
  private readonly mat: THREE.ShaderMaterial;
  /** Key light's share of the lighting (contact shadows darken only that part). */
  contactStrength = 0.7;

  constructor(
    private readonly frame: PostFrame,
    features: { ao: boolean; contact: boolean; ssr: boolean },
    private readonly white: THREE.Texture,
    private readonly clear: THREE.Texture,
  ) {
    super();
    this.needsSwap = false;
    this.out = colorTarget(1, 1, { name: 'post.composite' });
    const defines: Record<string, number> = {};
    if (features.ao) defines.USE_AO = 1;
    if (features.contact) defines.USE_CONTACT = 1;
    if (features.ssr) defines.USE_SSR = 1;
    this.mat = postMaterial(
      'SamrajyaComposite',
      COMPOSITE_FRAG,
      {
        tScene: { value: null },
        tAo: { value: white },
        tContact: { value: white },
        tSsr: { value: clear },
        uContactStrength: { value: 0.7 },
      },
      defines,
    );
  }

  override setSize(width: number, height: number): void {
    this.out.setSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  }

  override render(renderer: THREE.WebGLRenderer): void {
    const f = this.frame;
    if (!f.sceneColor) return;
    const u = this.mat.uniforms;
    u.tScene!.value = f.sceneColor;
    u.tAo!.value = f.ao ?? this.white;
    u.tContact!.value = f.contact ?? this.white;
    u.tSsr!.value = f.ssr ?? this.clear;
    u.uContactStrength!.value = this.contactStrength;
    this.draw(renderer, this.mat, this.out);
    f.hdr = this.out.texture;
  }

  override dispose(): void {
    super.dispose();
    this.out.dispose();
    this.mat.dispose();
  }
}
