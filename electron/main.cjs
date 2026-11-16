'use strict';

const {
  app, BrowserWindow, ipcMain, protocol, net, dialog, shell, nativeImage, Menu, Notification,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const { Store } = require('./lib/store.cjs');
const { RitualService, TYPE_LABELS, localDateKey } = require('./lib/ritual.cjs');
const { SHOT_LABELS } = require('./lib/photo-catalog.mjs');
const { testConnection, friendlyError } = require('./lib/deepseek.cjs');
const { connectionTestInput, verifyVisionSettings } = require('./lib/vision-config.mjs');
const { Updater } = require('./lib/updater.cjs');

app.setName('HentaiFigure');
const userDataOverride = process.env.HF_USER_DATA;
app.setPath(
  'userData',
  userDataOverride ? path.resolve(userDataOverride) : path.join(app.getPath('appData'), 'HentaiFigure')
);
if (process.platform === 'win32') app.setAppUserModelId('com.hentaifigure.app');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'hf-img',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
]);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let store = null;
let ritual = null;
let updater = null;
let updateInfo = null;
let freeChatTimer = null;
const send = (payload) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hf:event', payload);
  } catch {}
};

const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const ALLOWED_STATUS = new Set(['owned', 'pending', 'watching']);
const ALLOWED_SHOTS = new Set(Object.keys(SHOT_LABELS));
const ALLOWED_TYPES = new Set(Object.keys(TYPE_LABELS));

