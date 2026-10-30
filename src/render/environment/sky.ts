/**
 * Sky, sun, moon and the image-based lighting source (ART_BIBLE §4.4 IBL calibration, §4.5 sky-dome fog, §4.6
 * night). OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01). Driven by EnvironmentRig.
 *
 * Two shader variants of one sky model (`buildSkyShader`):
 * - ENV BAKE (rendered into cube maps for the PMREM and the irradiance readback): the three.js Preetham model
 *   WITHOUT the sun-disc term (`L0 += vSunE * 19000 * Fex * sundisk` is gone), a procedural cloud layer, the night
 *   gradient (#0f1326 zenith -> #1b2236 horizon) below -4 deg solar elevation and a ground bounce below the horizon.
 *   Never contains the sun, moon or stars: the sun reaches surfaces through the DirectionalLight only (no double
 *   counting).
 * - VISIBLE DOME (far-plane sphere, drawn after opaque geometry so only sky pixels shade): the same sky scaled by
 *   the IBL calibration factor, plus the HDR sun (WP7 `sun_sprite` x hdrScale 50, or a procedural limb-darkened
 *   disc + aureole of luminance 50 - the bloom and shaft source), the moon, stars, sky-dome fog (d = 20 km, clamp
 *   0.6), lightning (+2 EV) and, below the horizon, the horizon ring colour the material aerial perspective fades
 *   the map edge into (no terrain/sky seam).
 *
 * Calibration: `bake()` renders the env variant into a 32 px float cube, reads it back once per bake and measures
 * the horizontal sky irradiance (`sourceIrradiance`); the rig sets scene.environmentIntensity = backgroundIntensity
 * = r.skyIrradiance / sourceIrradiance (environmentIntensityFor). Baked HDR skies (assets on) use the manifest
 * `ambientIrradiance` instead, are rotated so their sun matches the solar path and cross-fade over 2 s.
 */
import * as THREE from 'three';
import type { EnvironmentState } from '../../core/types';
import { LIGHTING_PRESETS, type LightingPresetId, type ResolvedLighting } from '../style/lighting';
import { hexToLinear } from '../style/palette';
import { FOG_MATH_GLSL } from './atmosphere/fogMath';
import { SAM_GLOBALS } from '../materials/chunks/globals';
import { cubeHorizontalIrradiance, sampleCubeFaces } from '../lighting/ibl';

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

/** ART_BIBLE §4.4 rule 3: the night sky fallback. */
export const NIGHT_SKY = { zenith: '#0f1326', horizon: '#1b2236', irradiance: 0.08, belowDeg: -4 } as const;
/** Solar elevations (deg) over which the procedural day sky hands over to the night gradient (centred on -4). */
export const NIGHT_BLEND_DEG: readonly [number, number] = [-2, -6];
/** Visible sun: angular radius of the procedural disc (deg), its luminance, and the sprite's half width (deg). */
export const SUN_VISUAL = { discRadiusDeg: 0.32, luminance: 50, spriteHalfDeg: 3 } as const;
/** Visible moon (night key light source): angular radius (deg) and luminance (blooms at the night threshold). */
export const MOON_VISUAL = { discRadiusDeg: 0.7, luminance: 3.2 } as const;
/** Cross-fade time between baked skies (ART_BIBLE §4.4 rule 4). */
export const BAKED_SKY_FADE_S = 2;
/** Irradiance readback cube size (px per face). */
export const IRRADIANCE_CUBE_SIZE = 32;

const PRESET_WEIGHT_KEYS: readonly [keyof ResolvedLighting['weights'], LightingPresetId][] = [
  ['night', 'night'],
  ['dusk', 'dusk'],
  ['dawn', 'dawn'],
  ['golden', 'golden'],
  ['noon', 'noon'],
];

/** Preetham parameters blended like the resolver: time-of-day weights, then weather overlays. Writes into `out`. */
export function preethamFor(r: ResolvedLighting, out: THREE.Vector4): THREE.Vector4 {
  let t = 0;
  let ray = 0;
  let mie = 0;
  let g = 0;
  let sum = 0;
  for (const [k, id] of PRESET_WEIGHT_KEYS) {
    const w = r.weights[k];
    if (w <= 0) continue;
    const p = LIGHTING_PRESETS[id].sky.preetham;
    t += p.turbidity * w;
    ray += p.rayleigh * w;
    mie += p.mieCoefficient * w;
    g += p.mieDirectionalG * w;
    sum += w;
  }
  if (sum <= 0) {
    const p = LIGHTING_PRESETS.noon.sky.preetham;
    t = p.turbidity;
    ray = p.rayleigh;
    mie = p.mieCoefficient;
    g = p.mieDirectionalG;
    sum = 1;
  }
  out.set(t / sum, ray / sum, mie / sum, g / sum);
  const overlay = (id: LightingPresetId, w: number): void => {
    if (w <= 0) return;
    const p = LIGHTING_PRESETS[id].sky.preetham;
    out.x += (p.turbidity - out.x) * w;
    out.y += (p.rayleigh - out.y) * w;
    out.z += (p.mieCoefficient - out.z) * w;
    out.w += (p.mieDirectionalG - out.w) * w;
  };
  overlay('monsoon', r.weights.monsoon);
  overlay('dry_haze', r.weights.haze);
  overlay('winter_fog', r.weights.fog);
  return out;
}

// ---------------------------------------------------------------------------------------------------- shader

