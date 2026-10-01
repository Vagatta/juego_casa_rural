// Genera los iconos PNG de la PWA a partir de la misma composición que public/icon.svg.
// Uso: node scripts/genicons.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const S = 1024; // lienzo 2x para suavizar bordes al reducir
const K = S / 512; // unidades SVG -> píxeles de lienzo

let buf = new Float64Array(S * S * 4);

// Transformación del dibujo: rotación -3° sobre (256,290) + escala sobre el centro
let iconScale = 1;
function T(x, y) {
  const a = (-3 * Math.PI) / 180;
  const dx = x - 256, dy = y - 290;
  const rx = 256 + dx * Math.cos(a) - dy * Math.sin(a);
  const ry = 290 + dx * Math.sin(a) + dy * Math.cos(a);
  return [(256 + (rx - 256) * iconScale) * K, (256 + (ry - 256) * iconScale) * K];
}

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return;
  const i = (y * S + x) * 4;
  const k = Math.min(1, a / 255);
  buf[i] = buf[i] * (1 - k) + r * k;
  buf[i + 1] = buf[i + 1] * (1 - k) + g * k;
  buf[i + 2] = buf[i + 2] * (1 - k) + b * k;
  buf[i + 3] = Math.min(255, buf[i + 3] + a);
}

function fillPoly(pts, c) {
  const P = pts.map(([x, y]) => T(x, y));
  const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(S - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(S - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      let inside = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const [xi, yi] = P[i], [xj, yj] = P[j];
        if (yi > y + 0.5 !== yj > y + 0.5 && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) blend(x, y, ...c);
    }
}

const rect = (x, y, w, h, c) => fillPoly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], c);

function circle(cx, cy, r, c) {
  const [px, py] = T(cx, cy);
  const pr = r * iconScale * K;
  for (let y = Math.floor(py - pr); y <= py + pr; y++)
    for (let x = Math.floor(px - pr); x <= px + pr; x++)
      if (Math.hypot(x - px, y - py) <= pr) blend(x, y, ...c);
}

function drawIcon() {
  // Fondo carbón a sangre completa
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) blend(x, y, 21, 18, 14, 255);
  // Resplandor cálido
  const [gx, gy] = [256 * K, 310 * K];
  const gr = 200 * iconScale * K;
  const [cx, cy] = [(gx + (256 - 256) * K), gy];
  for (let y = Math.max(0, Math.floor(gy - gr)); y <= Math.min(S - 1, gy + gr); y++)
    for (let x = Math.max(0, Math.floor(gx - gr)); x <= Math.min(S - 1, gx + gr); x++) {
      const d = Math.hypot(x - gx, y - gy) / gr;
      if (d < 1) blend(x, y, 58, 41, 27, Math.round(255 * (1 - d)));
    }
  // Chimenea, cuerpo, tejado
  rect(312, 118, 38, 76, [228, 212, 176, 255]);
  rect(146, 248, 224, 160, [239, 227, 199, 255]);
  fillPoly([[104, 256], [256, 134], [408, 256], [408, 220], [256, 98], [104, 220]], [179, 58, 50, 255]);
  // Ventana encendida + cruz
  rect(172, 286, 64, 64, [255, 200, 90, 255]);
  rect(201, 286, 7, 64, [42, 32, 23, 255]);
  rect(172, 315, 64, 7, [42, 32, 23, 255]);
  // Puerta + pomo
  rect(288, 306, 58, 102, [42, 32, 23, 255]);
  circle(334, 358, 5, [255, 200, 90, 255]);
}

// --- PNG encoder (zlib + CRC32, sin dependencias) ---
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};
function png(size) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      const sx = Math.floor((x * S) / size), sy = Math.floor((y * S) / size);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = ((sy + dy) * S + sx + dx) * 4;
        r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; a += buf[i + 3];
      }
      const o = y * (1 + size * 4) + 1 + x * 4;
      raw[o] = Math.round(r / 4); raw[o + 1] = Math.round(g / 4); raw[o + 2] = Math.round(b / 4); raw[o + 3] = Math.round(a / 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = resolve(import.meta.dirname, '../src/client/public');
drawIcon();
writeFileSync(resolve(outDir, 'icon-512.png'), png(512));
writeFileSync(resolve(outDir, 'icon-192.png'), png(192));
writeFileSync(resolve(outDir, 'apple-touch-icon.png'), png(180));

// Maskable: la casa dentro de la zona segura (~80%) sobre fondo sólido
buf = new Float64Array(S * S * 4);
iconScale = 0.78;
drawIcon();
writeFileSync(resolve(outDir, 'icon-maskable-512.png'), png(512));

console.log('icon-512.png, icon-192.png, apple-touch-icon.png, icon-maskable-512.png');