function optionalNumber(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label}必须是不小于 0 的数字。`);
  return Math.round(n * 100) / 100;
}

function optionalText(value, max, label) {
  const s = value === null || value === undefined ? '' : String(value).trim();
  if (s.length > max) throw new Error(`${label}最多 ${max} 个字。`);
  return s;
}

function isDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function validatePhoto(photo, itemId) {
  if (!photo || typeof photo !== 'object') throw new Error('照片数据不合法。');
  const id = String(photo.id || '');
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(id)) throw new Error('照片 ID 不合法。');
  const file = String(photo.file || '');
  if (!file.startsWith(`images/${itemId}/`)) throw new Error('照片路径不合法。');
  const shotValue = photo.shot === 'mango' ? 'private' : photo.shot;
  const shot = ALLOWED_SHOTS.has(shotValue) ? shotValue : 'promo';
  return {
    id,
    file,
    thumbFile: typeof photo.thumbFile === 'string' ? photo.thumbFile : '',
    shot,
    caption: optionalText(photo.caption, 200, '照片备注'),
    width: Number(photo.width) || 0,
    height: Number(photo.height) || 0,
    createdAt: Number(photo.createdAt) || Date.now(),
  };
}

function normalizeItem(input) {
  if (!input || typeof input !== 'object') throw new Error('周边数据不合法。');
  const id = input.id ? String(input.id) : store.newId('itm');
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(id)) throw new Error('周边 ID 不合法。');
  const existing = store.getItem(id);
  const name = optionalText(input.name, 120, '名称');
  if (!name) throw new Error('给周边起个名字吧。');

  const status = String(input.status || '');
  if (!ALLOWED_STATUS.has(status)) throw new Error('收藏状态不合法。');
  const type = ALLOWED_TYPES.has(input.type) ? input.type : 'other';

  let characterId = optionalText(input.characterId, 80, '关联角色');
  if (characterId && !store.getCharacter(characterId)) characterId = '';
  const character = characterId ? store.getCharacter(characterId) : null;

  const photosIn = Array.isArray(input.photos) ? input.photos : [];
  if (photosIn.length > 80) throw new Error('一款周边最多 80 张照片。');
  const photos = photosIn.map((p) => validatePhoto(p, id));
  if (!photos.length) throw new Error('至少要上传一张照片。');
  if (!photos.some((p) => p.shot === 'full') && status === 'owned' && type === 'figure') {
    throw new Error('已拥有的手办至少要有一张「全身照」——先给全身照打个标签吧。');
  }

  const dueDate = input.dueDate ? String(input.dueDate) : '';
  if (dueDate && !isDateString(dueDate)) throw new Error('补款日期格式应为 YYYY-MM-DD。');

  const now = Date.now();
  const statusHistory = Array.isArray(existing?.statusHistory) ? existing.statusHistory.slice() : [];
  if (existing && existing.status !== status) {
    statusHistory.push({ from: existing.status, to: status, at: now, via: 'edit' });
  } else if (!existing && status !== 'watching') {
    statusHistory.push({ from: null, to: status, at: now, via: 'create' });
  }

  return {
    id,
    name,
    type,
    status,
    characterId,
    series: character ? [character.source, character.name].filter(Boolean).join(' / ') : '',
    scale: optionalText(input.scale, 80, '规格'),
    originalPrice: optionalNumber(input.originalPrice, '原始价格'),
    purchasePrice: optionalNumber(input.purchasePrice, '购入价格'),
    deposit: optionalNumber(input.deposit, '定金'),
    balance: optionalNumber(input.balance, '尾款'),
    detail: optionalText(input.detail, 8000, '商品详情'),
    thought: optionalText(input.thought, 8000, '最初的想法'),
    dueDate,
    photos,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastWipedAt: existing?.lastWipedAt || null,
    lastFantasyAt: existing?.lastFantasyAt || null,
    lastInstigatedAt: existing?.lastInstigatedAt || null,
    lastWipedDay: existing?.lastWipedDay || null,
    lastFantasyDay: existing?.lastFantasyDay || null,
    lastInstigatedDay: existing?.lastInstigatedDay || null,
    statusHistory,
    needsFullBodyPhoto: false,
  };
}

/** 把选中的图片缩成一张小头像，直接存进 config（data URL）。 */
function makeAvatarDataUrl(filePath) {
  const img = nativeImage.createFromPath(filePath);
  if (img.isEmpty()) throw new Error('这张图片读不出来，换一张试试。');
  const size = img.getSize();
  const side = Math.min(size.width, size.height);
  let square = img;
  if (side > 0 && size.width !== size.height) {
    square = img.crop({
      x: Math.round((size.width - side) / 2),
      y: Math.round((size.height - side) / 2),
      width: side,
      height: side,
    });
  }
  const target = 320;
  if (side > target) {
    square = square.resize({ width: target, height: target, quality: 'best' });
  }
  const buffer = square.toJPEG(86);
  if (buffer.length > 900 * 1024) throw new Error('头像太大了，换一张小一点的图片。');
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

function referencedImages(items) {
  return new Set(items.flatMap((item) => (item.photos || []).flatMap((photo) =>
    [photo.file, photo.thumbFile].filter(Boolean).map((file) => path.resolve(store.dataDir, file))
  )));
}

function pruneItemImages(itemId, referenced) {
  const dir = path.join(store.imagesDir, itemId);
  if (!fs.lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) return;
  for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, file.name);
    if (file.isFile() && !referenced.has(abs)) {
      try { fs.unlinkSync(abs); } catch {}
    }
  }
}

function cleanupOrphanImages() {
  try {
    const items = store.listItems();
    const referenced = referencedImages(items);
    for (const entry of fs.readdirSync(store.imagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const itemExists = items.some((i) => i.id === entry.name);
      if (!itemExists) {
        fs.rmSync(path.join(store.imagesDir, entry.name), { recursive: true, force: true });
        continue;
      }
      pruneItemImages(entry.name, referenced);
    }
  } catch (err) {
    console.warn('orphan cleanup failed', err);
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  const bounds = { width: 1280, height: 860 };
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: '#120b14',
    title: 'HentaiFigure',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  const emitState = () => send({ type: 'window:state', maximized: mainWindow?.isMaximized() });
  mainWindow.on('maximize', emitState);
  mainWindow.on('unmaximize', emitState);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow.webContents.getURL();
    if (url !== current) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
    if (input.type === 'keyDown' && input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerImageProtocol() {
  protocol.handle('hf-img', async (request) => {
    try {
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const abs = store.absImagePath(rel);
      if (!abs) return new Response('forbidden', { status: 403 });
      return net.fetch(pathToFileURL(abs).toString());
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

function importPhotoFiles(itemId, filePaths) {
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(String(itemId))) throw new Error('周边 ID 不合法。');
  const item = store.getItem(itemId);
  const dir = store.ensureItemDir(itemId);
  const existingPhotos = item?.photos || [];
  let hasFull = existingPhotos.some((p) => p.shot === 'full');
  const added = [];

  for (const src of filePaths) {
    try {
      const ext = path.extname(src).toLowerCase();
      if (!PHOTO_EXTENSIONS.has(ext)) continue;
      const stat = fs.statSync(src);
      if (!stat.isFile() || stat.size > 60 * 1024 * 1024) continue;
      const photoId = store.newId('ph');
      const dest = path.join(dir, `${photoId}${ext}`);
      fs.copyFileSync(src, dest);
      const img = nativeImage.createFromPath(dest);
      if (img.isEmpty()) {
        try { fs.unlinkSync(dest); } catch {}
        continue;
      }
      const size = img.getSize();
      let thumbImg = img;
      const maxThumb = 720;
      if (Math.max(size.width, size.height) > maxThumb) {
        const scale = maxThumb / Math.max(size.width, size.height);
        thumbImg = img.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'good',
        });
      }
      const thumbName = `${photoId}.thumb.jpg`;
      fs.writeFileSync(path.join(dir, thumbName), thumbImg.toJPEG(82));
      const shot = item?.status === 'owned' && item?.type === 'figure' && !hasFull ? 'full' : 'promo';
      if (shot === 'full') hasFull = true;
      added.push({
        id: photoId,
        file: `images/${itemId}/${photoId}${ext}`,
        thumbFile: `images/${itemId}/${thumbName}`,
        shot,
        caption: '',
        width: size.width,
        height: size.height,
        createdAt: Date.now(),
      });
    } catch (err) {
      console.warn('photo import failed', src, err);
    }
  }
  return added;
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    dataDir: store.dataDir,
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    isMaximized: mainWindow?.isMaximized() || false,
    updateInfo,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  }));

  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());

  ipcMain.handle('config:get', () => store.getPublicConfig());
  ipcMain.handle('config:save', async (event, patch = {}) => {
    const clean = {};
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
    if (patch.imageDetail !== undefined) {
      clean.imageDetail = patch.imageDetail === 'low' ? 'low' : 'high';
    }
    if (patch.systemPrompt !== undefined) {
      clean.systemPrompt = String(patch.systemPrompt).slice(0, 30000);
    }
    if (patch.autoUpdate !== undefined) clean.autoUpdate = Boolean(patch.autoUpdate);
    if (patch.dailyChatEnabled !== undefined) clean.dailyChatEnabled = Boolean(patch.dailyChatEnabled);
    if (patch.userName !== undefined) {
      const userName = String(patch.userName).trim().slice(0, 24);
      clean.userName = userName || '杂鱼';
    }
    if (patch.managerAvatar !== undefined) {
      const avatar = String(patch.managerAvatar || '');
      if (avatar && !/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)) {
        throw new Error('头像数据不合法。');
      }
      if (avatar.length > 2_400_000) throw new Error('头像文件太大了。');
      clean.managerAvatar = avatar;
    }
    if (patch.dailyChatTime !== undefined) {
      const time = String(patch.dailyChatTime || '').trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('主动话题时间格式应为 HH:mm。');
      clean.dailyChatTime = time;
    }
    if (patch.clearApiKey) clean.apiKey = '';
    else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) clean.apiKey = patch.apiKey.trim();
    const current = { ...store.config, apiKey: store.getApiKey() };
    try {
      clean.verifiedVision = await verifyVisionSettings({
        current,
        patch: { ...clean, verifyVision: patch.verifyVision === true },
        test: (config) => testConnection({ config, apiKey: config.apiKey }),
      });
    } catch (error) {
      throw new Error(friendlyError(error));
    }
    if (store.config.baseUrl !== current.baseUrl || store.config.model !== current.model || store.getApiKey() !== current.apiKey) {
      throw new Error('API 设置已发生变化，请重新保存。');
    }
    return store.updateConfig(clean);
  });
  ipcMain.handle('config:resetPrompt', () => store.resetSystemPrompt());
  ipcMain.handle('config:prompts:get', () => store.getPrompts());
  ipcMain.handle('config:prompts:save', (event, patch = {}) => store.savePrompts(patch));
  ipcMain.handle('config:devPromptMode:set', (event, value) => store.setDevPromptMode(value));
  ipcMain.handle('config:pickAvatar', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择管理员头像',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return makeAvatarDataUrl(result.filePaths[0]);
  });
  ipcMain.handle('config:test', async (event, input = {}) => {
    try {
      const cfg = connectionTestInput({ ...store.config, apiKey: store.getApiKey() }, input);
      const result = await testConnection({ config: cfg, apiKey: cfg.apiKey });
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, message: friendlyError(err) };
    }
  });

  ipcMain.handle('items:list', () => store.listItems());
  ipcMain.handle('items:newId', () => store.newId('itm'));

  ipcMain.handle('characters:list', () => store.listCharacters());
  ipcMain.handle('characters:save', (event, input = {}) => {
    const character = store.upsertCharacter(input);
    return character;
  });
  ipcMain.handle('characters:delete', (event, id) => {
    store.deleteCharacter(String(id || ''));
    return true;
  });

  ipcMain.handle('items:save', (event, input) => {
    const item = normalizeItem(input);
    const saved = store.upsertItem(item);
    try { pruneItemImages(saved.id, referencedImages(store.listItems())); } catch (err) {
      console.warn('photo cleanup failed', err);
    }
    return saved;
  });
  ipcMain.handle('items:delete', (event, id) => {
    const existing = store.getItem(id);
    if (!existing) return true;
    store.deleteItem(id);
    return true;
  });
  ipcMain.handle('items:discardDraft', (event, id) => {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{4,80}$/.test(id)) return false;
    pruneItemImages(id, referencedImages(store.listItems()));
    if (!store.getItem(id)) {
      try { fs.rmdirSync(path.join(store.imagesDir, id)); } catch {}
    }
    return true;
  });

  ipcMain.handle('photos:add', async (event, { itemId, multiple = true } = {}) => {
    if (!/^[A-Za-z0-9_-]{4,80}$/.test(String(itemId))) throw new Error('周边 ID 不合法。');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: multiple ? '选择照片（可多选）' : '选择替换照片',
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [
        { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return [];
    const photos = importPhotoFiles(itemId, result.filePaths);
    if (!photos.length) throw new Error('没有可用的图片，请选择支持的图片格式（单张最多 60MB）。');
    return photos;
  });

  ipcMain.handle('photos:addPaths', (event, { itemId, paths } = {}) => {
    const list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string').slice(0, 40) : [];
    if (!list.length) return [];
    return importPhotoFiles(itemId, list);
  });

  ipcMain.handle('ritual:state', (event, day) => ritual.getState(day || localDateKey()));
  ipcMain.handle('ritual:start', (event, day) => ritual.start(day || localDateKey()));
  ipcMain.handle('ritual:open', (event, day) => ritual.open(day || localDateKey()));
  ipcMain.handle('ritual:finish', async (event, { day, sessionId } = {}) => {
    return ritual.finishPhase(day || localDateKey(), sessionId);
  });
  ipcMain.handle('ritual:skip', (event, day) => ritual.skipPhase(day || localDateKey()));
  ipcMain.handle('ritual:instigate', async (event, { day, sessionId, ordered, targetStatus } = {}) => {
    return ritual.applyInstigate(day || localDateKey(), sessionId, { ordered: Boolean(ordered), targetStatus });
  });
  ipcMain.handle('ritual:stop', (event, sessionId) => {
    ritual.stop(sessionId);
    return true;
  });

  ipcMain.handle('chat:send', async (event, { sessionId, text } = {}) => {
    return ritual.sendUserMessage(sessionId, text);
  });
  ipcMain.handle('chat:generate', (event, sessionId) => {
    if (!sessionId) throw new Error('缺少会话 ID');
    ritual.generate(sessionId).catch(() => {});
    return { started: true };
  });
  ipcMain.handle('chat:stop', (event, sessionId) => {
    ritual.stop(sessionId);
    return true;
  });

  ipcMain.handle('chat:free:state', () => ritual.freeChatState());
  ipcMain.handle('chat:free:logs', (event, threadId) => ritual.freeChatLog.list(threadId));
  ipcMain.handle('chat:free:threads', () => ritual.freeThreads());
  ipcMain.handle('chat:free:select', (event, threadId) => ritual.freeSelectThread(String(threadId || '')));
  ipcMain.handle('chat:free:new', (event, title) => ritual.freeNewThread(typeof title === 'string' ? title : undefined));
  ipcMain.handle('chat:free:rename', (event, { threadId, title } = {}) => ritual.freeRenameThread(String(threadId || ''), title));
  ipcMain.handle('chat:free:delete', (event, threadId) => ritual.freeDeleteThread(String(threadId || '')));
  ipcMain.handle('chat:free:send', (event, { text, threadId, images } = {}) => ritual.sendFreeChatUserMessage(text, threadId, images));
  ipcMain.handle('chat:free:generate', (event, { forceNew, threadId } = {}) => {
    if (ritual.freeChatBusy) return { started: false };
    const thread = threadId ? store.getThread(threadId) : store.ensureActiveThread();
    const last = thread?.messages?.[thread.messages.length - 1];
    if (!forceNew && last?.role === 'assistant') return { started: false };
    ritual.generateFreeChat({ threadId: thread?.id }).catch(() => {});
    return { started: true, threadId: thread?.id };
  });
  ipcMain.handle('chat:free:stop', (event, threadId) => {
    ritual.stopFreeChat(threadId || undefined);
    return true;
  });
  ipcMain.handle('chat:free:proactive', async (event, threadId) => {
    const result = await ritual.maybeProactiveFreeChat(true, threadId || undefined);
    if (result?.message) notifyFreeChat(result.message, result.threadId);
    return result;
  });
  ipcMain.handle('chat:itemIntro', async (event, input = {}) => {
    const result = await ritual.itemIntro({
      itemId: String(input.itemId || ''),
      mode: input.mode === 'update' ? 'update' : 'create',
      changes: Array.isArray(input.changes) ? input.changes : [],
    });
    return result;
  });

  ipcMain.handle('calendar:month', (event, { year, month } = {}) => {
    const now = new Date();
    return ritual.calendar(Number(year) || now.getFullYear(), Number(month) || now.getMonth() + 1);
  });
  ipcMain.handle('calendar:day', (event, day) => ritual.dayDetail(day));

  ipcMain.handle('memory:overview', () => {
    const data = ritual.memoryOverview();
    return {
      stats: data.stats,
      items: data.items,
      sessions: data.sessions.map((s) => ({
        id: s.id,
        itemId: s.itemId,
        itemName: s.itemName,
        phase: s.phase,
        day: s.day,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        archived: s.archived,
        summary: s.summary,
        outcome: s.outcome,
        messageCount: (s.messages || []).length,
      })),
    };
  });
  ipcMain.handle('memory:session', (event, id) => store.getSession(id));

  ipcMain.handle('data:openDir', () => shell.openPath(store.dataDir));
  ipcMain.handle('data:backup', async () => {
    const dest = await store.backupData('manual');
    return { path: dest };
  });
  ipcMain.handle('data:export', async () => {
    const stamp = localDateKey();
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '导出 HentaiFigure 备份',
      defaultPath: path.join(app.getPath('documents'), `HentaiFigure-backup-${stamp}.zip`),
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-export-'));
    try {
      for (const name of ['config.json', 'items.json', 'characters.json', 'daily.json', 'sessions.json', 'freechat.json']) {
        const src = path.join(store.dataDir, name);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(stage, name));
      }
      fs.cpSync(store.imagesDir, path.join(stage, 'images'), { recursive: true });
      if (fs.existsSync(res.filePath)) fs.unlinkSync(res.filePath);
      const ps = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Compress-Archive -Path '${stage.replace(/'/g, "''")}\\*' -DestinationPath '${res.filePath.replace(/'/g, "''")}' -Force`],
        { encoding: 'utf8', timeout: 180000, windowsHide: true }
      );
      if (ps.status !== 0) throw new Error(ps.stderr || '压缩失败');
      return { path: res.filePath };
    } finally {
      try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}
    }
  });
  ipcMain.handle('data:import', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择 HentaiFigure 备份压缩包',
      properties: ['openFile'],
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    const confirm = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['取消', '导入并重启'],
      defaultId: 0,
      cancelId: 0,
      title: '导入备份',
      message: '导入会覆盖当前的收藏、照片和记忆。',
      detail: '导入前会自动备份当前数据。确定继续吗？',
    });
    if (confirm.response !== 1) return { canceled: true };

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-import-'));
    try {
      const ps = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath '${res.filePaths[0].replace(/'/g, "''")}' -DestinationPath '${tmp.replace(/'/g, "''")}' -Force`],
        { encoding: 'utf8', timeout: 180000, windowsHide: true }
      );
      if (ps.status !== 0) throw new Error(ps.stderr || '解压失败');
      const root = fs.existsSync(path.join(tmp, 'items.json')) ? tmp : path.join(tmp, 'data');
      if (!fs.existsSync(path.join(root, 'items.json'))) throw new Error('备份包里没有 items.json，可能不是 HentaiFigure 的备份。');
      await store.backupData('before-import');
      for (const name of ['config.json', 'items.json', 'characters.json', 'daily.json', 'sessions.json', 'freechat.json']) {
        const src = path.join(root, name);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(store.dataDir, name));
      }
      if (fs.existsSync(path.join(root, 'images'))) {
        fs.rmSync(store.imagesDir, { recursive: true, force: true });
        fs.cpSync(path.join(root, 'images'), store.imagesDir, { recursive: true });
      }
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 500);
      return { imported: true };
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  });

  ipcMain.handle('update:check', async (event, { silent } = {}) => {
    try {
      updateInfo = await updater.check();
      send({ type: 'update:info', info: updateInfo });
      if (updateInfo.available && !silent) send({ type: 'update:available', info: updateInfo });
      return updateInfo;
    } catch (err) {
      return { configured: false, available: false, error: err.message || String(err) };
    }
  });
  ipcMain.handle('update:apply', async () => {
    if (app.isPackaged) {
      throw new Error('便携版暂不支持自动更新。请到发布页下载新版本，再把新文件夹放到原位置；本地数据不会受影响。');
    }
    try {
      const result = await updater.apply((stage, message) => {
        send({ type: 'update:progress', stage, message });
      });
      if (result.updated) {
        setTimeout(() => {
          app.relaunch();
          app.exit(0);
        }, 900);
      }
      return result;
    } catch (err) {
      send({ type: 'update:progress', stage: 'error', message: err.message || String(err) });
      throw err;
    }
  });
  ipcMain.handle('update:openRelease', () => {
    if (updateInfo?.htmlUrl) shell.openExternal(updateInfo.htmlUrl);
  });
  ipcMain.handle('shell:openExternal', (event, url) => {
    if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url));
  });
}

async function runStartupUpdateCheck() {
  try {
    if (!store.config.autoUpdate) return;
    updateInfo = await updater.check();
    send({ type: 'update:info', info: updateInfo });
    if (updateInfo.available) send({ type: 'update:available', info: updateInfo });
  } catch {}
}

function notifyFreeChat(message, threadId) {
  if (!message) return;
  send({ type: 'free:proactive', message, threadId, channel: 'freechat' });
  try {
    if (Notification.isSupported()) {
      const body = String(message.content || '').replace(/\s+/g, ' ').slice(0, 140);
      const notification = new Notification({
        title: '收藏室管理员',
        body: body || '她来找你了。',
        silent: false,
      });
      notification.on('click', () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        send({ type: 'free:focus', threadId, channel: 'freechat' });
      });
      notification.show();
    }
  } catch {}
}

function startFreeChatWatch() {
  if (freeChatTimer) clearInterval(freeChatTimer);
  const tick = async () => {
    try {
      if (!ritual || ritual.freeChatBusy) return;
      const result = await ritual.maybeProactiveFreeChat(false);
      if (result?.message) notifyFreeChat(result.message, result.threadId);
    } catch {}
  };
  setTimeout(tick, 6500);
  freeChatTimer = setInterval(tick, 60000);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'), { defaultsWritable: !app.isPackaged });
  cleanupOrphanImages();
  ritual = new RitualService({ store, sendEvent: send });
  updater = new Updater({
    root: app.getAppPath(),
    config: store.config,
    backup: (reason) => store.backupData(reason),
  });
  registerImageProtocol();
  registerIpc();
  createWindow();

  setTimeout(runStartupUpdateCheck, 3500);
  startFreeChatWatch();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  try {
    if (freeChatTimer) clearInterval(freeChatTimer);
    ritual?.stopFreeChat?.();
    for (const id of ritual?.controllers.keys() || []) ritual.stop(id);
  } catch {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection', err);
});




