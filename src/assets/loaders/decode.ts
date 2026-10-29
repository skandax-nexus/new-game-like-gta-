/**
 * Fetch + decode helpers shared by the asset loaders. OWNER: Technical Artist G (TA-07).
 *
 * Decoding stays off the main thread where the platform allows it: images go through
 * createImageBitmap (decoded by the browser's image decoder threads), gzip payloads through
 * DecompressionStream (native, streaming). The only JS-side work is cheap typed-array reshuffles.
 */

export interface FetchProgress {
  (loadedBytes: number): void;
}

/** Fetch a URL fully into memory, reporting streamed bytes. Throws on HTTP errors. */
export async function fetchBytes(url: string, onProgress?: FetchProgress): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body || typeof res.body.getReader !== 'function') return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    onProgress?.(got);
  }
  return concat(chunks, got);
}

export function concat(chunks: readonly Uint8Array[], total?: number): Uint8Array {
  const n = total ?? chunks.reduce((s, c) => s + c.byteLength, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/** True when `bytes` starts with the gzip magic (some servers decode .gz transparently). */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Inflate a gzip payload with the native DecompressionStream (returns the input if it is not gzip). */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isGzip(bytes)) return bytes;
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream unavailable');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
  }
  return concat(chunks);
}

/** Inverse of the publisher's shuffle16: byte planes (all low bytes, then all high bytes) -> uint16 LE. */
export function unshuffle16(planes: Uint8Array, count: number, out?: Uint16Array): Uint16Array {
  const res = out ?? new Uint16Array(count);
  for (let i = 0; i < count; i++) res[i] = planes[i]! | (planes[count + i]! << 8);
  return res;
}

const BITMAP_OPTIONS: ImageBitmapOptions = { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };

/** Decode an encoded image (WebP / PNG) to an ImageBitmap without premultiplication or color conversion. */
export async function decodeBitmap(bytes: Uint8Array, type: string): Promise<ImageBitmap> {
  const blob = new Blob([bytes], { type });
  try {
    return await createImageBitmap(blob, BITMAP_OPTIONS);
  } catch {
    return createImageBitmap(blob);
  }
}

/** Raw RGBA8 pixels of a bitmap (OffscreenCanvas when available). Exact for opaque images. */
export function bitmapPixels(bmp: ImageBitmap): Uint8ClampedArray {
  const w = bmp.width;
  const h = bmp.height;
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  if (!ctx && typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    ctx = c.getContext('2d', { willReadFrequently: true });
  }
  if (!ctx) throw new Error('no 2D canvas to read pixels');
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, w, h).data;
}

/** MIME type from a URL's extension (query string ignored). */
export function mimeOf(url: string): string {
  const ext = /\.([a-z0-9]+)(?:\?|$)/i.exec(url)?.[1]?.toLowerCase();
  return ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/webp';
}
