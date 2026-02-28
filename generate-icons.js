// Generates minimal PNG icons for the extension using raw PNG encoding (no dependencies)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPng(size) {
  const pixels = Buffer.alloc(size * size * 4, 0);

  // Fill with dark background (rgba 30, 30, 30, 255)
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = 30;
    pixels[i * 4 + 1] = 30;
    pixels[i * 4 + 2] = 30;
    pixels[i * 4 + 3] = 255;
  }

  function setPixel(x, y, r, g, b, a) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    pixels[idx] = r;
    pixels[idx + 1] = g;
    pixels[idx + 2] = b;
    pixels[idx + 3] = a;
  }

  // Draw a filled circle background
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.42;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        setPixel(x, y, 34, 197, 94, 255); // green circle
      }
    }
  }

  // Draw checkmark using line rasterization (Bresenham-ish thick line)
  function drawThickLine(x0, y0, x1, y1, thickness, r, g, b) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      for (let dy = -thickness; dy <= thickness; dy++) {
        for (let dx = -thickness; dx <= thickness; dx++) {
          if (dx * dx + dy * dy <= thickness * thickness) {
            setPixel(Math.round(px + dx), Math.round(py + dy), r, g, b, 255);
          }
        }
      }
    }
  }

  const s = size;
  const thick = Math.max(1, Math.round(s * 0.07));
  // Checkmark: two lines forming a V shape
  // Short leg: bottom-left to bottom-center
  drawThickLine(s * 0.25, s * 0.50, s * 0.42, s * 0.68, thick, 255, 255, 255);
  // Long leg: bottom-center to top-right
  drawThickLine(s * 0.42, s * 0.68, s * 0.75, s * 0.30, thick, 255, 255, 255);

  // Build PNG file
  // Raw image data with filter byte (0 = None) per row
  const rawData = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    rawData[y * (1 + size * 4)] = 0; // filter byte
    pixels.copy(rawData, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const compressed = zlib.deflateSync(rawData);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type);
    const crcData = Buffer.concat([typeB, data]);
    const crc = Buffer.alloc(4);
    crc.writeInt32BE(crc32(crcData));
    return Buffer.concat([len, typeB, data, crc]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', iend),
  ]);
}

// CRC32 implementation
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return crc ^ -1;
}

const outDir = path.join(__dirname, 'extension', 'icons');

for (const size of [16, 48, 128]) {
  const png = createPng(size);
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`Written ${file} (${png.length} bytes)`);
}
