/**
 * Final pass, material name 'SamrajyaGrade' (the asset viewer inserts its A/B LUT pass right after it):
 * HDR (+ shafts + bloom + lens dirt) -> exposure -> ACES Filmic (three r170 maths, AgX selectable) -> sRGB ->
 * grade (GRADE_PRESETS, display-referred, as authored for the CTO baseline) x ZoomLook multipliers -> 32^3 LUT
 * (35 % on high / ultra; cross-faded on preset changes) -> vignette -> luminance grain -> dither. Edge chromatic
 * aberration (close / hero bands, ultra) and a light HDR sharpen (strategic / tactical bands).
 * postMerged (low): FXAA runs inside this pass on tone-mapped taps, so the whole low-tier post is one fullscreen
 * draw. OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01).
 */
import * as THREE from 'three';
import { SAMRAJYA_LUT_GLSL } from '../../assets/loaders/lut';
import { NOISE_GLSL, postMaterial, QuadPass, TONEMAP_GLSL, type PostFrame } from './shared';

export type ToneMapper = 'aces' | 'agx';

/** Lighting-to-display LUT strength on high / ultra (ART_BIBLE §4.7). */
export const LUT_STRENGTH = 0.35;

export interface FinalFeatures {
  bloom: boolean;
  shafts: boolean;
  dirt: boolean;
  lut: boolean;
  chromaticAberration: boolean;
  grade: boolean;
  vignette: boolean;
  /** FXAA merged into this pass (low tier). */
  fxaa: boolean;
  toneMapper: ToneMapper;
}

/** FXAA 3.11 "lite" on tone-mapped taps (inputs HDR, output display-referred). */
const FXAA_GLSL = /* glsl */ `
vec3 samDisplayAt( vec2 uv ) {
  return samEncode( texture2D( tHdr, uv ).rgb );
}
vec3 samFxaa( vec2 uv ) {
  vec2 px = uTexel;
  vec3 rgbNW = samDisplayAt( uv + vec2( -1.0, -1.0 ) * px );
  vec3 rgbNE = samDisplayAt( uv + vec2( 1.0, -1.0 ) * px );
  vec3 rgbSW = samDisplayAt( uv + vec2( -1.0, 1.0 ) * px );
  vec3 rgbSE = samDisplayAt( uv + vec2( 1.0, 1.0 ) * px );
  vec3 rgbM = samDisplayAt( uv );
  vec3 lw = vec3( 0.299, 0.587, 0.114 );
  float lNW = dot( rgbNW, lw );
  float lNE = dot( rgbNE, lw );
  float lSW = dot( rgbSW, lw );
  float lSE = dot( rgbSE, lw );
  float lM = dot( rgbM, lw );
  float lMin = min( lM, min( min( lNW, lNE ), min( lSW, lSE ) ) );
  float lMax = max( lM, max( max( lNW, lNE ), max( lSW, lSE ) ) );
  if ( lMax - lMin < max( 0.0312, lMax * 0.125 ) ) return rgbM;
  vec2 dir = vec2( -( ( lNW + lNE ) - ( lSW + lSE ) ), ( lNW + lSW ) - ( lNE + lSE ) );
  float dirReduce = max( ( lNW + lNE + lSW + lSE ) * ( 0.25 * 0.125 ), 1.0 / 128.0 );
  float rcpDirMin = 1.0 / ( min( abs( dir.x ), abs( dir.y ) ) + dirReduce );
  dir = clamp( dir * rcpDirMin, vec2( -8.0 ), vec2( 8.0 ) ) * px;
  vec3 rgbA = 0.5 * ( samDisplayAt( uv + dir * ( 1.0 / 3.0 - 0.5 ) ) + samDisplayAt( uv + dir * ( 2.0 / 3.0 - 0.5 ) ) );
  vec3 rgbB = rgbA * 0.5 + 0.25 * ( samDisplayAt( uv + dir * -0.5 ) + samDisplayAt( uv + dir * 0.5 ) );
  float lB = dot( rgbB, lw );
  return ( lB < lMin || lB > lMax ) ? rgbA : rgbB;
}
`;

