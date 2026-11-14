'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

let electron = null;
let closed = false;

function stopAll(code = 0) {
  if (closed) return;
  closed = true;
  try { electron?.kill(); } catch {}
  try { vite.kill(); } catch {}
  setTimeout(() => process.exit(code), 200);
}

function waitForVite(attempt = 0) {
  if (closed) return;
  const req = http.get('http://127.0.0.1:5199/', (res) => {
    res.resume();
    if (res.statusCode && res.statusCode < 500) startElectron();
    else retry(attempt);
  });
  req.on('error', () => retry(attempt));
  req.setTimeout(1200, () => { req.destroy(); retry(attempt); });
}

function retry(attempt) {
  if (attempt > 60) {
    console.error('Vite 启动超时。');
    stopAll(1);
    return;
  }
  setTimeout(() => waitForVite(attempt + 1), 500);
}

function startElectron() {
  const bin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  electron = spawn(bin, [root], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5199/' },
  });
  electron.on('exit', (code) => stopAll(code || 0));
}

vite.on('exit', (code) => {
  if (!closed) stopAll(code || 0);
});

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

waitForVite();
