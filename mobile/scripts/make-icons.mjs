#!/usr/bin/env node
/* Generates every store image, deterministically, with no dependencies.
 *
 * Why generated rather than checked in as opaque bytes: the repo's existing
 * icon-512.png is 512px (Apple rejects anything under 1024 for the marketing
 * icon), it is BLUE while the app is green, and it has "MLS" baked into it —
 * text in an app icon is illegible at 60pt and both stores advise against it.
 * A drawing described in source is one a reviewer can actually review.
 *
 * Writes:
 *   ../app-icon-1024.png              site + iOS marketing icon (opaque, square)
 *   ../app-icon-maskable-1024.png     Android adaptive: mark inside the safe circle
 *   assets/icon.png                   @capacitor/assets input
 *   assets/icon-foreground.png        @capacitor/assets adaptive foreground
 *   assets/icon-background.png        @capacitor/assets adaptive background
 *   assets/splash.png                 2732x2732 light launch image
 *   assets/splash-dark.png            2732x2732 dark launch image
 *
 * NO ALPHA CHANNEL anywhere: an iOS app icon containing transparency is an
 * App Store validation failure, and it is the single most common first-upload
 * rejection for an app like this one.
 *
 *   node mobile/scripts/make-icons.mjs
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = path.resolve(HERE, '..');
const ROOT = path.resolve(MOBILE, '..');
const ASSETS = path.join(MOBILE, 'assets');

const cfg = JSON.parse(fs.readFileSync(path.join(MOBILE, 'app.config.json'), 'utf8'));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

const BRAND_TOP = [0x36, 0x7a, 0x57];
const BRAND_BOT = [0x1c, 0x39, 0x2e];
const WHITE = [0xff, 0xff, 0xff];
const LIGHT_BG = hex(cfg.themeColor);       // #F7F5EF
const DARK_BG = hex(cfg.themeColorDark);    // #141A16
const BRAND = hex(cfg.brandColor);          // #2E6A4B

/* The ECG mark in the same 24x24 viewBox as the app's inline <svg>, so the
   icon and the in-app logo are literally one drawing:
     M2 12 h5 l2.5-6 l4 13 L16 12 h6                                        */
const PATH = [[2, 12], [7, 12], [9.5, 6], [13.5, 19], [16, 12], [22, 12]];
const STROKE_UNITS = 2.15;

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/* opts: { size, scale, ink, bgTop, bgBot }  — bgBot omitted = flat colour */
function render({ size, scale, ink, bgTop, bgBot }) {
  const box = size * scale;
  const unit = box / 24;
  const off = (size - box) / 2;
  const half = (STROKE_UNITS * unit) / 2;
  const pts = PATH.map(([x, y]) => [off + x * unit, off + y * unit]);
  const flat = !bgBot;

  /* Bound the per-pixel distance work to the mark's bounding box; outside it
     the answer is always "background", and this is a 7.5-megapixel image. */
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const pad = half + 2;
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad));
  const x1 = Math.min(size - 1, Math.ceil(Math.max(...xs) + pad));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
  const y1 = Math.min(size - 1, Math.ceil(Math.max(...ys) + pad));

  const raw = Buffer.alloc(size * (size * 3 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;                                   // PNG filter: none
    const rowInMark = y >= y0 && y <= y1;
    for (let x = 0; x < size; x++) {
      let r, g, b;
      if (flat) { r = bgTop[0]; g = bgTop[1]; b = bgTop[2]; }
      else {
        const t = (x + y) / (2 * size);
        r = bgTop[0] + (bgBot[0] - bgTop[0]) * t;
        g = bgTop[1] + (bgBot[1] - bgTop[1]) * t;
        b = bgTop[2] + (bgBot[2] - bgTop[2]) * t;
      }
      if (rowInMark && x >= x0 && x <= x1) {
        let d = Infinity;
        const cx = x + 0.5, cy = y + 0.5;
        for (let i = 0; i < pts.length - 1; i++) {
          const dd = distToSegment(cx, cy, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
          if (dd < d) d = dd;
        }
        // round caps and joins come free — distance-to-polyline is already round
        const a = d <= half - 0.5 ? 1 : d >= half + 0.5 ? 0 : (half + 0.5 - d);
        if (a > 0) {
          r += (ink[0] - r) * a;
          g += (ink[1] - g) * a;
          b += (ink[2] - b) * a;
        }
      }
      raw[o++] = Math.round(r);
      raw[o++] = Math.round(g);
      raw[o++] = Math.round(b);
    }
  }
  return { raw, size };
}

let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
function png({ raw, size }) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type 2 = truecolour, NO alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(ASSETS, { recursive: true });

const jobs = [
  // published site + the source @capacitor/assets slices for iOS
  [path.join(ROOT, 'app-icon-1024.png'),
    { size: 1024, scale: 0.66, ink: WHITE, bgTop: BRAND_TOP, bgBot: BRAND_BOT }],
  [path.join(ROOT, 'app-icon-maskable-1024.png'),
    { size: 1024, scale: 0.46, ink: WHITE, bgTop: BRAND_TOP, bgBot: BRAND_BOT }],
  [path.join(ASSETS, 'icon.png'),
    { size: 1024, scale: 0.66, ink: WHITE, bgTop: BRAND_TOP, bgBot: BRAND_BOT }],
  // Android adaptive icon: foreground and background are separate layers, and
  // the launcher can crop ~28% off every edge, so the mark lives well inside.
  [path.join(ASSETS, 'icon-foreground.png'),
    { size: 1024, scale: 0.46, ink: WHITE, bgTop: BRAND_TOP, bgBot: BRAND_BOT }],
  [path.join(ASSETS, 'icon-background.png'),
    { size: 1024, scale: 0, ink: WHITE, bgTop: BRAND_TOP, bgBot: BRAND_BOT }],
  // Launch images. Square 2732 so every device crops from the centre.
  [path.join(ASSETS, 'splash.png'),
    { size: 2732, scale: 0.13, ink: BRAND, bgTop: LIGHT_BG }],
  [path.join(ASSETS, 'splash-dark.png'),
    { size: 2732, scale: 0.13, ink: BRAND, bgTop: DARK_BG }],
];

for (const [out, opts] of jobs) {
  fs.writeFileSync(out, png(render(opts)));
  console.log(`wrote ${path.relative(ROOT, out).padEnd(34)} ${opts.size}x${opts.size} opaque`);
}
console.log('\nNext: cd mobile && npm run assets   (slices these into android/ and ios/)');
