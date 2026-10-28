/**
 * Math utilities. Owned by the CTO. Three-free, DOM-free.
 *
 * DETERMINISM: `Math.sin/cos/tan/atan/atan2/exp/log/pow/hypot/cbrt/asin/acos` are implementation-defined
 * in JavaScript and may differ across browsers/engines. Sim code (src/sim/**, src/core/terrain/**) MUST use
 * the `d*` functions below instead (enforced by tests/core/purity.test.ts). Math.sqrt, Math.abs,
 * Math.floor/ceil/round/trunc, Math.min/max, Math.imul, Math.sign, Math.fround are IEEE-exact and allowed.
 */

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
export const DEG2RAD = PI / 180;
export const RAD2DEG = 180 / PI;
export const SQRT2 = 1.4142135623730951;

// -----------------------------------------------------------------------------------------------
// Deterministic transcendental functions (pure + - * / sqrt and exact rounding only)
// -----------------------------------------------------------------------------------------------

const INV_PIO2 = 0.6366197723675814;
const PIO2_1 = 1.5707963267341256; // first 33 bits of pi/2
const PIO2_1T = 6.077100506506192e-11; // pi/2 - PIO2_1

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

function kSin(r: number): number {
  const z = r * r;
  return r + r * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}
function kCos(r: number): number {
  const z = r * r;
  return 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
}

/** Deterministic sine. Accurate to ~1e-15 for |x| < 1e5. */
export function dsin(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const n = Math.round(x * INV_PIO2);
  const r = x - n * PIO2_1 - n * PIO2_1T;
  const q = ((n % 4) + 4) % 4;
  switch (q) {
    case 0:
      return kSin(r);
    case 1:
      return kCos(r);
    case 2:
      return -kSin(r);
    default:
      return -kCos(r);
  }
}

/** Deterministic cosine. */
export function dcos(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const n = Math.round(x * INV_PIO2);
  const r = x - n * PIO2_1 - n * PIO2_1T;
  const q = ((n % 4) + 4) % 4;
  switch (q) {
    case 0:
      return kCos(r);
    case 1:
      return -kSin(r);
    case 2:
      return -kCos(r);
    default:
      return kSin(r);
  }
}

const TAN_PI_12 = 0.2679491924311227;
const SQRT3 = 1.7320508075688772;
const PI_6 = 0.5235987755982988;

/** Deterministic arctangent. */
export function datan(x: number): number {
  if (x !== x) return NaN;
  let sign = 1;
  if (x < 0) {
    x = -x;
    sign = -1;
  }
  if (x === Infinity) return sign * HALF_PI;
  let invert = false;
  if (x > 1) {
    x = 1 / x;
    invert = true;
  }
  let offset = 0;
  if (x > TAN_PI_12) {
    x = (x * SQRT3 - 1) / (SQRT3 + x);
    offset = PI_6;
  }
  // Taylor series, |x| <= tan(pi/12)
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let k = 3; k <= 31; k += 2) {
    term *= -x2;
    sum += term / k;
  }
  let r = sum + offset;
  if (invert) r = HALF_PI - r;
  return sign * r;
}

/** Deterministic atan2(y, x) in (-PI, PI]. */
export function datan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

/** Deterministic arcsine (|x| <= 1). */
export function dasin(x: number): number {
  if (x >= 1) return HALF_PI;
  if (x <= -1) return -HALF_PI;
  return datan2(x, Math.sqrt(1 - x * x));
}

/** Deterministic arccosine (|x| <= 1). */
export function dacos(x: number): number {
  return HALF_PI - dasin(x);
}

const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const LN2 = 0.6931471805599453;

function pow2i(k: number): number {
  // exact 2^k by squaring (k integer)
  let base = k >= 0 ? 2 : 0.5;
  let e = k >= 0 ? k : -k;
  let result = 1;
  while (e > 0) {
    if (e & 1) result *= base;
    base *= base;
    e >>>= 1;
  }
  return result;
}

/** Deterministic e^x. */
export function dexp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.78) return Infinity;
  if (x < -745.13) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2_HI - k * LN2_LO;
  // Taylor series to r^14 (|r| <= 0.347)
  let term = 1;
  let sum = 1;
  for (let i = 1; i <= 14; i++) {
    term *= r / i;
    sum += term;
  }
  if (k > 1000) return sum * pow2i(1000) * pow2i(k - 1000);
  if (k < -1000) return sum * pow2i(-1000) * pow2i(k + 1000);
  return sum * pow2i(k);
}

