'use strict';
// Generates assets/icon.ico and assets/icon.png using only Node.js built-ins.
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC32 ────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([l, t, data, cr]);
}

// ── Pixel helpers ────────────────────────────────────────────────────────────
function blendOver(img, i, r, g, b, a) {
  const sa = a / 255, da = img[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa < 0.001) return;
  img[i]     = Math.round((r * sa + img[i]     * da * (1 - sa)) / oa);
  img[i + 1] = Math.round((g * sa + img[i + 1] * da * (1 - sa)) / oa);
  img[i + 2] = Math.round((b * sa + img[i + 2] * da * (1 - sa)) / oa);
  img[i + 3] = Math.round(oa * 255);
}

function setAA(img, w, h, x, y, r, g, b, cover = 1) {
  x = Math.round(x * 2) / 2; y = Math.round(y * 2) / 2;
  for (let dy = -0.5; dy <= 0.5; dy += 1) {
    for (let dx = -0.5; dx <= 0.5; dx += 1) {
      const px = Math.round(x + dx), py = Math.round(y + dy);
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      blendOver(img, (py * w + px) * 4, r, g, b, Math.round(255 * cover));
    }
  }
}

// ── Draw one size ─────────────────────────────────────────────────────────────
function renderIcon(size) {
  const w = size, h = size;
  const img = new Uint8Array(w * h * 4); // transparent black

  const cx = w / 2, cy = h / 2;

  // 1. Purple radial-gradient circle background
  const bgR = w * 0.46;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= bgR + 1) continue;
      // radial: bright centre → dark edge
      const t = dist / bgR;                          // 0=centre 1=edge
      const r = Math.round(139 * (1 - t) + 76 * t); // #8b5cf6 → #4c1d95
      const g = Math.round( 92 * (1 - t) + 29 * t);
      const b = Math.round(246 * (1 - t) +149 * t);
      const a = dist > bgR - 1 ? Math.round(255 * (bgR - dist)) : 255;
      const i = (y * w + x) * 4;
      img[i] = r; img[i+1] = g; img[i+2] = b; img[i+3] = Math.max(0, a);
    }
  }

  // 2. White download arrow
  const S = size / 256; // scale factor

  // shaft
  const shW  = Math.max(1, Math.round(28 * S));
  const shT  = Math.round(48 * S);
  const shB  = Math.round(138 * S);
  for (let y = shT; y <= shB; y++)
    for (let x = Math.round(cx - shW/2); x <= Math.round(cx + shW/2); x++)
      blendOver(img, (y * w + x) * 4, 255, 255, 255, 255);

  // arrowhead (triangle)
  const tipY = Math.round(185 * S);
  const aHalf = Math.round(74 * S);
  for (let y = shB; y <= tipY; y++) {
    const progress = (y - shB) / (tipY - shB);
    const half = aHalf * (1 - progress);
    const x0 = Math.round(cx - half), x1 = Math.round(cx + half);
    for (let x = x0; x <= x1; x++)
      blendOver(img, (y * w + x) * 4, 255, 255, 255, 255);
  }

  // base bar
  const barH = Math.max(1, Math.round(22 * S));
  const barW = Math.round(130 * S);
  const barY = Math.round(200 * S);
  for (let y = barY; y <= barY + barH; y++)
    for (let x = Math.round(cx - barW/2); x <= Math.round(cx + barW/2); x++)
      blendOver(img, (y * w + x) * 4, 255, 255, 255, 255);

  // ── Encode PNG ──
  const PNG_SIG = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  const rows = [];
  for (let y = 0; y < h; y++) {
    rows.push(Buffer.from([0]));                          // filter: None
    rows.push(Buffer.from(img.buffer, y * w * 4, w * 4));
  }
  const compressed = zlib.deflateSync(Buffer.concat(rows), { level: 9 });

  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Build ICO ────────────────────────────────────────────────────────────────
function makeIco(sizes) {
  const pngs  = sizes.map(s => renderIcon(s));
  const count = sizes.length;
  const dirOffset = 6 + count * 16;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(count, 4);

  const dirs = [];
  let offset = dirOffset;
  for (let i = 0; i < count; i++) {
    const e = Buffer.alloc(16);
    e[0] = sizes[i] >= 256 ? 0 : sizes[i];
    e[1] = sizes[i] >= 256 ? 0 : sizes[i];
    e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1,  4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    dirs.push(e);
    offset += pngs[i].length;
  }

  return Buffer.concat([header, ...dirs, ...pngs]);
}

// ── Output ───────────────────────────────────────────────────────────────────
const out = path.join(__dirname, 'assets');
if (!fs.existsSync(out)) fs.mkdirSync(out);

const sizes = [16, 24, 32, 48, 64, 128, 256];
process.stdout.write(`Generating icon (${sizes.join(', ')}px)... `);

const ico = makeIco(sizes);
fs.writeFileSync(path.join(out, 'icon.ico'), ico);

const png = renderIcon(256);
fs.writeFileSync(path.join(out, 'icon.png'), png);

console.log(`done  icon.ico ${(ico.length/1024).toFixed(0)} KB  icon.png ${(png.length/1024).toFixed(0)} KB`);