const SKY_VERTEX = /* glsl */ `
uniform vec3 uSunDir;
uniform vec4 uPreetham; // turbidity, rayleigh, mie coefficient, mie g
varying vec3 vDir;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;
varying float vSunfade;
const float e = 2.71828182845904523536028747135266249775724709369995957;
const float pi = 3.141592653589793238462643383279502884197169;
const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );
const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );
const float cutoffAngle = 1.6110731556870734;
const float steepness = 1.5;
const float EE = 1000.0;
float sunIntensity( float zenithAngleCos ) {
  zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );
  return EE * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness ) ) );
}
vec3 totalMie( float T ) {
  float c = ( 0.2 * T ) * 10E-18;
  return 0.434 * c * MieConst;
}
void main() {
  vDir = position;
  vSunE = sunIntensity( uSunDir.y );
  vSunfade = 1.0 - clamp( 1.0 - exp( ( uSunDir.y * 1000.0 / 450000.0 ) ), 0.0, 1.0 );
  float rayleighCoefficient = uPreetham.y - ( 1.0 * ( 1.0 - vSunfade ) );
  vBetaR = totalRayleigh * rayleighCoefficient;
  vBetaM = totalMie( uPreetham.x ) * uPreetham.z;
#ifdef SAM_ENV_BAKE
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
#else
  // Infinitely far, centred on the camera: rotation-only view transform, depth pinned to the far plane.
  vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
  gl_Position = p.xyww;
#endif
}
`;

/** Common fragment body. The sun-disc term of three's Sky is deliberately absent (ART_BIBLE §4.4 rule 1). */
const SKY_FRAGMENT_COMMON = /* glsl */ `
uniform vec3 uSunDir;
uniform vec4 uPreetham;
uniform vec4 uNight;       // x = night weight, y = cloud darkening at night, zw unused
uniform vec3 uNightZenith;
uniform vec3 uNightHorizon;
uniform vec4 uCloud;       // x = coverage 0..1, y = brightness, zw = scroll offset
uniform vec3 uGround;      // ground bounce albedo (env bake, below the horizon)
varying vec3 vDir;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;
varying float vSunfade;
const float pi = 3.141592653589793238462643383279502884197169;
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
const float ONE_OVER_FOURPI = 0.07957747154594767;
const vec3 up = vec3( 0.0, 1.0, 0.0 );
float rayleighPhase( float cosTheta ) { return THREE_OVER_SIXTEENPI * ( 1.0 + cosTheta * cosTheta ); }
float hgPhase( float cosTheta, float g ) {
  float g2 = g * g;
  float inverse = 1.0 / pow( max( 1.0 - 2.0 * g * cosTheta + g2, 1e-6 ), 1.5 );
  return ONE_OVER_FOURPI * ( ( 1.0 - g2 ) * inverse );
}
// Preetham sky radiance (three.js Sky) WITHOUT the solar disc.
vec3 samPreetham( vec3 direction ) {
  float zenithAngle = acos( max( 0.0, dot( up, direction ) ) );
  float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( max( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), 1e-3 ), -1.253 ) );
  float sR = rayleighZenithLength * inverse;
  float sM = mieZenithLength * inverse;
  vec3 Fex = exp( -( vBetaR * sR + vBetaM * sM ) );
  float cosTheta = dot( direction, uSunDir );
  float rPhase = rayleighPhase( cosTheta * 0.5 + 0.5 );
  vec3 betaRTheta = vBetaR * rPhase;
  float mPhase = hgPhase( cosTheta, uPreetham.w );
  vec3 betaMTheta = vBetaM * mPhase;
  // Every pow() base is kept > 0: SwiftShader evaluates pow(0, y) as exp2(y * log2(0)) = NaN (night: vSunE = 0).
  vec3 Lin = pow( max( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1e-12 ) ), vec3( 1.5 ) );
  float horizonFade = 1.0 - clamp( dot( up, uSunDir ), 0.0, 1.0 );
  Lin *= mix( vec3( 1.0 ), sqrt( max( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 0.0 ) ) ), clamp( horizonFade * horizonFade * horizonFade * horizonFade * horizonFade, 0.0, 1.0 ) );
  vec3 L0 = vec3( 0.1 ) * Fex;
  vec3 texColor = ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );
  return pow( max( texColor, vec3( 1e-12 ) ), vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) );
}
float samSkyHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float samSkyNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( samSkyHash( i ), samSkyHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( samSkyHash( i + vec2( 0.0, 1.0 ) ), samSkyHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float samCloudFbm( vec2 p ) {
  float a = 0.5;
  float s = 0.0;
  for ( int i = 0; i < 5; i++ ) {
    s += a * samSkyNoise( p );
    p = mat2( 1.6, 1.2, -1.2, 1.6 ) * p + 3.17;
    a *= 0.5;
  }
  return s / 0.96875;
}
// Clouds on a plane: rgb = colour relative to the clear sky, a = coverage. Night darkens them (they hide stars).
vec4 samClouds( vec3 dir, vec3 clear ) {
  if ( uCloud.x <= 0.001 || dir.y <= 0.0 ) return vec4( 0.0 );
  vec2 p = dir.xz / ( dir.y + 0.08 ) * 0.9 + uCloud.zw;
  vec2 warp = vec2( samSkyNoise( p * 0.7 + 11.0 ), samSkyNoise( p * 0.7 - 7.0 ) ) - 0.5;
  float n = samCloudFbm( p * 1.3 + warp * 0.8 );
  float cov = uCloud.x;
  float d = smoothstep( 1.0 - cov - 0.08, 1.0 - cov + 0.32, n );
  d *= smoothstep( 0.0, 0.1, dir.y );
  float lum = dot( clear, vec3( 0.2126, 0.7152, 0.0722 ) );
  float fwd = pow( max( dot( dir, uSunDir ), 1e-6 ), 6.0 );
  float bright = mix( 1.9, 0.72, cov ) * uCloud.y;
  // Thick parts are darker underneath; thin edges catch the light (silver lining toward the sun).
  float body = mix( 1.15, 0.78, smoothstep( 0.35, 1.0, d ) );
  vec3 col = vec3( lum * bright * body ) * vec3( 1.0, 0.985, 0.96 ) + clear * fwd * 1.6 * ( 1.0 - d ) * ( 1.0 - cov );
  col = mix( col, col * uNight.y, uNight.x );
  return vec4( col, d );
}
vec3 samSkyRadiance( vec3 dir, out float cloudA ) {
  vec3 hd = normalize( vec3( dir.x, max( dir.y, 0.0 ), dir.z ) + vec3( 0.0, 1e-4, 0.0 ) );
  vec3 day = samPreetham( hd );
  vec3 night = mix( uNightHorizon, uNightZenith, sqrt( clamp( dir.y, 0.0, 1.0 ) ) );
  vec3 clear = mix( day, night, uNight.x );
  vec4 c = samClouds( hd, clear );
  cloudA = c.a;
  return mix( clear, c.rgb, c.a );
}
`;

