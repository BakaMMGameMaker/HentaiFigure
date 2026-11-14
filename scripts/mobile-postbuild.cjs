'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dist = path.resolve(__dirname, '..', 'mobile-dist');
const src = path.join(dist, 'index.mobile.html');
const dest = path.join(dist, 'index.html');
if (!fs.existsSync(src)) {
  console.error('mobile-dist/index.mobile.html 不存在，先运行 vite build。');
  process.exit(1);
}
fs.copyFileSync(src, dest);
console.log('mobile-dist/index.html ready');
