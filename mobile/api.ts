import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { Character, Config, HfApi, Item, Photo, Shot, UpdateInfo } from '../src/types';
import { loadImage, readFileAsDataUrl, resizeDataUrl } from '../src/image';
import { MobileStore } from './store';
import { MobileEngine } from './engine';
import { exportSyncZip, importSyncZip } from './sync';
import { friendlyError, testConnection } from './ai';
import { connectionTestInput, verifyVisionSettings } from '../electron/lib/vision-config.mjs';
import appConfig from '../app-config.json';

// 版本号由 vite.mobile.config.ts 从 package.json 注入，避免手改漏改。
declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
const ALLOWED_STATUS = new Set(['owned', 'pending', 'watching']);
const ALLOWED_SHOTS = new Set(['promo', 'real', 'full', 'face', 'armpit', 'chest', 'back', 'belly', 'private', 'butt', 'underSkirt', 'thigh', 'feet', 'other']);
const ALLOWED_TYPES = new Set(['figure', 'acrylic', 'pillow', 'poster', 'badge', 'itabag', 'plush', 'other']);

function compareVersions(a: string, b: string): number {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function optionalNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label}必须是不小于 0 的数字。`);
  return Math.round(n * 100) / 100;
}

function optionalText(value: unknown, max: number, label: string): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  if (s.length > max) throw new Error(`${label}最多 ${max} 个字。`);
  return s;
}

function validatePhoto(photo: any): Photo {
  const id = String(photo?.id || '');
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(id)) throw new Error('照片 ID 不合法。');
  const rawShot = photo?.shot === 'mango' ? 'private' : photo?.shot;
  const shot = (ALLOWED_SHOTS.has(rawShot) ? rawShot : 'promo') as Shot;
  const file = String(photo?.file || '');
  if (!file) throw new Error('照片文件不合法。');
  return {
    id,
    file,
    thumbFile: typeof photo?.thumbFile === 'string' ? photo.thumbFile : file,
    syncPath: typeof photo?.syncPath === 'string' ? photo.syncPath : undefined,
    shot,
    caption: optionalText(photo?.caption, 200, '照片备注'),
    width: Number(photo?.width) || 0,
    height: Number(photo?.height) || 0,
    createdAt: Number(photo?.createdAt) || Date.now(),
  };
}

function normalizeItem(input: any, store: MobileStore): Item {
  const id = input?.id ? String(input.id) : store.newId('itm');
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(id)) throw new Error('周边 ID 不合法。');
  const existing = store.getItem(id);
  const name = optionalText(input?.name, 120, '名称');
  if (!name) throw new Error('给周边起个名字吧。');
  const status = String(input?.status || '');
  if (!ALLOWED_STATUS.has(status)) throw new Error('收藏状态不合法。');
  const type = ALLOWED_TYPES.has(input?.type) ? input.type : 'other';
  const photosIn = Array.isArray(input?.photos) ? input.photos : [];
  const photos: Photo[] = photosIn.map((p: any) => validatePhoto(p));
  if (!photos.length) throw new Error('至少要上传一张照片。');
  if (status === 'owned' && type === 'figure' && !photos.some((p) => p.shot === 'full')) {
    throw new Error('已拥有的手办至少要有一张「全身照」——先给全身照打个标签吧。');
  }
  const dueDate = input?.dueDate ? String(input.dueDate) : '';
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error('补款日期格式应为 YYYY-MM-DD。');
  let characterId = optionalText(input?.characterId, 80, '关联角色');
  if (characterId && !store.getCharacter(characterId)) characterId = '';
  const character = characterId ? store.getCharacter(characterId) : null;
  const now = Date.now();
  const history = Array.isArray((existing as any)?.statusHistory) ? (existing as any).statusHistory.slice() : [];
  if (existing && existing.status !== status) history.push({ from: existing.status, to: status, at: now, via: 'edit' });
  else if (!existing && status !== 'watching') history.push({ from: null, to: status, at: now, via: 'create' });
  return {
    id,
    name,
    type,
    status: status as any,
    characterId,
    series: character ? [character.source, character.name].filter(Boolean).join(' / ') : '',
    scale: optionalText(input?.scale, 80, '规格'),
    originalPrice: optionalNumber(input?.originalPrice, '原始价格'),
    purchasePrice: optionalNumber(input?.purchasePrice, '购入价格'),
    deposit: optionalNumber(input?.deposit, '定金'),
    balance: optionalNumber(input?.balance, '尾款'),
    detail: optionalText(input?.detail, 8000, '商品详情'),
    thought: optionalText(input?.thought, 8000, '最初的想法'),
    dueDate,
    photos,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    statusHistory: history,
    needsFullBodyPhoto: false,
    ...(existing ? {
      lastWipedAt: (existing as any).lastWipedAt || null,
      lastFantasyAt: (existing as any).lastFantasyAt || null,
      lastInstigatedAt: (existing as any).lastInstigatedAt || null,
    } : {}),
  } as Item;
}

function squareAvatarDataUrl(img: HTMLImageElement): string {
  const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const target = Math.min(320, side);
  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法处理图片');
  const sx = ((img.naturalWidth || img.width) - side) / 2;
  const sy = ((img.naturalHeight || img.height) - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target);
  return canvas.toDataURL('image/jpeg', 0.86);
}

async function fileToPhoto(file: File, store: MobileStore): Promise<Photo> {
  if (file.size > 60 * 1024 * 1024) throw new Error('单张照片不能超过 60MB。');
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const full = resizeDataUrl(img, 1400, 0.84);
  const thumb = resizeDataUrl(img, 640, 0.78);
  return {
    id: store.newId('ph'),
    file: full,
    thumbFile: thumb,
    shot: 'promo',
    caption: '',
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
    createdAt: Date.now(),
  };
}

function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      try { input.remove(); } catch {}
      resolve(files);
    };
    input.onchange = () => finish(Array.from(input.files || []));
    window.addEventListener('focus', () => {
      setTimeout(() => finish(Array.from(input.files || [])), 400);
    }, { once: true });
    input.click();
  });
}

function arrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

async function shareZip(bytes: Uint8Array, filename: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    try {
      const saved = await Filesystem.writeFile({
        path: filename,
        data: arrayToBase64(bytes),
        directory: Directory.Cache,
        encoding: 'base64' as any,
      });
      await Share.share({
        title: 'HentaiFigure 同步包',
        text: '收藏与记忆同步包（不含 API Key）',
        url: saved.uri,
        dialogTitle: '保存或发送同步包',
      });
      return filename;
    } catch {
      // Fall through to web share/download.
    }
  }
  const file = new File([bytes.slice().buffer], filename, { type: 'application/zip' });
  const nav: any = navigator;
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'HentaiFigure 同步包', text: '收藏与记忆同步包（不含 API Key）' });
      return filename;
    } catch {
      // Fall through to a download if sharing is unavailable.
    }
  }
  const blob = new Blob([bytes.slice().buffer], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
  return filename;
}

export function installMobileApi() {
  if ((window as any).__hfMobileInstalled) return;
  (window as any).__hfMobileInstalled = true;

  const store = new MobileStore();
  const listeners = new Set<(event: any) => void>();
  const emit = (event: any) => {
    for (const listener of listeners) {
      try { listener(event); } catch {}
    }
  };
  const engine = new MobileEngine(store, emit);
  let lastUpdateInfo: UpdateInfo | null = null;

  const ready = store.ready.then(() => {
    engine.startProactiveWatch();
    setTimeout(async () => {
      if (store.config.autoUpdate === false) return;
      try {
        const info = await checkUpdate(store, lastUpdateInfo);
        lastUpdateInfo = info;
        emit({ type: 'update:info', info });
        if (info.available) emit({ type: 'update:available', info });
      } catch {}
    }, 5000);
  });

  const checkUpdate = async (s: MobileStore, _prev: UpdateInfo | null): Promise<UpdateInfo> => {
    const currentVersion = APP_VERSION;
    const base: UpdateInfo = {
      configured: false,
      available: false,
      currentVersion,
      latestVersion: currentVersion,
      mode: 'github',
      notes: '',
      checkedAt: Date.now(),
    };
    const repo = appConfig.repo;
    base.configured = true;
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const release = await res.json();
      const latest = String(release.tag_name || release.name || '').replace(/^v/, '') || currentVersion;
      return {
        ...base,
        latestVersion: latest,
        available: compareVersions(latest, currentVersion) > 0,
        notes: release.body || release.name || '',
        htmlUrl: release.html_url || `https://github.com/${repo}`,
        downloadUrl: release.zipball_url,
      };
    } catch (err: any) {
      try {
        const commitsRes = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=1`, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(15000),
        });
        const commits = commitsRes.ok ? await commitsRes.json() : [];
        const pkgRes = await fetch(`https://api.github.com/repos/${repo}/contents/package.json`, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(15000),
        });
        const pkg = pkgRes.ok ? await pkgRes.json() : null;
        const latest = pkg ? JSON.parse(atob(String(pkg.content || '').replace(/\n/g, ''))).version : currentVersion;
        return {
          ...base,
          latestVersion: latest || currentVersion,
          available: compareVersions(latest || currentVersion, currentVersion) > 0,
          notes: Array.isArray(commits) ? commits[0]?.commit?.message || '' : '',
          htmlUrl: `https://github.com/${repo}`,
        };
      } catch {
        return { ...base, error: `检查更新失败：${err?.message || err}` };
      }
    }
  };

  const api: HfApi = {
    app: {
      info: async () => ({
        version: APP_VERSION,
        name: 'HentaiFigure',
        platform: 'android',
        dataDir: '应用本地存储（IndexedDB）',
        appPath: '',
        isPackaged: true,
        isMaximized: false,
        updateInfo: lastUpdateInfo,
        versions: {
          electron: 'Capacitor',
          chrome: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          node: '',
        },
      }),
    },
    window: {
      minimize: async () => {},
      toggleMaximize: async () => false,
      close: async () => { try { await CapApp.exitApp(); } catch {} },
    },
    config: {
      get: async () => { await ready; return store.getPublicConfig(); },
      save: async (patch: any) => {
        await ready;
        const clean: any = {};
        if (patch.baseUrl !== undefined) {
          const baseUrl = String(patch.baseUrl).trim();
          if (!/^https?:\/\//i.test(baseUrl)) throw new Error('API 地址必须以 http:// 或 https:// 开头。');
          clean.baseUrl = baseUrl.replace(/\/+$/, '');
        }
        if (patch.model !== undefined) {
          const model = String(patch.model).trim();
          if (!model) throw new Error('模型名不能为空。');
          clean.model = model;
        }
        if (patch.temperature !== undefined) {
          const t = Number(patch.temperature);
          if (!Number.isFinite(t) || t < 0 || t > 2) throw new Error('温度应在 0 到 2 之间。');
          clean.temperature = t;
        }
        if (patch.imageDetail !== undefined) clean.imageDetail = patch.imageDetail === 'low' ? 'low' : 'high';
        if (patch.systemPrompt !== undefined) clean.systemPrompt = String(patch.systemPrompt).slice(0, 30000);
        if (patch.userName !== undefined) {
          const userName = String(patch.userName).trim().slice(0, 24);
          clean.userName = userName || '杂鱼';
        }
        if (patch.managerAvatar !== undefined) {
          const avatar = String(patch.managerAvatar || '');
          if (avatar && !/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)) {
            throw new Error('头像数据不合法。');
          }
          clean.managerAvatar = avatar;
        }
        if (patch.autoUpdate !== undefined) clean.autoUpdate = Boolean(patch.autoUpdate);
        if (patch.dailyChatEnabled !== undefined) clean.dailyChatEnabled = Boolean(patch.dailyChatEnabled);
        if (patch.dailyChatTime !== undefined) {
          const time = String(patch.dailyChatTime || '').trim();
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('主动话题时间格式应为 HH:mm。');
          clean.dailyChatTime = time;
        }
        if (patch.clearApiKey) clean.clearApiKey = true;
        else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) clean.apiKey = patch.apiKey.trim();
        const current = { ...store.config };
        try {
          clean.verifiedVision = await verifyVisionSettings({
            current,
            patch: { ...clean, verifyVision: patch.verifyVision === true },
            test: (config) => testConnection(config, config.apiKey),
          });
        } catch (error) {
          throw new Error(friendlyError(error));
        }
        if (store.config.baseUrl !== current.baseUrl || store.config.model !== current.model || store.config.apiKey !== current.apiKey) {
          throw new Error('API 设置已发生变化，请重新保存。');
        }
        return store.updateConfig(clean);
      },
      resetPrompt: async () => { await ready; return store.resetSystemPrompt(); },
      prompts: async () => { await ready; return store.getPrompts(); },
      savePrompts: async (patch: any) => { await ready; return store.savePrompts(patch || {}); },
      setDevPromptMode: async (value: boolean) => { await ready; return store.setDevPromptMode(Boolean(value)); },
      pickAvatar: async () => {
        const files = await pickFiles('image/*', false);
        if (!files.length) return null;
        const dataUrl = await readFileAsDataUrl(files[0]);
        const img = await loadImage(dataUrl);
        return squareAvatarDataUrl(img);
      },
      test: async (input: any) => {
        await ready;
        try {
          const config = connectionTestInput(store.config, input);
          const result = await testConnection(config, config.apiKey);
          return result;
        } catch (err) {
          return { ok: false, message: friendlyError(err) };
        }
      },
    },
    characters: {
      list: async () => { await ready; return store.listCharacters(); },
      save: async (input: any) => { await ready; return store.upsertCharacter(input || {}); },
      remove: async (id: string) => { await ready; await store.deleteCharacter(id); return true; },
    },
    items: {
      list: async () => { await ready; return store.listItems(); },
      newId: async () => { await ready; return store.newId('itm'); },
      save: async (input: any) => { await ready; return store.upsertItem(normalizeItem(input, store)); },
      remove: async (id: string) => { await ready; await store.deleteItem(id); return true; },
      discardDraft: async () => true,
    },
    photos: {
      add: async (itemId: string) => {
        await ready;
        const files = await pickFiles('image/*', true);
        const out: Photo[] = [];
        for (const file of files.slice(0, 40)) {
          try { out.push(await fileToPhoto(file, store)); } catch (err) { console.warn(err); }
        }
        return out;
      },
      addPaths: async () => [],
      remove: async () => true,
      pathForFile: () => '',
    },
    ritual: {
      state: async (day?: string) => { await ready; return engine.getState(day || dayKey()); },
      start: async (day?: string) => { await ready; return engine.start(day || dayKey()); },
      open: async (day?: string) => { await ready; return engine.open(day || dayKey()); },
      finish: async (day: string, sessionId: string) => { await ready; return engine.finishPhase(day, sessionId); },
      skip: async (day: string) => { await ready; return engine.skipPhase(day); },
      instigate: async (day: string, sessionId: string, ordered: boolean, targetStatus?: 'pending' | 'owned') => {
        await ready;
        return engine.applyInstigate(day, sessionId, { ordered, targetStatus });
      },
      stop: async (sessionId: string) => { await ready; engine.stop(sessionId); return true; },
    },
    chat: {
      send: async (sessionId: string, text: string) => { await ready; return engine.sendUserMessage(sessionId, text); },
      generate: async (sessionId: string) => {
        await ready;
        engine.generate(sessionId).catch(() => {});
        return { started: true };
      },
      stop: async (sessionId: string) => { await ready; engine.stop(sessionId); return true; },
      freeState: async () => { await ready; return engine.freeChatState(); },
      freeSend: async (text, threadId, images) => { await ready; return engine.sendFreeChatUserMessage(text, threadId, images); },
      freeGenerate: async (forceNew?: boolean, threadId?: string) => {
        await ready;
        if (engine.freeChatBusy) return { started: false };
        const thread = threadId ? store.getThread(threadId) : store.getActiveThread();
        const last = thread?.messages?.[thread.messages.length - 1];
        if (!forceNew && last?.role === 'assistant') return { started: false };
        engine.generateFreeChat({ threadId: thread?.id }).catch(() => {});
        return { started: true, threadId: thread?.id };
      },
      freeStop: async (threadId?: string) => { await ready; engine.stopFreeChat(threadId); return true; },
      freeProactive: async (threadId?: string) => { await ready; return engine.maybeProactiveFreeChat(true, threadId); },
      freeThreads: async () => { await ready; return engine.freeThreads(); },
      freeSelect: async (threadId: string) => { await ready; return engine.freeSelectThread(threadId); },
      freeNew: async (title?: string) => { await ready; return engine.freeNewThread(title); },
      freeRename: async (threadId: string, title: string) => { await ready; return engine.freeRenameThread(threadId, title); },
      freeDelete: async (threadId: string) => { await ready; return engine.freeDeleteThread(threadId); },
      itemIntro: async (input: { itemId: string; mode: 'create' | 'update'; changes?: any[] }) => {
        await ready;
        return engine.itemIntro(input);
      },
    },
    calendar: {
      month: async (year: number, month: number) => { await ready; return engine.calendar(year, month); },
      day: async (day: string) => { await ready; return engine.dayDetail(day); },
    },
    memory: {
      overview: async () => { await ready; return engine.memoryOverview(); },
      session: async (id: string) => { await ready; return store.getSession(id); },
    },
    data: {
      openDir: async () => {
        alert('手机版的数据保存在应用本地存储中。请用「导出同步包」备份或与电脑同步。');
        return '';
      },
      backup: async () => {
        await ready;
        const bytes = await exportSyncZip(store);
        const filename = `HentaiFigure-backup-${dayKey()}.zip`;
        await shareZip(bytes, filename);
        return { path: filename };
      },
      exportZip: async () => {
        await ready;
        const bytes = await exportSyncZip(store);
        const filename = `HentaiFigure-sync-${dayKey()}.zip`;
        await shareZip(bytes, filename);
        return { path: filename };
      },
      importZip: async () => {
        await ready;
        const files = await pickFiles('.zip,application/zip', false);
        if (!files.length) return { canceled: true };
        const bytes = new Uint8Array(await files[0].arrayBuffer());
        await importSyncZip(store, bytes);
        setTimeout(() => window.location.reload(), 700);
        return { imported: true };
      },
    },
    update: {
      check: async () => {
        await ready;
        lastUpdateInfo = await checkUpdate(store, lastUpdateInfo);
        emit({ type: 'update:info', info: lastUpdateInfo });
        return lastUpdateInfo;
      },
      apply: async () => {
        throw new Error('手机版请到发布页下载新的 APK；本地收藏和记忆不会受影响。');
      },
      openRelease: async () => {
        const url = lastUpdateInfo?.htmlUrl || appConfig.repoUrl;
        if (!url) return;
        if (Capacitor.isNativePlatform()) {
          await Browser.open({ url });
        } else {
          window.open(url, '_blank');
        }
      },
    },
    openExternal: async (url: string) => {
      if (!url) return;
      if (Capacitor.isNativePlatform()) {
        await Browser.open({ url });
      } else {
        window.open(url, '_blank');
      }
    },
    onEvent: (callback: (event: any) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };

  (window as any).hf = api;

  // Debug/automation hooks for sync testing. They expose only data the app
  // already shows to the trusted local renderer.
  (window as any).__hfExportSync = async () => {
    await ready;
    const bytes = await exportSyncZip(store);
    return arrayToBase64(bytes);
  };
  (window as any).__hfImportSync = async (base64: string) => {
    await ready;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return importSyncZip(store, bytes);
  };

  try {
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) engine.maybeProactiveFreeChat(false).catch(() => {});
    });
  } catch {}
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') engine.maybeProactiveFreeChat(false).catch(() => {});
  });

  void ready;
}

function dayKey(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export { APP_VERSION };