const SKY_FRAGMENT_ENV = /* glsl */ `
${SKY_FRAGMENT_COMMON}
void main() {
  vec3 dir = normalize( vDir );
  float cloudA;
  vec3 col = samSkyRadiance( dir, cloudA );
  // Lower hemisphere: ground bounce (dim, earth-coloured) so IBL undersides are lit, like the baked skies.
  float below = smoothstep( 0.0, -0.08, dir.y );
  col = mix( col, col * uGround, below );
  gl_FragColor = vec4( col, 1.0 );
}
`;

const SKY_FRAGMENT_VISIBLE = /* glsl */ `
${FOG_MATH_GLSL}
${SKY_FRAGMENT_COMMON}
uniform vec4 uScale;        // x = IBL calibration (procedural), y = lightning multiplier, z = procedural weight, w = time
uniform vec3 uSunColor;     // tint x luminance x visibility of the sun disc
uniform vec4 uSun;          // x = disc radius (rad), y = sprite half size tan, z = has sprite, w = unused
uniform sampler2D uSunTex;
uniform vec3 uMoonDir;
uniform vec4 uMoon;         // x = disc radius (rad), y = luminance x visibility, z = star intensity, w = unused
uniform sampler2D uBakedA;
uniform sampler2D uBakedB;
uniform vec4 uBaked;        // x = weight A, y = weight B, z = yaw A, w = yaw B
uniform vec2 uBakedScale;   // calibration of A and B
vec2 samEquirectUv( vec3 dir, float yaw ) {
  float c = cos( yaw ), s = sin( yaw );
  vec3 d = vec3( c * dir.x + s * dir.z, dir.y, -s * dir.x + c * dir.z );
  float u = atan( d.z, d.x ) * 0.15915494309189535 + 0.5;
  float v = asin( clamp( d.y, -1.0, 1.0 ) ) * 0.3183098861837907 + 0.5;
  return vec2( u, v );
}
vec3 samSunDisc( vec3 dir ) {
  vec3 sd = uSunDir;
  float c = dot( dir, sd );
  if ( c < 0.98 ) return vec3( 0.0 );
  if ( uSun.z > 0.5 ) {
    vec3 right = normalize( cross( sd, abs( sd.y ) > 0.99 ? vec3( 1.0, 0.0, 0.0 ) : vec3( 0.0, 1.0, 0.0 ) ) );
    vec3 upv = cross( right, sd );
    vec2 q = vec2( dot( dir, right ), dot( dir, upv ) ) / ( c * uSun.y );
    if ( abs( q.x ) >= 1.0 || abs( q.y ) >= 1.0 ) return vec3( 0.0 );
    return texture2D( uSunTex, q * 0.5 + 0.5 ).rgb * uSun.w;
  }
  float ang = acos( clamp( c, -1.0, 1.0 ) );
  float r = uSun.x;
  float disc = 1.0 - smoothstep( r * 0.9, r, ang );
  float mu = sqrt( max( 0.0, 1.0 - min( 1.0, ang / r ) * min( 1.0, ang / r ) ) );
  float limb = 1.0 - 0.55 * ( 1.0 - mu );
  float aureole = 0.035 * exp( -ang / ( r * 2.2 ) ) + 0.004 * exp( -ang / ( r * 9.0 ) );
  return vec3( disc * limb + aureole );
}
vec3 samMoonDisc( vec3 dir ) {
  float c = dot( dir, uMoonDir );
  if ( uMoon.y <= 0.0 || c < 0.99 ) return vec3( 0.0 );
  float ang = acos( clamp( c, -1.0, 1.0 ) );
  float r = uMoon.x;
  float disc = 1.0 - smoothstep( r * 0.92, r, ang );
  vec3 right = normalize( cross( uMoonDir, vec3( 0.0, 1.0, 0.0 ) ) );
  vec3 upv = cross( right, uMoonDir );
  vec2 q = vec2( dot( dir, right ), dot( dir, upv ) ) / r;
  float maria = samSkyNoise( q * 2.3 + 4.0 ) * 0.6 + samSkyNoise( q * 5.1 - 2.0 ) * 0.4;
  float albedo = mix( 1.0, 0.62, smoothstep( 0.45, 0.75, maria ) );
  float halo = 0.012 * exp( -ang / ( r * 5.0 ) );
  return vec3( 0.93, 0.95, 1.0 ) * ( disc * albedo + halo ) * uMoon.y;
}
float samStars( vec3 dir ) {
  if ( uMoon.z <= 0.0 || dir.y <= 0.0 ) return 0.0;
  vec3 p = dir * 260.0;
  vec3 cell = floor( p );
  float h = samSkyHash( cell.xy + cell.z * 17.13 );
  if ( h < 0.9975 ) return 0.0;
  vec3 f = fract( p ) - 0.5;
  float s = smoothstep( 0.3, 0.0, length( f ) );
  float tw = 0.75 + 0.25 * sin( uScale.w * ( 2.0 + h * 9.0 ) + h * 100.0 );
  return s * tw * ( h - 0.9975 ) * 400.0 * smoothstep( 0.0, 0.25, dir.y );
}
void main() {
  vec3 dir = normalize( vDir );
  float cloudA = 0.0;
  vec3 sky = vec3( 0.0 );
  if ( uScale.z > 0.0 ) {
    sky = samSkyRadiance( dir, cloudA ) * ( uScale.x * uScale.z );
  }
  if ( uBaked.x > 0.0 ) sky += texture2D( uBakedA, samEquirectUv( dir, uBaked.z ) ).rgb * uBakedScale.x * uBaked.x;
  if ( uBaked.y > 0.0 ) sky += texture2D( uBakedB, samEquirectUv( dir, uBaked.w ) ).rgb * uBakedScale.y * uBaked.y;
  float clear = 1.0 - cloudA * uScale.z;
  sky += samSunDisc( dir ) * uSunColor * clear;
  sky += samMoonDisc( dir ) * clear;
  sky += vec3( 0.85, 0.9, 1.0 ) * samStars( dir ) * uMoon.z * uScale.z * clear;
  sky = samSkyDomeFog( sky, dir );
  // Below the horizon the dome shows the horizon ring, the colour distant terrain and the map edge fade into.
  if ( samG[ SAM_G_HORIZON_RING ].w > 0.5 ) sky = mix( sky, samHorizon( dir ), smoothstep( 0.035, -0.02, dir.y ) );
  sky *= uScale.y;
  gl_FragColor = vec4( sky, 1.0 );
}
`;