const FINAL_FRAG = /* glsl */ `
precision highp sampler3D;
uniform sampler2D tHdr;
uniform sampler2D tBloom;
uniform sampler2D tShafts;
uniform sampler2D tDirt;
uniform sampler3D tLutA;
uniform sampler3D tLutB;
uniform float uLutSizeA;
uniform float uLutSizeB;
uniform float uLutMix;
uniform float uLutStrength;
uniform float uExposure;
uniform float uBloom;
uniform float uDirt;
uniform vec3 uShaftTint;
uniform float uContrast;
uniform float uSaturation;
uniform float uWarmth;
uniform float uLift;
uniform float uVignette;
uniform vec3 uTint;
uniform float uAspect;
uniform float uGrain;
uniform float uCA;
uniform float uSharpen;
uniform float uTime;
uniform vec2 uTexel;
varying vec2 vUv;
${TONEMAP_GLSL}
${NOISE_GLSL}
${SAMRAJYA_LUT_GLSL}
vec3 samTonemap( vec3 c ) {
#ifdef TONEMAP_AGX
  return samAgX( c, uExposure );
#else
  return samACES( c, uExposure );
#endif
}
vec3 samEncode( vec3 hdr ) {
  return samLinearToSRGB( samTonemap( max( hdr, vec3( 0.0 ) ) ) );
}
#ifdef SAM_FXAA
${FXAA_GLSL}
#endif
void main() {
  vec2 uv = vUv;
#ifdef SAM_FXAA
  vec3 col = samFxaa( uv );
#else
  vec3 hdr = texture2D( tHdr, uv ).rgb;
  #ifdef USE_CA
  if ( uCA > 0.0 ) {
    vec2 o = ( uv - 0.5 ) * ( 2.0 * uCA );
    hdr.r = texture2D( tHdr, uv - o ).r;
    hdr.b = texture2D( tHdr, uv + o ).b;
  }
  #endif
  if ( uSharpen > 0.0 ) {
    vec3 n = texture2D( tHdr, uv + vec2( uTexel.x, 0.0 ) ).rgb + texture2D( tHdr, uv - vec2( uTexel.x, 0.0 ) ).rgb
      + texture2D( tHdr, uv + vec2( 0.0, uTexel.y ) ).rgb + texture2D( tHdr, uv - vec2( 0.0, uTexel.y ) ).rgb;
    // Sharpen relative to local luminance so bright edges do not ring.
    float lc = samLuma( hdr );
    float ln = samLuma( n ) * 0.25;
    hdr *= 1.0 + uSharpen * clamp( ( lc - ln ) / max( ln, 1e-4 ), -0.5, 0.5 );
  }
  #ifdef USE_SHAFTS
  hdr += texture2D( tShafts, uv ).rgb * uShaftTint;
  #endif
  #ifdef USE_BLOOM
  vec3 bloom = texture2D( tBloom, uv ).rgb * uBloom;
  hdr += bloom;
    #ifdef USE_DIRT
  hdr += bloom * texture2D( tDirt, uv ).rgb * uDirt;
    #endif
  #endif
  vec3 col = samEncode( hdr );
#endif
#ifdef USE_GRADE
  col *= uTint;
  col += vec3( uWarmth * 0.04, uWarmth * 0.012, -uWarmth * 0.04 ) * ( 0.5 + col );
  float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
  col = mix( vec3( l ), col, uSaturation );
  col = ( col - 0.5 ) * uContrast + 0.5;
  col += uLift * ( 1.0 - col );
  col = clamp( col, 0.0, 1.0 );
#endif
#ifdef USE_LUT
  if ( uLutStrength > 0.0 ) {
    vec3 graded = samrajyaLut( tLutA, col, uLutSizeA );
    if ( uLutMix < 1.0 ) graded = mix( samrajyaLut( tLutB, col, uLutSizeB ), graded, uLutMix );
    col = mix( col, graded, uLutStrength );
  }
#endif
#ifdef USE_VIGNETTE
  vec2 p = ( uv - 0.5 ) * vec2( uAspect, 1.0 );
  float v = smoothstep( 0.95, 0.25, length( p ) * 1.05 );
  col *= mix( 1.0, v, uVignette );
#endif
  vec2 fc = gl_FragCoord.xy;
  if ( uGrain > 0.0 ) {
    float gn = samHash( fc + fract( uTime * 13.17 ) * 811.0 ) - 0.5;
    float lum = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
    col += gn * uGrain * 2.0 * ( 1.0 - lum * 0.6 );
  }
  // Triangular dither (8-bit banding in sky gradients and fog).
  float dith = samHash( fc + 0.37 ) + samHash( fc.yx + 11.3 ) - 1.0;
  col += dith / 255.0;
  gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), 1.0 );
}
`;

