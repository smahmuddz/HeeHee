/**
 * Inspect a PNG: size, colour type, whether it really has transparency, and the
 * corner pixels. Used to decide how to composite Img/MJ.png on the splash.
 * Run: node tools/probe-image.mjs
 */

import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const file = process.argv[2] || 'Img/MJ.png';
const buf = await readFile(file);

const sig = buf.subarray(0, 8).toString('hex');
if (sig !== '89504e470d0a1a0a') throw new Error('not a PNG');

let off = 8;
let ihdr = null;
const idat = [];

while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.subarray(off + 4, off + 8).toString('ascii');
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 'IHDR') {
    ihdr = {
      width: data.readUInt32BE(0),
      height: data.readUInt32BE(4),
      bitDepth: data[8],
      colorType: data[9],
      compression: data[10],
      filter: data[11],
      interlace: data[12]
    };
  } else if (type === 'IDAT') {
    idat.push(Buffer.from(data));
  } else if (type === 'IEND') {
    break;
  }
  off += 12 + len;
}

const COLOR = { 0: 'greyscale', 2: 'truecolour', 3: 'indexed', 4: 'greyscale+alpha', 6: 'truecolour+alpha' };
console.log(`${file}`);
console.log(`  ${ihdr.width} x ${ihdr.height}  ratio ${(ihdr.width / ihdr.height).toFixed(3)}`);
console.log(`  ${COLOR[ihdr.colorType] || ihdr.colorType}, depth ${ihdr.bitDepth}, interlace ${ihdr.interlace}`);
console.log(`  idat chunks: ${idat.length}, compressed ${idat.reduce((a, b) => a + b.length, 0)} bytes`);

const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.colorType];
if (ihdr.bitDepth !== 8 || ihdr.interlace !== 0) {
  console.log('  (raw pixel probe skipped: needs 8-bit non-interlaced)');
  process.exit(0);
}

const raw = inflateSync(Buffer.concat(idat));
const stride = ihdr.width * channels;
const out = Buffer.alloc(stride * ihdr.height);
let rp = 0;
for (let y = 0; y < ihdr.height; y++) {
  const filter = raw[rp++];
  const row = raw.subarray(rp, rp + stride);
  rp += stride;
  const cur = out.subarray(y * stride, (y + 1) * stride);
  const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
  for (let x = 0; x < stride; x++) {
    const a = x >= channels ? cur[x - channels] : 0;
    const b = prev ? prev[x] : 0;
    const c = prev && x >= channels ? prev[x - channels] : 0;
    let v = row[x];
    if (filter === 1) v += a;
    else if (filter === 2) v += b;
    else if (filter === 3) v += ((a + b) >> 1);
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
    }
    cur[x] = v & 0xff;
  }
}

const px = (x, y) => {
  const i = y * stride + x * channels;
  return [out[i], out[i + 1], out[i + 2], channels === 4 ? out[i + 3] : 255];
};

console.log('\n  corner / edge samples (r,g,b,a):');
const H = ihdr.height;
const W = ihdr.width;
for (const [name, x, y] of [['top-left', 0, 0], ['top-right', W - 1, 0], ['bottom-left', 0, H - 1],
  ['bottom-right', W - 1, H - 1], ['mid-left', 0, (H / 2) | 0], ['mid-right', W - 1, (H / 2) | 0],
  ['centre', (W / 2) | 0, (H / 2) | 0]]) {
  console.log(`    ${name.padEnd(13)} ${px(x, y).join(', ')}`);
}

if (channels === 4) {
  let transparent = 0;
  const total = W * H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (out[y * stride + x * 4 + 3] < 12) transparent++;
  console.log(`\n  transparent pixels: ${transparent} / ${total} (${(transparent / total * 100).toFixed(1)}%)`);
  console.log(transparent / total > 0.05
    ? '  -> has a real alpha channel, safe to place directly on any background'
    : '  -> alpha channel present but opaque; will need masking/blending');
} else {
  console.log('\n  -> no alpha channel; will need masking/blending');
}

// Where is the visible subject? Bounding box of pixels with real alpha.
let minX = W; let minY = H; let maxX = -1; let maxY = -1;
const alphaAt = (x, y) => (channels === 4 ? out[y * stride + x * 4 + 3] : 255);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (alphaAt(x, y) < 16) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
}
if (maxX > 0) {
  console.log(`\n  opaque bbox: x ${minX}..${maxX} (${maxX - minX + 1}px wide), y ${minY}..${maxY} (${maxY - minY + 1}px tall)`);
  console.log(`  padding: left ${(minX / W).toFixed(3)}  right ${((W - 1 - maxX) / W).toFixed(3)}  top ${(minY / H).toFixed(3)}  bottom ${((H - 1 - maxY) / H).toFixed(3)}`);
  console.log(`  subject aspect: ${((maxX - minX + 1) / (maxY - minY + 1)).toFixed(3)}`);

  // Row-by-row width profile near the bottom, to see where the feet are.
  console.log('\n  bottom profile (widest opaque row in each band):');
  for (let b = 0; b < 5; b++) {
    const y0 = Math.floor(minY + (maxY - minY) * (b / 5));
    const y1 = Math.floor(minY + (maxY - minY) * ((b + 1) / 5));
    let lo = W; let hi = -1;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < W; x++) {
        if (alphaAt(x, y) < 16) continue;
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    if (hi >= 0) console.log(`    y ${y0}-${y1}: x ${lo}..${hi} (width ${hi - lo + 1}, centre ${((lo + hi) / 2 / W).toFixed(3)})`);
  }
} else {
  console.log('\n  image is fully transparent');
}