/** Shader sources for a sky variant. `envBake` = the PMREM / irradiance source (no sun disc, moon, stars or fog). */
export function buildSkyShader(opts: { envBake: boolean }): { vertexShader: string; fragmentShader: string; defines: Record<string, string> } {
  return {
    vertexShader: SKY_VERTEX,
    fragmentShader: opts.envBake ? SKY_FRAGMENT_ENV : SKY_FRAGMENT_VISIBLE,
    defines: opts.envBake ? { SAM_ENV_BAKE: '' } : {},
  };
}

// ---------------------------------------------------------------------------------------------------- assets

/** Structural subset of the AssetManager the sky needs (keeps render/ free of an assets/ runtime import). */
export interface SkyAssetSource {
  readonly enabled?: boolean;
  has?(id: string): boolean;
  loadHdri(id: string): Promise<SkyHdriHandle | null>;
  loadImage?(id: string): Promise<SkyImageHandle | null>;
}
export interface SkyHdriHandle {
  readonly texture: THREE.Texture;
  readonly envMap: THREE.Texture;
  readonly sun: { readonly azimuthDeg: number; readonly elevationDeg: number };
  readonly entry: { readonly id: string; readonly ambientIrradiance: number };
  release(): void;
}
export interface SkyImageHandle {
  readonly texture: THREE.Texture;
  readonly hdrScale: number;
  release(): void;
}

interface BakedSlot {
  id: string;
  handle: SkyHdriHandle;
  /** Yaw (rad) aligning the bake's sun azimuth with the solar path. */
  yaw: number;
}

// ---------------------------------------------------------------------------------------------------- system

const DEG = Math.PI / 180;

/** Result of an IBL bake. */
export interface SkyBake {
  /** PMREM texture for scene.environment (null with envMapSize 0). */
  envMap: THREE.Texture | null;
  /** Horizontal irradiance of the env source (sun excluded) in game units. */
  sourceIrradiance: number;
  /** environmentRotation yaw (rad) for baked skies (0 for the procedural sky). */
  yaw: number;
}

export class SkySystem {
  /** Visible dome (far plane). Add to the scene once; renders after opaque geometry. */
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly moonDir = new THREE.Vector3(0, 1, 0);
  /** Night weight 0..1 (procedural night gradient + moon + stars). */
  night = 0;
  private readonly envMaterial: THREE.ShaderMaterial;
  private readonly envScene = new THREE.Scene();
  private readonly envMesh: THREE.Mesh;
  private readonly shared: Record<string, THREE.IUniform>;
  private readonly visible: Record<string, THREE.IUniform>;
  private irrTarget: THREE.WebGLCubeRenderTarget | null = null;
  private irrCamera: THREE.CubeCamera | null = null;
  private cubeTarget: THREE.WebGLCubeRenderTarget | null = null;
  private cubeCamera: THREE.CubeCamera | null = null;
  private pmremTarget: THREE.WebGLRenderTarget | null = null;
  private readonly faces: Float32Array[] = [];
  private readonly white: THREE.DataTexture;
  private lastBakeKey = '';
  private measured = 0;
  /** Linear RGB of the raw (uncalibrated) env sky at 8 horizon azimuths, from the last readback. */
  readonly horizonRaw: Float32Array = new Float32Array(8 * 3);
  horizonValid = false;
  private sprite: SkyImageHandle | null = null;
  // Baked skies.
  private assets: SkyAssetSource | null = null;
  private bakedCurrent: BakedSlot | null = null;
  private bakedPrevious: BakedSlot | null = null;
  private bakedFade = 1;
  private bakedWanted: string | null = null;
  private bakedLoading: string | null = null;
  private bakedGen = 0;
  private readonly bakedBlend: { rt: THREE.WebGLRenderTarget | null; material: THREE.ShaderMaterial | null; pmrem: THREE.WebGLRenderTarget | null; scene: THREE.Scene | null; camera: THREE.OrthographicCamera | null; nextBakeIn: number } = {
    rt: null,
    material: null,
    pmrem: null,
    scene: null,
    camera: null,
    nextBakeIn: 0,
  };
  private disposed = false;

