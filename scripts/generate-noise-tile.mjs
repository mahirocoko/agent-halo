import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";

// CRC32 implementation using standard polynomial 0xEDB88320
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(8 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  const crc = crc32(typeAndData);
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

// Deterministic PRNG (Mulberry32)
function mulberry32(seed) {
  return function() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WIDTH = 128;
const HEIGHT = 128;
const prng = mulberry32(0x5a17e); // Deterministic fixed seed

// Generate scanlines: filter byte 0 followed by WIDTH grayscale bytes
// Subtle noise quantized across 16 luminance levels around midpoint
const scanlines = Buffer.alloc(HEIGHT * (1 + WIDTH));
for (let y = 0; y < HEIGHT; y++) {
  const rowOffset = y * (1 + WIDTH);
  scanlines[rowOffset] = 0; // Filter: None
  for (let x = 0; x < WIDTH; x++) {
    const step = Math.floor(prng() * 16);
    scanlines[rowOffset + 1 + x] = 64 + step * 8;
  }
}

const compressed = deflateSync(scanlines, { level: 9 });

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(WIDTH, 0);
ihdrData.writeUInt32BE(HEIGHT, 4);
ihdrData[8] = 8; // Bit depth: 8
ihdrData[9] = 0; // Color type: 0 (Grayscale)
ihdrData[10] = 0; // Compression: 0 (Deflate)
ihdrData[11] = 0; // Filter: 0 (Adaptive)
ihdrData[12] = 0; // Interlace: 0 (None)

const ihdr = makeChunk("IHDR", ihdrData);
const idat = makeChunk("IDAT", compressed);
const iend = makeChunk("IEND", Buffer.alloc(0));

const png = Buffer.concat([sig, ihdr, idat, iend]);

const target = resolve(process.cwd(), "apps/desktop/src/assets/textures/noise-tile.png");
writeFileSync(target, png);
console.log(`Generated ${target} (${png.length} bytes)`);
