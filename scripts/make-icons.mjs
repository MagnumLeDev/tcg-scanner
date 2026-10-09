// Generates the app icons as PNG files with no dependencies.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function png(size, colourAt) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = colourAt((x + 0.5) / size, (y + 0.5) / size);
      raw.set([r, g, b], y * stride + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BACKGROUND = [0x11, 0x14, 0x18];
const CARD = [0xc9, 0xa2, 0x5a];
const inside = (x, y, left, top, right, bottom) => x >= left && x < right && y >= top && y < bottom;

// A card outline with an art box and, under it on the right, the set-code strip.
// Kept inside the central 60% so it survives maskable-icon cropping.
function icon(x, y) {
  if (!inside(x, y, 0.3, 0.2, 0.7, 0.8)) return BACKGROUND;
  if (inside(x, y, 0.35, 0.28, 0.65, 0.52)) return BACKGROUND;
  if (inside(x, y, 0.5, 0.56, 0.65, 0.6)) return BACKGROUND;
  return CARD;
}

mkdirSync('public', { recursive: true });
for (const size of [180, 192, 512]) {
  writeFileSync(`public/icon-${size}.png`, png(size, icon));
  console.log(`public/icon-${size}.png`);
}