  constructor(
    private readonly pmrem: THREE.PMREMGenerator,
    private envMapSize: number,
    private readonly renderer: THREE.WebGLRenderer | null = null,
  ) {
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;
    const nz = hexToLinear(NIGHT_SKY.zenith);
    const nh = hexToLinear(NIGHT_SKY.horizon);
    this.shared = {
      uSunDir: { value: this.sunDir },
      uPreetham: { value: new THREE.Vector4(3.2, 1.6, 0.005, 0.82) },
      uNight: { value: new THREE.Vector4(0, 0.35, 0, 0) },
      uNightZenith: { value: new THREE.Color().setRGB(nz[0], nz[1], nz[2]) },
      uNightHorizon: { value: new THREE.Color().setRGB(nh[0], nh[1], nh[2]) },
      uCloud: { value: new THREE.Vector4(0, 1, 0, 0) },
      uGround: { value: new THREE.Color(0.24, 0.2, 0.15) },
    };
    this.visible = {
      ...this.shared,
      uScale: { value: new THREE.Vector4(1, 1, 1, 0) },
      uSunColor: { value: new THREE.Color(SUN_VISUAL.luminance, SUN_VISUAL.luminance, SUN_VISUAL.luminance) },
      uSun: { value: new THREE.Vector4(SUN_VISUAL.discRadiusDeg * DEG, Math.tan(SUN_VISUAL.spriteHalfDeg * DEG), 0, 1) },
      uSunTex: { value: this.white },
      uMoonDir: { value: this.moonDir },
      uMoon: { value: new THREE.Vector4(MOON_VISUAL.discRadiusDeg * DEG, 0, 0, 0) },
      uBakedA: { value: this.white },
      uBakedB: { value: this.white },
      uBaked: { value: new THREE.Vector4(0, 0, 0, 0) },
      uBakedScale: { value: new THREE.Vector2(1, 1) },
      samG: SAM_GLOBALS,
    };
    const vis = buildSkyShader({ envBake: false });
    const material = new THREE.ShaderMaterial({
      name: 'SamrajyaSky',
      uniforms: this.visible,
      vertexShader: vis.vertexShader,
      fragmentShader: vis.fragmentShader,
      defines: vis.defines,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    // Opaque, after the world: only pixels the scene left at the far plane run the sky shader.
    this.mesh.renderOrder = 1e6;
    this.mesh.matrixAutoUpdate = false;
    const env = buildSkyShader({ envBake: true });
    this.envMaterial = new THREE.ShaderMaterial({
      name: 'SamrajyaSkyEnv',
      uniforms: this.shared,
      vertexShader: env.vertexShader,
      fragmentShader: env.fragmentShader,
      defines: env.defines,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    this.envMesh = new THREE.Mesh(this.mesh.geometry, this.envMaterial);
    this.envMesh.scale.setScalar(100);
    this.envMesh.frustumCulled = false;
    this.envScene.add(this.envMesh);
  }

  // ---------------------------------------------------------------- inputs

  /** Legacy entry (sun from the solar path, Preetham from weather). The rig calls setLighting() instead. */
  setEnvironment(env: EnvironmentState): void {
    sunDirection(env, this.sunDir);
    this.shared.uCloud!.value.x = Math.min(1, env.weather.cloudCover);
  }

  /**
   * Apply resolved lighting: sun / moon directions (unit, toward the light), Preetham blend, night weight, clouds.
   * Cheap; changes that matter for the IBL mark the bake dirty (see bakeKey()).
   */
  setLighting(r: ResolvedLighting, sunDir: THREE.Vector3, moonDir: THREE.Vector3, cloudCover: number, groundAlbedo?: readonly [number, number, number]): void {
    this.sunDir.copy(sunDir);
    this.moonDir.copy(moonDir);
    preethamFor(r, this.shared.uPreetham!.value as THREE.Vector4);
    const elev = Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1)) / DEG;
    const t = THREE.MathUtils.clamp((NIGHT_BLEND_DEG[0] - elev) / (NIGHT_BLEND_DEG[0] - NIGHT_BLEND_DEG[1]), 0, 1);
    this.night = t * t * (3 - 2 * t);
    const n = this.shared.uNight!.value as THREE.Vector4;
    n.x = this.night;
    const c = this.shared.uCloud!.value as THREE.Vector4;
    c.x = THREE.MathUtils.clamp(cloudCover, 0, 1);
    if (groundAlbedo) (this.shared.uGround!.value as THREE.Color).setRGB(groundAlbedo[0], groundAlbedo[1], groundAlbedo[2]);
    // Sun visibility: fades as it sets, tinted by the resolved sun colour; dimmer when the key light is dimmer.
    const vis = THREE.MathUtils.smoothstep(elev, -1.2, 0.6);
    const rel = THREE.MathUtils.clamp(r.sunIntensity / 3.4, 0.25, 1.4);
    (this.visible.uSunColor!.value as THREE.Color).setRGB(r.sunColor[0], r.sunColor[1], r.sunColor[2]).multiplyScalar(SUN_VISUAL.luminance * vis * rel * (1 - this.night));
    const moon = this.visible.uMoon!.value as THREE.Vector4;
    const moonUp = THREE.MathUtils.smoothstep(moonDir.y, -0.02, 0.08);
    moon.y = MOON_VISUAL.luminance * this.night * moonUp;
    moon.z = this.night * (1 - c.x * 0.85);
  }

  /** Sky calibration (visible dome), lightning multiplier and the animation clock. Per frame, allocation-free. */
  setFrame(calibration: number, flash: number, time: number, windX: number, windZ: number): void {
    const s = this.visible.uScale!.value as THREE.Vector4;
    s.x = calibration;
    s.y = flash;
    s.w = time;
    const c = this.shared.uCloud!.value as THREE.Vector4;
    // Clouds drift with the wind (very slowly: they are ~2 km up).
    c.z = windX * time * 0.0006;
    c.w = windZ * time * 0.0006;
  }

  /** Use the WP7 sun sprite (null = procedural disc). */
  setSunSprite(handle: SkyImageHandle | null): void {
    this.sprite?.release();
    this.sprite = handle;
    const u = this.visible.uSun!.value as THREE.Vector4;
    if (handle) {
      this.visible.uSunTex!.value = handle.texture;
      u.z = 1;
      // The sprite stores L / hdrScale; the tint already carries luminance 50 - rescale to the sprite's own scale.
      u.w = handle.hdrScale / SUN_VISUAL.luminance;
    } else {
      this.visible.uSunTex!.value = this.white;
      u.z = 0;
      u.w = 1;
    }
  }

  // ---------------------------------------------------------------- IBL bake

  /** Key of everything that changes the env sky (bake when it differs; quantised to avoid churn). */
  bakeKey(): string {
    const p = this.shared.uPreetham!.value as THREE.Vector4;
    const c = this.shared.uCloud!.value as THREE.Vector4;
    const q = (v: number, s: number): number => Math.round(v * s);
    // Sun quantised to ~1 deg, clouds/night to 2 %.
    return `${q(this.sunDir.x, 60)},${q(this.sunDir.y, 60)},${q(this.sunDir.z, 60)}|${q(p.x, 20)},${q(p.y, 20)},${q(p.z, 2000)},${q(p.w, 50)}|${q(c.x, 50)}|${q(this.night, 50)}|${this.envMapSize}`;
  }

  get envMap(): THREE.Texture | null {
    return this.pmremTarget?.texture ?? null;
  }

  /** Last measured horizontal irradiance of the procedural env sky. */
  get sourceIrradiance(): number {
    return this.measured;
  }

  setEnvMapSize(size: number): void {
    if (size === this.envMapSize) return;
    this.envMapSize = size;
    this.cubeTarget?.dispose();
    this.cubeTarget = null;
    this.cubeCamera = null;
    this.pmremTarget?.dispose();
    this.pmremTarget = null;
    this.lastBakeKey = '';
  }

  /** Force a re-bake next time (context restored, quality change). */
  invalidate(): void {
    this.lastBakeKey = '';
  }

  /**
   * Bake the procedural sky when it changed: 32 px float cube -> readback -> sourceIrradiance + horizon ring, and
   * (envMapSize > 0) an envMapSize cube -> PMREM (render target reused). Returns null when nothing changed.
   */
  bake(renderer: THREE.WebGLRenderer, force = false): SkyBake | null {
    const key = this.bakeKey();
    if (!force && key === this.lastBakeKey && (this.pmremTarget || this.envMapSize <= 0)) return null;
    this.lastBakeKey = key;
    this.measureIrradiance(renderer);
    if (this.envMapSize > 0) {
      if (!this.cubeTarget) {
        this.cubeTarget = new THREE.WebGLCubeRenderTarget(this.envMapSize, { type: THREE.HalfFloatType, generateMipmaps: false });
        this.cubeCamera = new THREE.CubeCamera(0.1, 1000, this.cubeTarget);
      }
      this.cubeCamera!.update(renderer, this.envScene);
      this.pmremTarget = this.pmrem.fromCubemap(this.cubeTarget.texture, this.pmremTarget);
    }
    return { envMap: this.envMap, sourceIrradiance: this.measured, yaw: 0 };
  }

  private measureIrradiance(renderer: THREE.WebGLRenderer): void {
    const n = IRRADIANCE_CUBE_SIZE;
    if (!this.irrTarget) {
      const floatOk = renderer.extensions.has('EXT_color_buffer_float');
      this.irrTarget = new THREE.WebGLCubeRenderTarget(n, { type: floatOk ? THREE.FloatType : THREE.HalfFloatType, generateMipmaps: false });
      this.irrCamera = new THREE.CubeCamera(0.1, 1000, this.irrTarget);
      for (let f = 0; f < 6; f++) this.faces.push(new Float32Array(n * n * 4));
    }
    this.irrCamera!.update(renderer, this.envScene);
    let ok = true;
    try {
      const half = this.irrTarget.texture.type === THREE.HalfFloatType;
      const tmp16 = half ? new Uint16Array(n * n * 4) : null;
      for (let f = 0; f < 6; f++) {
        const out = this.faces[f]!;
        if (tmp16) {
          renderer.readRenderTargetPixels(this.irrTarget as unknown as THREE.WebGLRenderTarget, 0, 0, n, n, tmp16, f);
          for (let i = 0; i < tmp16.length; i++) out[i] = THREE.DataUtils.fromHalfFloat(tmp16[i]!);
        } else {
          renderer.readRenderTargetPixels(this.irrTarget as unknown as THREE.WebGLRenderTarget, 0, 0, n, n, out, f);
        }
      }
    } catch {
      ok = false;
    }
    const e = ok ? cubeHorizontalIrradiance(this.faces, n) : 0;
    if (ok && Number.isFinite(e) && e > 1e-6) {
      this.measured = e;
      const rgb: [number, number, number] = [0, 0, 0];
      const el = Math.sin(1.5 * DEG);
      const ce = Math.cos(1.5 * DEG);
      for (let k = 0; k < 8; k++) {
        // Ring order matches samHorizon: azimuth a = k * 45 deg - 180 deg in atan(z, x) space.
        const a = (k / 8) * Math.PI * 2 - Math.PI;
        sampleCubeFaces(this.faces, n, Math.cos(a) * ce, el, Math.sin(a) * ce, rgb);
        this.horizonRaw[k * 3] = rgb[0];
        this.horizonRaw[k * 3 + 1] = rgb[1];
        this.horizonRaw[k * 3 + 2] = rgb[2];
      }
      this.horizonValid = true;
    } else if (this.measured <= 0) {
      // No readback (no float render targets): a conservative estimate keeps the calibration in the right range.
      this.measured = this.night > 0.5 ? 0.028 : 3.5;
    }
  }

  // ---------------------------------------------------------------- baked skies (assets on)

  /** Attach an asset source; baked skies are then preferred over the procedural one. */
  setAssets(assets: SkyAssetSource | null): void {
    this.assets = assets && assets.enabled !== false ? assets : null;
    if (!this.assets) this.clearBaked();
  }

  get hasAssets(): boolean {
    return this.assets !== null;
  }

  /** Request the baked sky for a dominant preset (no-op when unchanged / assets off). */
  requestBaked(id: string | null): void {
    if (!this.assets || !id || this.bakedWanted === id) return;
    if (this.assets.has && !this.assets.has(id)) return;
    this.bakedWanted = id;
    if (this.bakedCurrent?.id === id) return;
    const gen = ++this.bakedGen;
    this.bakedLoading = id;
    void this.assets
      .loadHdri(id)
      .then((h) => {
        if (this.disposed || gen !== this.bakedGen || !h) {
          h?.release();
          return;
        }
        this.bakedLoading = null;
        if (this.bakedPrevious) this.bakedPrevious.handle.release();
        this.bakedPrevious = this.bakedCurrent;
        this.bakedCurrent = { id, handle: h, yaw: 0 };
        this.bakedFade = this.bakedPrevious || this.envMap ? 0 : 1;
        this.bakedBlend.nextBakeIn = 0;
      })
      .catch(() => {
        this.bakedLoading = null;
      });
  }

  /** Id of the baked sky being loaded (null when idle). */
  get bakedPending(): string | null {
    return this.bakedLoading;
  }

  /** Is a baked sky active (fully or fading in)? */
  get bakedActive(): boolean {
    return this.bakedCurrent !== null;
  }

  get bakedId(): string | null {
    return this.bakedCurrent?.id ?? null;
  }

  private clearBaked(): void {
    this.bakedGen++;
    this.bakedPrevious?.handle.release();
    this.bakedCurrent?.handle.release();
    this.bakedPrevious = null;
    this.bakedCurrent = null;
    this.bakedWanted = null;
    this.bakedLoading = null;
    this.bakedFade = 1;
    const b = this.visible.uBaked!.value as THREE.Vector4;
    b.set(0, 0, 0, 0);
    this.visible.uScale!.value.z = 1;
  }

  /**
   * scene.environmentRotation.y that moves a bake's sun (compass azimuth A) onto the current solar azimuth B.
   * three samples env maps with Ry(-yaw) * dir, and Ry(yaw) maps compass azimuth a -> a - yaw, so yaw = A - B.
   * The dome and the blend shader sample with the same Ry(-yaw).
   */
  private yawFor(slot: BakedSlot): number {
    const az = Math.atan2(this.sunDir.x, -this.sunDir.z);
    return slot.handle.sun.azimuthDeg * DEG - az;
  }

  /**
   * Advance the baked-sky cross-fade (2 s) and return the env to use: { envMap, sourceIrradiance, yaw } or null when
   * no baked sky is active. While fading, the two equirects are blended (rotated) into one map and re-PMREMed at
   * most 4x per second; the dome blends per pixel every frame.
   */
  updateBaked(renderer: THREE.WebGLRenderer, dt: number, calibration: (src: number) => number): SkyBake | null {
    const cur = this.bakedCurrent;
    const b = this.visible.uBaked!.value as THREE.Vector4;
    const sc = this.visible.uBakedScale!.value as THREE.Vector2;
    if (!cur) {
      b.set(0, 0, 0, 0);
      this.visible.uScale!.value.z = 1;
      return null;
    }
    cur.yaw = this.yawFor(cur);
    const prev = this.bakedPrevious;
    if (prev) prev.yaw = this.yawFor(prev);
    this.bakedFade = Math.min(1, this.bakedFade + dt / BAKED_SKY_FADE_S);
    const t = this.bakedFade;
    const kCur = calibration(cur.handle.entry.ambientIrradiance);
    this.visible.uBakedA!.value = cur.handle.texture;
    sc.x = kCur;
    b.x = t;
    b.z = -cur.yaw;
    if (prev) {
      this.visible.uBakedB!.value = prev.handle.texture;
      sc.y = calibration(prev.handle.entry.ambientIrradiance);
      b.y = 1 - t;
      b.w = -prev.yaw;
      this.visible.uScale!.value.z = 0;
    } else {
      b.y = 0;
      // Fading in from the procedural sky.
      this.visible.uScale!.value.z = 1 - t;
    }
    if (t >= 1) {
      if (prev) {
        prev.handle.release();
        this.bakedPrevious = null;
      }
      b.y = 0;
      this.visible.uScale!.value.z = 0;
      return { envMap: cur.handle.envMap, sourceIrradiance: cur.handle.entry.ambientIrradiance, yaw: cur.yaw };
    }
    // Procedural -> baked: both are calibrated to the same irradiance, so the IBL switches at once (no visible
    // change in light level) while the dome cross-fades per pixel.
    if (!prev) return { envMap: cur.handle.envMap, sourceIrradiance: cur.handle.entry.ambientIrradiance, yaw: cur.yaw };
    // Baked -> baked: blend the two (rotated, calibrated) equirects and re-PMREM at most 4x per second.
    this.bakedBlend.nextBakeIn -= dt;
    this.ensureBlend();
    if (this.bakedBlend.nextBakeIn <= 0) {
      this.bakedBlend.nextBakeIn = 0.25;
      const m = this.bakedBlend.material!;
      m.uniforms.uA!.value = cur.handle.texture;
      m.uniforms.uB!.value = prev.handle.texture;
      m.uniforms.uMix!.value.set(t * kCur, (1 - t) * sc.y, -cur.yaw, -prev.yaw);
      const r = renderer;
      const old = r.getRenderTarget();
      r.setRenderTarget(this.bakedBlend.rt);
      r.render(this.bakedBlend.scene!, this.bakedBlend.camera!);
      r.setRenderTarget(old);
      this.bakedBlend.pmrem = this.pmrem.fromEquirectangular(this.bakedBlend.rt!.texture, this.bakedBlend.pmrem);
    }
    // The blend already carries both calibrations: sourceIrradiance <= 0 means "use environmentIntensity 1".
    return { envMap: this.bakedBlend.pmrem?.texture ?? cur.handle.envMap, sourceIrradiance: -1, yaw: 0 };
  }

  private ensureBlend(): THREE.WebGLRenderTarget {
    const bb = this.bakedBlend;
    if (bb.rt) return bb.rt;
    const w = Math.max(256, Math.min(1024, this.envMapSize * 4 || 512));
    bb.rt = new THREE.WebGLRenderTarget(w, w / 2, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false });
    bb.rt.texture.mapping = THREE.EquirectangularReflectionMapping;
    bb.material = new THREE.ShaderMaterial({
      uniforms: {
        uA: { value: null },
        uB: { value: null },
        uMix: { value: new THREE.Vector4() },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D uA; uniform sampler2D uB; uniform vec4 uMix;
        varying vec2 vUv;
        vec3 dirOf( vec2 uv ) { float phi = ( uv.x - 0.5 ) * 6.283185307; float th = ( uv.y - 0.5 ) * 3.14159265; return vec3( cos( th ) * cos( phi ), sin( th ), cos( th ) * sin( phi ) ); }
        vec2 uvOf( vec3 d, float yaw ) { float c = cos( yaw ), s = sin( yaw ); vec3 r = vec3( c * d.x + s * d.z, d.y, -s * d.x + c * d.z ); return vec2( atan( r.z, r.x ) * 0.15915494 + 0.5, asin( clamp( r.y, -1.0, 1.0 ) ) * 0.31830989 + 0.5 ); }
        void main() {
          vec3 d = dirOf( vUv );
          vec3 c = texture2D( uA, uvOf( d, uMix.z ) ).rgb * uMix.x;
          if ( uMix.y > 0.0 ) c += texture2D( uB, uvOf( d, uMix.w ) ).rgb * uMix.y;
          gl_FragColor = vec4( c, 1.0 );
        }`,
      depthTest: false,
      depthWrite: false,
    });
    bb.scene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bb.material);
    quad.frustumCulled = false;
    bb.scene.add(quad);
    bb.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return bb.rt;
  }

  /** Current yaw of the active baked sky (rad) - environmentRotation.y. */
  get bakedYaw(): number {
    return this.bakedCurrent?.yaw ?? 0;
  }

  // ---------------------------------------------------------------- legacy

  /** Legacy: bake if needed and return the env texture (procedural sky). */
  updateEnvironmentMap(cloudCover: number, force = false): THREE.Texture | null {
    (this.shared.uCloud!.value as THREE.Vector4).x = Math.min(1, cloudCover);
    if (this.renderer) this.bake(this.renderer, force);
    return this.envMap;
  }

  /** GPU resources this system owns (diagnostics / leak checks). */
  renderTargetCount(): number {
    let n = 0;
    for (const t of [this.irrTarget, this.cubeTarget, this.pmremTarget, this.bakedBlend.rt, this.bakedBlend.pmrem]) if (t) n++;
    return n;
  }

  dispose(): void {
    this.disposed = true;
    this.clearBaked();
    this.setSunSprite(null);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.envMaterial.dispose();
    this.irrTarget?.dispose();
    this.cubeTarget?.dispose();
    this.pmremTarget?.dispose();
    this.white.dispose();
    const bb = this.bakedBlend;
    bb.rt?.dispose();
    bb.pmrem?.dispose();
    bb.material?.dispose();
    bb.scene?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.irrTarget = null;
    this.cubeTarget = null;
    this.pmremTarget = null;
  }
}
