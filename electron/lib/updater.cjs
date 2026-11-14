'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function git(args, cwd, timeout = 120000) {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  });
  return {
    status: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
  };
}

async function fetchJson(url, timeout = 15000) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'HentaiFigure-Updater',
      Accept: 'application/vnd.github+json',
    },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

function readVersion(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

class Updater {
  constructor({ root, config, backup }) {
    this.root = root;
    this.config = config;
    this.backup = backup;
  }

  async check() {
    const currentVersion = readVersion(this.root);
    const base = {
      currentVersion,
      configured: false,
      available: false,
      mode: '',
      latestVersion: currentVersion,
      notes: '',
      error: '',
      checkedAt: Date.now(),
    };

    if (fs.existsSync(path.join(this.root, '.git'))) {
      const remote = git(['remote', 'get-url', 'origin'], this.root, 10000);
      if (remote.status === 0 && remote.stdout) {
        base.configured = true;
        base.mode = 'git';
        base.remote = remote.stdout;
        const fetched = git(['fetch', '--quiet', '--prune', 'origin'], this.root, 45000);
        if (fetched.status !== 0) {
          base.error = fetched.stderr || 'git fetch 失败';
          return base;
        }
        const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], this.root, 10000);
        if (upstream.status !== 0) {
          base.error = '当前分支没有设置上游分支（upstream）。';
          return base;
        }
        const behind = Number(git(['rev-list', '--count', 'HEAD..@{u}'], this.root, 20000).stdout || 0);
        const log = git(['log', '-1', '--format=%h %s', '@{u}'], this.root, 20000);
        const pkgRaw = git(['show', '@{u}:package.json'], this.root, 20000);
        let latestVersion = currentVersion;
        try {
          latestVersion = JSON.parse(pkgRaw.stdout).version || currentVersion;
        } catch {}
        base.available = behind > 0;
        base.behind = behind;
        base.latestVersion = latestVersion;
        base.notes = log.stdout;
        base.branch = upstream.stdout;
        return base;
      }
    }

    if (this.config.updateRepo) {
      base.configured = true;
      base.mode = 'github';
      try {
        const repo = String(this.config.updateRepo).trim();
        const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
        const latestVersion = String(release.tag_name || release.name || '').replace(/^v/, '') || currentVersion;
        base.latestVersion = latestVersion;
        base.available = compareVersions(latestVersion, currentVersion) > 0;
        base.notes = release.body || release.name || '';
        base.downloadUrl = release.zipball_url || `https://api.github.com/repos/${repo}/zipball`;
        base.htmlUrl = release.html_url || `https://github.com/${repo}`;
        return base;
      } catch (err) {
        try {
          const repo = String(this.config.updateRepo).trim();
          const commits = await fetchJson(`https://api.github.com/repos/${repo}/commits?per_page=1`);
          const head = Array.isArray(commits) ? commits[0] : null;
          const pkg = await fetchJson(`https://api.github.com/repos/${repo}/contents/package.json`);
          const latestVersion = JSON.parse(Buffer.from(pkg.content || '', 'base64').toString('utf8')).version || currentVersion;
          base.latestVersion = latestVersion;
          base.available = compareVersions(latestVersion, currentVersion) > 0;
          base.notes = head?.commit?.message || '';
          base.downloadUrl = head?.sha
            ? `https://codeload.github.com/${repo}/zip/${head.sha}`
            : `https://codeload.github.com/${repo}/zip/refs/heads/main`;
          base.htmlUrl = `https://github.com/${repo}`;
          return base;
        } catch (err2) {
          base.error = `检查更新失败：${err2.message || err2}`;
          return base;
        }
      }
    }

    base.reason = '还没有配置更新源。把项目推送到 GitHub 并填写 owner/repo，或给仓库添加 git remote。';
    return base;
  }

  async apply(progress) {
    const info = await this.check();
    if (!info.configured) throw new Error(info.reason || '没有配置更新源');
    if (!info.available) return { updated: false, info };
    if (info.error) throw new Error(info.error);

    if (this.backup) {
      progress?.('backup', '先备份本地数据…');
      await this.backup('before-update');
    }

    if (info.mode === 'git') {
      progress?.('fetch', '从远程仓库拉取新版本…');
      const oldHead = git(['rev-parse', 'HEAD'], this.root, 10000).stdout;
      const fetchRes = git(['fetch', '--prune', 'origin'], this.root, 60000);
      if (fetchRes.status !== 0) throw new Error(fetchRes.stderr || 'git fetch 失败');
      const reset = git(['reset', '--hard', '@{u}'], this.root, 60000);
      if (reset.status !== 0) throw new Error(reset.stderr || 'git reset 失败');
      const newHead = git(['rev-parse', 'HEAD'], this.root, 10000).stdout;
      const changed = git(['diff', '--name-only', oldHead, newHead], this.root, 20000).stdout;
      const needInstall = /(^|\n)(package\.json|pnpm-lock\.yaml|package-lock\.json)/.test(changed);
      if (needInstall) {
        progress?.('install', '依赖有变化，安装中…');
        const npm = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
          cwd: this.root,
          encoding: 'utf8',
          timeout: 15 * 60 * 1000,
          windowsHide: true,
          shell: true,
        });
        if (npm.status !== 0) throw new Error(npm.stderr || 'npm install 失败');
      }
      progress?.('build', '重新构建界面…');
      const build = spawnSync('npm', ['run', 'build'], {
        cwd: this.root,
        encoding: 'utf8',
        timeout: 5 * 60 * 1000,
        windowsHide: true,
        shell: true,
      });
      if (build.status !== 0) throw new Error(build.stderr || '构建失败');
      progress?.('done', '更新完成，正在重启…');
      return { updated: true, info: { ...info, mode: 'git' } };
    }

    // GitHub zip / release zipball
    progress?.('download', '下载新版本…');
    if (!info.downloadUrl) throw new Error('没有可用的下载地址');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hentaifigure-update-'));
    const zipPath = path.join(tmp, 'update.zip');
    const res = await fetch(info.downloadUrl, {
      headers: { 'User-Agent': 'HentaiFigure-Updater' },
      redirect: 'follow',
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(zipPath, buf);

    progress?.('extract', '解压新版本…');
    const extractDir = path.join(tmp, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    const unzip = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`],
      { encoding: 'utf8', timeout: 180000, windowsHide: true }
    );
    if (unzip.status !== 0) throw new Error(unzip.stderr || '解压失败');

    let sourceRoot = extractDir;
    const entries = fs.readdirSync(extractDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (entries.length === 1 && !fs.existsSync(path.join(extractDir, 'package.json'))) {
      sourceRoot = path.join(extractDir, entries[0].name);
    }
    if (!fs.existsSync(path.join(sourceRoot, 'package.json'))) throw new Error('更新包里没有找到 package.json');

    progress?.('copy', '替换应用文件（本地数据在另一个目录，不会动）…');
    const skip = new Set(['node_modules', '.git', 'data', 'dist', '.vite', 'install.log']);
    const copyRecursive = (from, to) => {
      fs.mkdirSync(to, { recursive: true });
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const src = path.join(from, entry.name);
        const dest = path.join(to, entry.name);
        if (entry.isDirectory()) copyRecursive(src, dest);
        else fs.copyFileSync(src, dest);
      }
    };
    copyRecursive(sourceRoot, this.root);

    progress?.('install', '安装依赖…');
    const npm = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: this.root,
      encoding: 'utf8',
      timeout: 15 * 60 * 1000,
      windowsHide: true,
      shell: true,
    });
    if (npm.status !== 0) throw new Error(npm.stderr || 'npm install 失败');

    progress?.('build', '重新构建界面…');
    const build = spawnSync('npm', ['run', 'build'], {
      cwd: this.root,
      encoding: 'utf8',
      timeout: 5 * 60 * 1000,
      windowsHide: true,
      shell: true,
    });
    if (build.status !== 0) throw new Error(build.stderr || '构建失败');

    progress?.('done', '更新完成，正在重启…');
    return { updated: true, info: { ...info, mode: 'github' } };
  }
}

module.exports = { Updater, compareVersions };