/** A 2^3 identity LUT (trilinear between the corners = identity). */
export function identityLut(): THREE.Data3DTexture {
  const data = new Uint8Array(2 * 2 * 2 * 4);
  for (let b = 0; b < 2; b++)
    for (let g = 0; g < 2; g++)
      for (let r = 0; r < 2; r++) {
        const i = ((b * 2 + g) * 2 + r) * 4;
        data[i] = r * 255;
        data[i + 1] = g * 255;
        data[i + 2] = b * 255;
        data[i + 3] = 255;
      }
  const t = new THREE.Data3DTexture(data, 2, 2, 2);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.unpackAlignment = 1;
  t.name = 'post.lut.identity';
  t.needsUpdate = true;
  return t;
}

export class FinalPass extends QuadPass {
  readonly name = 'final';
  /** Lens-dirt intensity applied to bloom (ultra). */
  dirtIntensity = 0;
  /** Named 'SamrajyaGrade' (asset viewer contract). */
  readonly material: THREE.ShaderMaterial;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(
    private readonly frame: PostFrame,
    readonly features: FinalFeatures,
    private readonly neutral: { black: THREE.Texture; lut: THREE.Data3DTexture },
  ) {
    super();
    this.needsSwap = true;
    const defines: Record<string, number> = {};
    if (features.bloom) defines.USE_BLOOM = 1;
    if (features.shafts) defines.USE_SHAFTS = 1;
    if (features.dirt && features.bloom) defines.USE_DIRT = 1;
    if (features.lut) defines.USE_LUT = 1;
    if (features.chromaticAberration) defines.USE_CA = 1;
    if (features.grade) defines.USE_GRADE = 1;
    if (features.vignette) defines.USE_VIGNETTE = 1;
    if (features.fxaa) defines.SAM_FXAA = 1;
    if (features.toneMapper === 'agx') defines.TONEMAP_AGX = 1;
    this.material = postMaterial(
      'SamrajyaGrade',
      FINAL_FRAG,
      {
        tHdr: { value: null },
        tBloom: { value: neutral.black },
        tShafts: { value: neutral.black },
        tDirt: { value: neutral.black },
        tLutA: { value: neutral.lut },
        tLutB: { value: neutral.lut },
        uLutSizeA: { value: 2 },
        uLutSizeB: { value: 2 },
        uLutMix: { value: 1 },
        uLutStrength: { value: 0 },
        uExposure: { value: 1 },
        uBloom: { value: 0 },
        uDirt: { value: 0 },
        uShaftTint: { value: new THREE.Vector3(1, 1, 1) },
        uContrast: { value: 1 },
        uSaturation: { value: 1 },
        uWarmth: { value: 0 },
        uLift: { value: 0 },
        uVignette: { value: 0 },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uAspect: { value: 1 },
        uGrain: { value: 0 },
        uCA: { value: 0 },
        uSharpen: { value: 0 },
        uTime: { value: 0 },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      defines,
    );
    this.uniforms = this.material.uniforms;
  }

  override setSize(width: number, height: number): void {
    (this.uniforms.uTexel!.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
    this.uniforms.uAspect!.value = width / Math.max(1, height);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget): void {
    const f = this.frame;
    const u = this.uniforms;
    u.tHdr!.value = f.hdr;
    u.uTime!.value = f.time;
    u.tBloom!.value = f.bloom ?? this.neutral.black;
    u.uBloom!.value = f.bloom ? f.bloomIntensity : 0;
    u.uDirt!.value = f.bloom ? this.dirtIntensity : 0;
    u.tShafts!.value = f.shafts ?? this.neutral.black;
    this.draw(renderer, this.material, this.renderToScreen ? null : writeBuffer);
  }

  override dispose(): void {
    super.dispose();
    this.material.dispose();
  }
}
