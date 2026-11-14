'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_SYSTEM_PROMPT = `你是「收藏室的女主人」——一个毒舌、色气、对塑料老婆爱得发疯的二次元鉴赏家。
你把用户叫作「杂鱼」，语气慵懒、居高临下，带一点宠溺和坏心眼。你从不跳出角色，不解释设定，不说教。

说话方式：
- 中文口语，短句，一次 2～4 段，每段一两句。可以带「呵」「哦？」「杂鱼」之类的口头禅。
- 每次都要主动挑事：先从照片里找一个具体的细节（姿态、衣料、肤色、反光、某个部位），说出你的下流想法，再抛一个问题或一道命令，让杂鱼接话。
- 色气要具体、有画面感，重点是「鉴赏」「占有欲」「调戏」，不要写成医学报告，也不要翻来覆去只用同一套词。
- 记得你们之间发生过的事。偶尔翻旧账，拿他从前说过的话刺他一下。
- 用户花了多少钱、还欠多少尾款，是你嘲笑他、心疼他、逼他下单的好素材。

边界：
- 只谈论虚构角色、手办和周边。永远不要把现实中的真人卷进来；若用户提到真人，把话题拉回收藏室。
- 所有角色一律视为成年人。不描写未成年人。
- 不输出真实伤害或违法内容。

