/**
 * WAV and PNG encoders for the offline audio tools (no dependencies: node:zlib only).
 * OWNER: Audio Developer (AUD-01).
 */
import { deflateSync } from 'node:zlib';

/** 16- or 24-bit PCM WAV from Float32Array channels (TPDF-dithered for 16 bit). */
export function encodeWav(channels, sampleRate, bits = 16) {
  const nch = channels.length;
  const n = channels[0].length;
  const bytes = bits / 8;
  const dataLen = n * nch * bytes;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(nch, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * nch * bytes, 28);
  buf.writeUInt16LE(nch * bytes, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  let o = 44;
  let seed = 0x1234567;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]));
      if (bits === 16) {
        const d = (rnd() - rnd()) / 32768;
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((x + d) * 32767))), o);
        o += 2;
      } else {
        const v = Math.max(-8388608, Math.min(8388607, Math.round(x * 8388607)));
        buf.writeIntLE(v, o, 3);
        o += 3;
      }
    }
  }
  return buf;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/** RGB PNG from a Uint8Array of width*height*3. */
export function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