/** Deterministic natural log. */
export function dlog(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let m = x;
  let e = 0;
  while (m >= 2) {
    m *= 0.5;
    e++;
  }
  while (m < 1) {
    m *= 2;
    e--;
  }
  if (m > SQRT2) {
    m *= 0.5;
    e++;
  }
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let term = s;
  let sum = s;
  for (let k = 3; k <= 27; k += 2) {
    term *= s2;
    sum += term / k;
  }
  return e * LN2_HI + (2 * sum + e * LN2_LO);
}

/** Deterministic x^y for x > 0 (and integer y for x <= 0). */
export function dpow(x: number, y: number): number {
  if (y === 0) return 1;
  if (Number.isInteger(y) && Math.abs(y) <= 64) {
    let base = y >= 0 ? x : 1 / x;
    let e = Math.abs(y);
    let result = 1;
    while (e > 0) {
      if (e & 1) result *= base;
      base *= base;
      e >>>= 1;
    }
    return result;
  }
  if (x < 0) return NaN;
  if (x === 0) return y > 0 ? 0 : Infinity;
  return dexp(y * dlog(x));
}

// -----------------------------------------------------------------------------------------------
// Scalar helpers (deterministic)
// -----------------------------------------------------------------------------------------------

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}
export function remap(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return lerp(outMin, outMax, invLerp(inMin, inMax, v));
}
export function remapClamped(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return lerp(outMin, outMax, clamp01(invLerp(inMin, inMax, v)));
}
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}
export function fract(x: number): number {
  return x - Math.floor(x);
}
/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}
/** Frame-rate independent exponential smoothing: lambda ~ 1/response time. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - dexp(-lambda * dt));
}

/** Wrap angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = a % TWO_PI;
  if (a <= -PI) a += TWO_PI;
  else if (a > PI) a -= TWO_PI;
  return a;
}
/** Shortest signed difference b - a in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  return wrapAngle(b - a);
}
export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}
/** Rotate angle `a` toward `b` by at most `maxDelta` radians. */
export function approachAngle(a: number, b: number, maxDelta: number): number {
  const d = angleDelta(a, b);
  if (Math.abs(d) <= maxDelta) return b;
  return wrapAngle(a + Math.sign(d) * maxDelta);
}
/** Facing angle (see types.ts convention) of the direction (dx, dz). */
export function facingOf(dx: number, dz: number): number {
  return datan2(dx, dz);
}

// -----------------------------------------------------------------------------------------------
// 2D vector helpers on the ground plane (allocation-free variants take `out`)
// -----------------------------------------------------------------------------------------------

export interface MutVec2 {
  x: number;
  z: number;
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}
export function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt(dist2(ax, az, bx, bz));
}
export function len2(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}
/** Forward unit vector for a facing angle. */
export function forward(facing: number, out: MutVec2): MutVec2 {
  out.x = dsin(facing);
  out.z = dcos(facing);
  return out;
}
/** Right unit vector (facing + 90 degrees clockwise when viewed from above, i.e. -X for facing 0). */
export function right(facing: number, out: MutVec2): MutVec2 {
  out.x = -dcos(facing);
  out.z = dsin(facing);
  return out;
}
/** Distance from point P to segment AB. */
export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = clamp01(t);
  return dist(px, pz, ax + abx * t, az + abz * t);
}
/** Point-in-polygon (even-odd) for ground polygons. */
export function pointInPolygon(x: number, z: number, poly: readonly MutVec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i] as MutVec2;
    const pj = poly[j] as MutVec2;
    if (pi.z > z !== pj.z > z && x < ((pj.x - pi.x) * (z - pi.z)) / (pj.z - pi.z) + pi.x) inside = !inside;
  }
  return inside;
}

// -----------------------------------------------------------------------------------------------
// Integer hashing for procedural placement (deterministic, stateless)
// -----------------------------------------------------------------------------------------------

/** 32-bit integer hash (lowbias32). */
export function hash32(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}
/** Hash of an integer lattice point + seed -> [0, 1). */
export function hash2(ix: number, iz: number, seed: number): number {
  return hash32((Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0) / 4294967296;
}
/** Hash of a single integer + seed -> [0, 1). */
export function hash1(i: number, seed: number): number {
  return hash32((Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0) / 4294967296;
}
