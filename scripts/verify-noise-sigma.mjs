import fs from "node:fs";
import { inflateSync } from "node:zlib";

export function readPngGrayscale(buf) {
  let offset = 8; // skip PNG signature
  const idatParts = [];
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  const decompressed = inflateSync(Buffer.concat(idatParts));
  // Bytes per pixel:
  // colorType 0 = grayscale (1 bpp)
  // colorType 2 = RGB (3 bpp)
  // colorType 6 = RGBA (4 bpp)
  let bpp = 1;
  if (colorType === 2) bpp = 3;
  if (colorType === 6) bpp = 4;

  const stride = 1 + width * bpp;
  const luminance = new Float32Array(width * height);
  const rowBuffer = Buffer.alloc(width * bpp);
  const prevRow = Buffer.alloc(width * bpp);

  for (let y = 0; y < height; y++) {
    const filter = decompressed[y * stride];
    const raw = decompressed.subarray(y * stride + 1, (y + 1) * stride);

    for (let i = 0; i < raw.length; i++) {
      const a = i >= bpp ? rowBuffer[i - bpp] : 0;
      const b = prevRow[i];
      const c = i >= bpp ? prevRow[i - bpp] : 0;
      let val = raw[i];
      if (filter === 1) val = (val + a) & 0xff;
      else if (filter === 2) val = (val + b) & 0xff;
      else if (filter === 3) val = (val + Math.floor((a + b) / 2)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        val = (val + pr) & 0xff;
      }
      rowBuffer[i] = val;
    }
    prevRow.set(rowBuffer);

    for (let x = 0; x < width; x++) {
      let lum = 0;
      if (colorType === 0) {
        lum = rowBuffer[x];
      } else if (colorType === 2) {
        const r = rowBuffer[x * 3];
        const g = rowBuffer[x * 3 + 1];
        const b = rowBuffer[x * 3 + 2];
        lum = 0.299 * r + 0.587 * g + 0.114 * b;
      } else if (colorType === 6) {
        const r = rowBuffer[x * 4];
        const g = rowBuffer[x * 4 + 1];
        const b = rowBuffer[x * 4 + 2];
        lum = 0.299 * r + 0.587 * g + 0.114 * b;
      }
      luminance[y * width + x] = lum;
    }
  }

  return { width, height, luminance };
}

export function computeNoiseSigma(pngBuffer, cropX, cropY, cropSize = 100) {
  const { width: w, height: h, luminance } = readPngGrayscale(pngBuffer);

  const startX = Math.max(0, Math.min(cropX, w - cropSize));
  const startY = Math.max(0, Math.min(cropY, h - cropSize));

  const Y = new Float32Array(cropSize * cropSize);
  for (let y = 0; y < cropSize; y++) {
    for (let x = 0; x < cropSize; x++) {
      Y[y * cropSize + x] = luminance[(startY + y) * w + (startX + x)];
    }
  }

  // 3x3 box blur
  const blurred = new Float32Array(cropSize * cropSize);
  for (let y = 0; y < cropSize; y++) {
    for (let x = 0; x < cropSize; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= cropSize) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= cropSize) continue;
          sum += Y[ny * cropSize + nx];
          count++;
        }
      }
      blurred[y * cropSize + x] = sum / count;
    }
  }

  let varSum = 0;
  for (let i = 0; i < cropSize * cropSize; i++) {
    const diff = (Y[i] - blurred[i]);
    varSum += diff * diff;
  }
  return Math.sqrt(varSum / (cropSize * cropSize));
}

if (process.argv[1] && process.argv[1].endsWith("verify-noise-sigma.mjs")) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.log("Usage: node verify-noise-sigma.mjs <screenshot.png> [cropX] [cropY]");
    process.exit(1);
  }
  const buf = fs.readFileSync(filePath);
  const cropX = process.argv[3] ? parseInt(process.argv[3], 10) : 100;
  const cropY = process.argv[4] ? parseInt(process.argv[4], 10) : 100;
  const sigma = computeNoiseSigma(buf, cropX, cropY);
  console.log(`Computed sigma_hp: ${sigma.toFixed(4)} (target: 1.2 <= sigma <= 3.8)`);
}
