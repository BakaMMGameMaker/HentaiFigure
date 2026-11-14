'use strict';

/**
 * Repair Electron's Windows binary if npm's postinstall extracted only a stub.
 * This happens on some Windows setups where extract-zip silently fails.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const electronDir = path.join(root, 'node_modules', 'electron');
const exe = path.join(electronDir, 'dist', 'electron.exe');

if (process.platform !== 'win32') process.exit(0);
if (fs.existsSync(exe)) process.exit(0);
if (!fs.existsSync(path.join(electronDir, 'package.json'))) {
  console.error('没有找到 electron 依赖，请先运行 npm install。');
  process.exit(1);
}

const version = require(path.join(electronDir, 'package.json')).version;
const cacheRoots = [
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron', 'Cache'),
  path.join(os.homedir(), '.cache', 'electron'),
];

function findZip(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findZip(full);
      if (found) return found;
    } else if (/^electron-v[\d.]+-win32-x64\.zip$/i.test(entry.name)) {
      return full;
    }
  }
  return null;
}

let zip = null;
for (const rootDir of cacheRoots) {
  zip = findZip(rootDir);
  if (zip) break;
}

if (!zip) {
  console.log('缓存里没有 Electron 压缩包，重新下载…');
  const res = spawnSync(process.execPath, [path.join(electronDir, 'install.js')], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/' },
  });
  if (res.status !== 0 || !fs.existsSync(exe)) {
    console.error('Electron 安装失败，请检查网络后重试。');
    process.exit(1);
  }
  process.exit(0);
}

console.log(`正在从缓存修复 Electron ${version}…`);
const dist = path.join(electronDir, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const ps = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dist.replace(/'/g, "''")}' -Force`],
  { stdio: 'inherit', timeout: 300000 }
);

if (ps.status !== 0 || !fs.existsSync(exe)) {
  console.error('解压 Electron 失败。');
  process.exit(1);
}
fs.writeFileSync(path.join(electronDir, 'path.txt'), 'electron.exe');
console.log('Electron 已修复。');