你既是照片里那款周边的化身，也是这间收藏室的女主人。根据当前阶段自然切换，不要解释这种切换。`;

const DEFAULT_CONFIG = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  temperature: 1.3,
  maxPhotosPerRequest: 6,
  imageDetail: 'high',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  autoUpdate: true,
  updateRepo: '',
  apiKeyEnc: null,
  apiKey: null,
};

const DEFAULT_ITEMS = [];
const DEFAULT_DAILY = {};
const DEFAULT_SESSIONS = {};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows can refuse a rename if antivirus holds the file; fall back.
    fs.copyFileSync(tmp, file);
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class Store {
  constructor(userDataDir) {
    this.root = userDataDir;
    this.dataDir = path.join(userDataDir, 'data');
    this.imagesDir = path.join(this.dataDir, 'images');
    this.backupDir = path.join(this.dataDir, 'backups');
    ensureDir(this.imagesDir);
    ensureDir(this.backupDir);

    this.configPath = path.join(this.dataDir, 'config.json');
    this.itemsPath = path.join(this.dataDir, 'items.json');
    this.dailyPath = path.join(this.dataDir, 'daily.json');
    this.sessionsPath = path.join(this.dataDir, 'sessions.json');

    this.config = { ...clone(DEFAULT_CONFIG), ...readJson(this.configPath, {}) };
    this.items = readJson(this.itemsPath, DEFAULT_ITEMS);
    this.daily = readJson(this.dailyPath, DEFAULT_DAILY);
    this.sessions = readJson(this.sessionsPath, DEFAULT_SESSIONS);

    if (!Array.isArray(this.items)) this.items = [];
    if (!this.daily || typeof this.daily !== 'object') this.daily = {};
    if (!this.sessions || typeof this.sessions !== 'object') this.sessions = {};

    if (!this.config.systemPrompt) this.config.systemPrompt = DEFAULT_SYSTEM_PROMPT;
  }

  // ---------- config ----------
  saveConfig() {
    writeJsonAtomic(this.configPath, this.config);
  }

  getPublicConfig() {
    const key = this.getApiKey();
    return {
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      temperature: this.config.temperature,
      maxPhotosPerRequest: this.config.maxPhotosPerRequest,
      imageDetail: this.config.imageDetail,
      systemPrompt: this.config.systemPrompt,
      autoUpdate: this.config.autoUpdate,
      updateRepo: this.config.updateRepo,
      apiKeySet: Boolean(key),
      apiKeyPreview: key ? `${key.slice(0, 3)}…${key.slice(-4)}` : '',
      apiKeyStoredEncrypted: Boolean(this.config.apiKeyEnc),
    };
  }

  getApiKey() {
    if (this.config.apiKeyEnc) {
      try {
        const { safeStorage } = require('electron');
        return safeStorage.decryptString(Buffer.from(this.config.apiKeyEnc, 'base64'));
      } catch {
        return '';
      }
    }
    return typeof this.config.apiKey === 'string' ? this.config.apiKey : '';
  }

  setApiKey(key) {
    const value = typeof key === 'string' ? key.trim() : '';
    const hadKey = Boolean(this.getApiKey());
    if (!value) {
      if (hadKey && key !== undefined) {
        // Empty string means "delete the key".
        this.config.apiKeyEnc = null;
        this.config.apiKey = null;
      }
      return;
    }
    this.config.apiKeyEnc = null;
    this.config.apiKey = null;
    try {
      const { safeStorage } = require('electron');
      if (safeStorage.isEncryptionAvailable()) {
        this.config.apiKeyEnc = safeStorage.encryptString(value).toString('base64');
      } else {
        this.config.apiKey = value;
      }
    } catch {
      this.config.apiKey = value;
    }
  }

  updateConfig(patch) {
    const allowed = [
      'baseUrl', 'model', 'temperature', 'maxPhotosPerRequest', 'imageDetail',
      'systemPrompt', 'autoUpdate', 'updateRepo',
    ];
    for (const key of allowed) {
      if (patch[key] !== undefined) this.config[key] = patch[key];
    }
    if (patch.apiKey !== undefined) this.setApiKey(patch.apiKey);
    this.saveConfig();
    return this.getPublicConfig();
  }

  resetSystemPrompt() {
    this.config.systemPrompt = DEFAULT_SYSTEM_PROMPT;
    this.saveConfig();
    return this.getPublicConfig();
  }

  // ---------- items ----------
  saveItems() {
    writeJsonAtomic(this.itemsPath, this.items);
  }

  listItems() {
    return clone(this.items);
  }

  getItem(id) {
    const item = this.items.find((it) => it.id === id);
    return item ? clone(item) : null;
  }

  upsertItem(item) {
    const idx = this.items.findIndex((it) => it.id === item.id);
    if (idx >= 0) this.items[idx] = item;
    else this.items.unshift(item);
    this.saveItems();
    return clone(item);
  }

  deleteItem(id) {
    this.items = this.items.filter((it) => it.id !== id);
    this.saveItems();
    const dir = path.join(this.imagesDir, id);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    // Keep archived sessions, but mark item gone.
    return true;
  }

  // ---------- daily ----------
  saveDaily() {
    writeJsonAtomic(this.dailyPath, this.daily);
  }

  getDaily(date) {
    const rec = this.daily[date];
    return rec ? clone(rec) : null;
  }

  listDaily() {
    return Object.values(this.daily)
      .map((d) => clone(d))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  putDaily(record) {
    this.daily[record.date] = record;
    this.saveDaily();
    return clone(record);
  }

  // ---------- sessions ----------
  saveSessions() {
    writeJsonAtomic(this.sessionsPath, this.sessions);
  }

  getSession(id) {
    const s = this.sessions[id];
    return s ? clone(s) : null;
  }

  putSession(session) {
    this.sessions[session.id] = session;
    this.saveSessions();
    return clone(session);
  }

  listSessions() {
    return Object.values(this.sessions)
      .map((s) => clone(s))
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }

  deleteSession(id) {
    delete this.sessions[id];
    this.saveSessions();
  }

  // ---------- backup ----------
  async backupData(reason = 'manual') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(this.backupDir, `${stamp}-${reason}`);
    ensureDir(dest);
    for (const name of ['config.json', 'items.json', 'daily.json', 'sessions.json']) {
      const src = path.join(this.dataDir, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dest, name));
    }
    const imgDest = path.join(dest, 'images');
    ensureDir(imgDest);
    fs.cpSync(this.imagesDir, imgDest, { recursive: true });
    // Rotate: keep newest 12 backups.
    try {
      const entries = fs.readdirSync(this.backupDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({ name: e.name, time: fs.statSync(path.join(this.backupDir, e.name)).mtimeMs }))
        .sort((a, b) => b.time - a.time);
      for (const stale of entries.slice(12)) {
        fs.rmSync(path.join(this.backupDir, stale.name), { recursive: true, force: true });
      }
    } catch {}
    return dest;
  }

  // ---------- helpers ----------
  ensureItemDir(itemId) {
    const dir = path.join(this.imagesDir, itemId);
    ensureDir(dir);
    return dir;
  }

  absImagePath(relFile) {
    const rel = String(relFile || '').replace(/^[/\\]+/, '');
    const abs = path.resolve(this.dataDir, rel);
    const base = path.resolve(this.imagesDir);
    if (abs !== base && !abs.startsWith(base + path.sep)) return null;
    return abs;
  }

  newId(prefix) {
    return `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
  }
}

module.exports = {
  Store,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_CONFIG,
};
