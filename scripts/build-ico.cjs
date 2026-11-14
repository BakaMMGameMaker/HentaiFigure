const fs = require('node:fs');
const path = require('node:path');
const sizes = [16, 32, 48, 64, 128, 256];
const dir = path.resolve('build');
const images = sizes.map((s) => ({ size: s, data: fs.readFileSync(path.join(dir, `icon-${s}.png`)) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
const entries = [];
let offset = 6 + images.length * 16;
for (const img of images) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(img.size === 256 ? 0 : img.size, 0);
  entry.writeUInt8(img.size === 256 ? 0 : img.size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(img.data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += img.data.length;
  entries.push(entry);
}
const ico = Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
fs.writeFileSync(path.join(dir, 'icon.ico'), ico);
console.log('icon.ico', ico.length, 'bytes');
