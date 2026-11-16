'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const promptLib = require('./prompts.cjs');
const { DEEPSEEK_URL, DEFAULT_VISION_MODEL, isVisionReady, migrateVisionModel } = require('./vision-config.mjs');
const { dailyChatScheduleChanged } = require('./daily-chat-schedule.mjs');

// 默认人格来自 electron/prompts.default.json（键 persona），
// 不在代码里写死；用户可以在进阶设置里单独覆盖，或由开发人员模式写回默认文件。
const DEFAULT_SYSTEM_PROMPT = promptLib.get('persona');

const DEFAULT_CONFIG = {
  baseUrl: DEEPSEEK_URL,
  model: DEFAULT_VISION_MODEL,
  temperature: 1.3,
  imageDetail: 'high',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  prompts: {},
  devPromptMode: false,
  userName: '杂鱼',
  managerAvatar: '',
  autoUpdate: true,
  dailyChatEnabled: true,
  dailyChatTime: '22:00',
  dailyChatScheduleChangedAt: 0,
  apiKeyEnc: null,
  apiKey: null,
};

const DEFAULT_ITEMS = [];
const DEFAULT_CHARACTERS = [];
const DEFAULT_DAILY = {};
const DEFAULT_SESSIONS = {};
const DEFAULT_THREAD_TITLE = '新的对话';
const DEFAULT_FREECHAT = {
  threads: {},
  activeId: '',
  lastProactiveDay: null,
  lastProactiveAt: null,
  lastAttemptAt: null,
  createdAt: 0,
  updatedAt: 0,
};

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

function cleanText(value, max) {
  const text = value === null || value === undefined ? '' : String(value);
  return text.slice(0, max);
}

/** 从第一句话里裁出一个像样的会话标题。 */
function makeThreadTitle(text, fallback = DEFAULT_THREAD_TITLE) {
  const flat = String(text || '').replace(/[#>*`_~]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!flat) return fallback;
  const cleaned = flat.replace(/^【[^】]*】\s*/, '');
  const firstSentence = (cleaned.split(/[。！？!?\n]/)[0] || cleaned).trim();
  const base = firstSentence.length >= 4 ? firstSentence : cleaned;
  return base.length > 20 ? `${base.slice(0, 20)}…` : base || fallback;
}

function newThread(id, { title, origin = 'manual', itemId = null } = {}) {
  const now = Date.now();
  return {
    id,
    title: title || DEFAULT_THREAD_TITLE,
    messages: [],
    createdAt: now,
    updatedAt: now,
    origin,
    itemId: itemId || null,
  };
}

function threadPreview(thread) {
  const last = (thread.messages || [])[thread.messages.length - 1];
  if (!last) return '还没有开口。';
  return String(last.content || '').replace(/\s+/g, ' ').slice(0, 90) || (last.images?.length ? '[图片]' : '');
}

function threadSummary(thread) {
  return {
    id: thread.id,
    title: thread.title || DEFAULT_THREAD_TITLE,
    createdAt: thread.createdAt || 0,
    updatedAt: thread.updatedAt || 0,
    messageCount: (thread.messages || []).length,
    preview: threadPreview(thread),
    origin: thread.origin || 'manual',
    itemId: thread.itemId || null,
  };
}

function normalizeThread(id, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const messages = Array.isArray(raw.messages) ? raw.messages : [];
  const createdAt = Number(raw.createdAt) || Number(messages[0]?.ts) || Date.now();
  const updatedAt = Number(raw.updatedAt) || Number(messages[messages.length - 1]?.ts) || createdAt;
  return {
    id: String(raw.id || id),
    title: String(raw.title || '').slice(0, 60) || makeThreadTitle(messages[0]?.content, DEFAULT_THREAD_TITLE),
    messages,
    createdAt,
    updatedAt,
    origin: ['manual', 'daily', 'item'].includes(raw.origin) ? raw.origin : 'manual',
    itemId: raw.itemId ? String(raw.itemId) : null,
  };
}

function normalizeFreeChat(raw) {
  const chat = { ...clone(DEFAULT_FREECHAT), ...(raw && typeof raw === 'object' ? raw : {}) };
  const threads = {};
  const sourceThreads = chat.threads && typeof chat.threads === 'object' ? chat.threads : {};
  for (const [id, value] of Object.entries(sourceThreads)) {
    const thread = normalizeThread(id, value);
    if (thread) threads[thread.id] = thread;
  }
  // v1 只有一条和日常聊天共用的 messages 数组，搬进一条会话里。
  if (!Object.keys(threads).length && Array.isArray(chat.messages) && chat.messages.length) {
    const messages = chat.messages;
    const id = `thr_${crypto.randomBytes(6).toString('base64url')}`;
    threads[id] = {
      id,
      title: '收藏室的日常',
      messages,
      createdAt: Number(chat.createdAt) || Number(messages[0]?.ts) || Date.now(),
      updatedAt: Number(chat.updatedAt) || Number(messages[messages.length - 1]?.ts) || Date.now(),
      origin: 'manual',
      itemId: null,
    };
    chat.activeId = id;
  }
  delete chat.messages;
  const ids = Object.keys(threads);
  if (!threads[chat.activeId]) {
    const newest = ids
      .map((id) => threads[id])
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    chat.activeId = newest ? newest.id : '';
  }
  chat.threads = threads;
  return chat;
}

class Store {
  constructor(userDataDir, options = {}) {
    this.root = userDataDir;
    this.dataDir = path.join(userDataDir, 'data');
    this.imagesDir = path.join(this.dataDir, 'images');
    this.backupDir = path.join(this.dataDir, 'backups');
    // 打包后 app.asar 是只读的，开发人员模式不能再改系统默认提示词。
    this.defaultsWritable = options.defaultsWritable !== false;
    ensureDir(this.imagesDir);
    ensureDir(this.backupDir);

    this.configPath = path.join(this.dataDir, 'config.json');
    this.itemsPath = path.join(this.dataDir, 'items.json');
    this.charactersPath = path.join(this.dataDir, 'characters.json');
    this.dailyPath = path.join(this.dataDir, 'daily.json');
    this.sessionsPath = path.join(this.dataDir, 'sessions.json');
    this.freechatPath = path.join(this.dataDir, 'freechat.json');

    this.config = { ...clone(DEFAULT_CONFIG), ...readJson(this.configPath, {}) };
    const model = migrateVisionModel(this.config);
    let configChanged = model !== this.config.model;
    if (Object.hasOwn(this.config, 'maxPhotosPerRequest')) {
      delete this.config.maxPhotosPerRequest;
      configChanged = true;
    }
    this.config.model = model;
    this.items = readJson(this.itemsPath, DEFAULT_ITEMS);
    this.characters = readJson(this.charactersPath, DEFAULT_CHARACTERS);
    this.daily = readJson(this.dailyPath, DEFAULT_DAILY);
    this.sessions = readJson(this.sessionsPath, DEFAULT_SESSIONS);
    const rawFreechat = readJson(this.freechatPath, {});
    this.freechat = normalizeFreeChat(rawFreechat);

    if (!Array.isArray(this.items)) this.items = [];
    if (!Array.isArray(this.characters)) this.characters = [];
    if (!this.daily || typeof this.daily !== 'object') this.daily = {};
    if (!this.sessions || typeof this.sessions !== 'object') this.sessions = {};
    if (typeof this.config.userName !== 'string' || !this.config.userName.trim()) this.config.userName = '杂鱼';
    if (typeof this.config.managerAvatar !== 'string') this.config.managerAvatar = '';
    if (!this.config.prompts || typeof this.config.prompts !== 'object' || Array.isArray(this.config.prompts)) {
      this.config.prompts = {};
    }
    if (Object.hasOwn(this.config.prompts, 'ritual.photoNoteNoVision')) {
      delete this.config.prompts['ritual.photoNoteNoVision'];
      configChanged = true;
    }
    this.config.devPromptMode = Boolean(this.config.devPromptMode);

    let migrated = false;
    for (const item of this.items) {
      for (const photo of item.photos || []) {
        if (photo.shot === 'mango') {
          photo.shot = 'private';
          migrated = true;
        }
      }
      // v1 只有一个「简介」字段，实际写的是购买时的心路历程。
      if (typeof item.intro === 'string' && !item.thought) {
        item.thought = item.intro;
        migrated = true;
      }
      if (item.intro !== undefined) {
        delete item.intro;
        migrated = true;
      }
      if (typeof item.detail !== 'string') {
        item.detail = '';
        migrated = true;
      }
      if (typeof item.thought !== 'string') {
        item.thought = '';
        migrated = true;
      }
    }
    // v1 的「作品 / 角色」是自由文本，升级成角色档案并自动关联。
    if (this.syncCharactersFromItems()) migrated = true;

    if (migrated) this.saveItems();
    this.saveCharacters();
    if (rawFreechat && Array.isArray(rawFreechat.messages)) {
      writeJsonAtomic(this.freechatPath, this.freechat);
    }

    // 旧版本把人格底色直接存在 systemPrompt 里，而且默认值是写死在代码里的。
    // 现在默认值在 electron/prompts.default.json：旧值和新默认不同就搬进 prompt 覆盖层，
    // 等于默认值（或第一版的「化身」提示词）就什么都不用做。
    const persona = String(this.config.systemPrompt || '').trim();
    const defaultPersona = String(DEFAULT_SYSTEM_PROMPT || '').trim();
    const v1Hint = '你既是照片里那款周边的化身';
    if (!persona || persona.includes(v1Hint)) {
      delete this.config.prompts.persona;
      this.config.systemPrompt = DEFAULT_SYSTEM_PROMPT;
      configChanged = true;
    } else if (!this.config.prompts.persona && persona !== defaultPersona) {
      this.config.prompts.persona = persona.slice(0, 30000);
      configChanged = true;
    }
    if (configChanged) this.saveConfig();
  }

  /** 给没有 characterId 的老藏品补一份角色档案。 */
  syncCharactersFromItems() {
    let changed = false;
    for (const item of this.items) {
      if (item.characterId && this.characters.some((c) => c.id === item.characterId)) continue;
      const name = String(item.series || '').trim();
      if (!name) {
        if (item.characterId) {
          delete item.characterId;
          changed = true;
        }
        continue;
      }
      const existing = this.characters.find((c) => c.name === name);
      if (existing) {
        item.characterId = existing.id;
        changed = true;
        continue;
      }
      const now = Date.now();
      const character = {
        id: this.newId('chr'),
        name: name.slice(0, 80),
        source: '',
        description: '',
        createdAt: now,
        updatedAt: now,
      };
      this.characters.unshift(character);
      item.characterId = character.id;
      changed = true;
    }
    return changed;
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
      visionModelReady: isVisionReady(this.config),
      temperature: this.config.temperature,
      imageDetail: this.config.imageDetail,
      systemPrompt: this.promptValues().persona || '',
      userName: this.config.userName || '杂鱼',
      managerAvatar: this.config.managerAvatar || '',
      autoUpdate: this.config.autoUpdate,
      dailyChatEnabled: this.config.dailyChatEnabled !== false,
      dailyChatTime: this.config.dailyChatTime || '22:00',
      prompts: this.promptBundle(),
      apiKeySet: Boolean(key),
      apiKeyPreview: key ? `${key.slice(0, 3)}…${key.slice(-4)}` : '',
      apiKeyStoredEncrypted: Boolean(this.config.apiKeyEnc),
    };
  }

  // ---------- prompts ----------
  /** 当前生效的提示词：系统默认 + 用户覆盖层。 */
  promptValues() {
    return promptLib.resolve(this.config.prompts);
  }

  promptBundle() {
    return {
      defaults: { ...promptLib.defaults },
      overrides: { ...this.config.prompts },
      resolved: this.promptValues(),
      devPromptMode: Boolean(this.config.devPromptMode),
      defaultsEditable: Boolean(this.defaultsWritable),
      defaultsPath: promptLib.DEFAULTS_PATH,
    };
  }

  getPrompts() {
    return this.promptBundle();
  }

  /**
   * 保存提示词。
   * 普通模式：写进用户层的 config.prompts（只保存和默认值不同的键）。
   * 开发人员模式：直接改 electron/prompts.default.json，等于改掉系统默认值。
   */
  savePrompts({ prompts = {}, reset = [] } = {}) {
    const values = prompts && typeof prompts === 'object' && !Array.isArray(prompts) ? prompts : {};
    const resetKeys = (Array.isArray(reset) ? reset : []).filter((key) => promptLib.has(key));
    const clean = {};
    for (const [key, value] of Object.entries(values)) {
      if (!promptLib.has(key)) continue;
      clean[key] = String(value === undefined || value === null ? '' : value).slice(0, 30000);
    }

    if (this.config.devPromptMode) {
      if (!this.defaultsWritable) {
        throw new Error('当前版本不能修改系统默认提示词。请在源码目录里用开发模式运行，或关闭开发人员选项。');
      }
      const next = { ...clean };
      for (const key of resetKeys) delete next[key];
      if (Object.keys(next).length) promptLib.writeDefaults(next);
      // 默认值变了，用户层里残留的同名覆盖会被覆盖掉，这里一并清掉避免两份不一致。
      for (const key of [...Object.keys(next), ...resetKeys]) delete this.config.prompts[key];
    } else {
      for (const [key, value] of Object.entries(clean)) {
        if (!value.trim() || value.trim() === String(promptLib.get(key)).trim()) {
          delete this.config.prompts[key];
        } else {
          this.config.prompts[key] = value;
        }
      }
      for (const key of resetKeys) delete this.config.prompts[key];
    }

    // systemPrompt 是历史字段，继续镜像人格底色，避免老代码读到空值。
    this.config.systemPrompt = this.promptValues().persona || '';
    this.saveConfig();
    return this.getPublicConfig();
  }

  setDevPromptMode(value) {
    this.config.devPromptMode = Boolean(value);
    this.saveConfig();
    return this.getPublicConfig();
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
    if (dailyChatScheduleChanged(this.config, patch)) this.config.dailyChatScheduleChangedAt = Date.now();
    const allowed = [
      'baseUrl', 'model', 'verifiedVision', 'temperature', 'imageDetail',
      'autoUpdate', 'dailyChatEnabled', 'dailyChatTime',
      'userName', 'managerAvatar',
    ];
    for (const key of allowed) {
      if (patch[key] !== undefined) this.config[key] = patch[key];
    }
    // 人格底色走提示词覆盖层：等于默认值时不留覆盖，改过才记下来。
    if (patch.systemPrompt !== undefined) {
      const text = String(patch.systemPrompt).slice(0, 30000);
      if (!text.trim() || text.trim() === String(promptLib.get('persona')).trim()) {
        delete this.config.prompts.persona;
      } else {
        this.config.prompts.persona = text;
      }
      this.config.systemPrompt = this.promptValues().persona || '';
    }
    if (patch.apiKey !== undefined) this.setApiKey(patch.apiKey);
    this.saveConfig();
    return this.getPublicConfig();
  }

  resetSystemPrompt() {
    delete this.config.prompts.persona;
    this.config.systemPrompt = this.promptValues().persona || '';
    this.saveConfig();
    return this.getPublicConfig();
  }

  // ---------- characters ----------
  saveCharacters() {
    writeJsonAtomic(this.charactersPath, this.characters);
  }

  listCharacters() {
    return clone(this.characters);
  }

  getCharacter(id) {
    const character = this.characters.find((c) => c.id === id);
    return character ? clone(character) : null;
  }

  findCharacterByName(name) {
    const target = String(name || '').trim();
    if (!target) return null;
    const character = this.characters.find((c) => c.name === target);
    return character ? clone(character) : null;
  }

  upsertCharacter(input = {}) {
    const name = cleanText(input.name, 80).trim();
    if (!name) throw new Error('角色名不能为空。');
    const now = Date.now();
    const existing = input.id ? this.characters.find((c) => c.id === input.id) : null;
    if (existing) {
      existing.name = name;
      existing.source = cleanText(input.source, 120).trim();
      existing.description = cleanText(input.description, 4000).trim();
      existing.updatedAt = now;
      this.saveCharacters();
      return clone(existing);
    }
    const character = {
      id: this.newId('chr'),
      name,
      source: cleanText(input.source, 120).trim(),
      description: cleanText(input.description, 4000).trim(),
      createdAt: now,
      updatedAt: now,
    };
    this.characters.unshift(character);
    this.saveCharacters();
    return clone(character);
  }

  deleteCharacter(id) {
    this.characters = this.characters.filter((c) => c.id !== id);
    this.saveCharacters();
    let changed = false;
    for (const item of this.items) {
      if (item.characterId === id) {
        delete item.characterId;
        item.updatedAt = Date.now();
        changed = true;
      }
    }
    if (changed) this.saveItems();
    return true;
  }

  // ---------- items ----------
  saveItems(items = this.items) {
    writeJsonAtomic(this.itemsPath, items);
  }

  listItems() {
    return clone(this.items);
  }

  getItem(id) {
    const item = this.items.find((it) => it.id === id);
    return item ? clone(item) : null;
  }

  upsertItem(item) {
    const next = this.items.slice();
    const idx = next.findIndex((it) => it.id === item.id);
    if (idx >= 0) next[idx] = item;
    else next.unshift(item);
    this.saveItems(next);
    this.items = next;
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

  // ---------- free chat (multi-thread) ----------
  saveFreeChat() {
    this.freechat.updatedAt = Date.now();
    writeJsonAtomic(this.freechatPath, this.freechat);
  }

  /** 兼容旧接口：返回当前会话的消息，附带会话列表。 */
  getFreeChat() {
    const active = this.getActiveThread();
    return {
      messages: active ? clone(active.messages) : [],
      threads: this.listThreadSummaries(),
      activeId: active ? active.id : '',
      lastMessage: this.lastMessage(),
      lastProactiveDay: this.freechat.lastProactiveDay || null,
      lastProactiveAt: this.freechat.lastProactiveAt || null,
      lastAttemptAt: this.freechat.lastAttemptAt || null,
      createdAt: this.freechat.createdAt || 0,
      updatedAt: this.freechat.updatedAt || 0,
    };
  }

  putFreeChat(value = {}) {
    // 兼容旧调用：只接受非会话字段；会话请用 putThread。
    for (const key of ['lastProactiveDay', 'lastProactiveAt', 'lastAttemptAt']) {
      if (value[key] !== undefined) this.freechat[key] = value[key];
    }
    if (value.activeId !== undefined) this.setActiveThread(value.activeId);
    this.saveFreeChat();
    return this.getFreeChat();
  }

  sortedThreads() {
    return Object.values(this.freechat.threads)
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  listThreadSummaries() {
    return this.sortedThreads().map((t) => threadSummary(t));
  }

  getThread(id) {
    const thread = id ? this.freechat.threads[id] : null;
    return thread ? clone(thread) : null;
  }

  getActiveThread() {
    const active = this.getThread(this.freechat.activeId);
    if (active) return active;
    const newest = this.sortedThreads()[0];
    if (newest) {
      this.freechat.activeId = newest.id;
      return clone(newest);
    }
    return null;
  }

  setActiveThread(id) {
    if (id && this.freechat.threads[id]) {
      this.freechat.activeId = id;
      this.saveFreeChat();
    }
    return this.getActiveThread();
  }

  newThread(options) {
    return newThread(this.newId('thr'), options);
  }

  createThread(options) {
    const thread = this.newThread(options);
    this.freechat.threads[thread.id] = thread;
    this.freechat.activeId = thread.id;
    this.saveFreeChat();
    return clone(thread);
  }

  ensureActiveThread() {
    const active = this.getActiveThread();
    if (active) return active;
    return this.createThread({});
  }

  putThread(thread, { proactiveDay } = {}) {
    if (!thread || !thread.id) throw new Error('会话数据不合法。');
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    thread.updatedAt = Date.now();
    thread.createdAt = Number(thread.createdAt) || Date.now();
    if (!thread.title || thread.title === DEFAULT_THREAD_TITLE) {
      const first = messages.find((m) => m.role === 'user') || messages[0];
      if (first) thread.title = makeThreadTitle(first.content, DEFAULT_THREAD_TITLE);
    }
    this.freechat.threads[thread.id] = normalizeThread(thread.id, thread);
    if (proactiveDay) {
      this.freechat.lastProactiveDay = proactiveDay;
      this.freechat.lastProactiveAt = messages[0].ts;
      this.freechat.lastAttemptAt = messages[0].ts;
    }
    if (!proactiveDay || !this.freechat.activeId) this.freechat.activeId = thread.id;
    this.saveFreeChat();
    return clone(this.freechat.threads[thread.id]);
  }

  appendThreadMessage(threadId, message) {
    const current = this.getThread(threadId);
    if (!current) return null;
    const thread = current;
    thread.messages.push(message);
    thread.updatedAt = Date.now();
    if (!thread.title || thread.title === DEFAULT_THREAD_TITLE) {
      const first = thread.messages.find((m) => m.role === 'user') || thread.messages[0];
      if (first) thread.title = makeThreadTitle(first.content, DEFAULT_THREAD_TITLE);
    }
    const previous = this.freechat.threads[thread.id];
    const previousUpdatedAt = this.freechat.updatedAt;
    this.freechat.threads[thread.id] = normalizeThread(thread.id, thread);
    try {
      this.saveFreeChat();
    } catch (err) {
      this.freechat.threads[thread.id] = previous;
      this.freechat.updatedAt = previousUpdatedAt;
      throw err;
    }
    return clone(this.freechat.threads[thread.id]);
  }

  renameThread(id, title) {
    const thread = this.freechat.threads[id];
    if (!thread) throw new Error('这个对话不在了。');
    const next = cleanText(title, 60).trim();
    thread.title = next || DEFAULT_THREAD_TITLE;
    thread.updatedAt = Date.now();
    this.saveFreeChat();
    return this.listThreadSummaries();
  }

  deleteThread(id) {
    if (!this.freechat.threads[id]) return this.getFreeChat();
    delete this.freechat.threads[id];
    if (this.freechat.activeId === id) {
      const newest = this.sortedThreads()[0];
      this.freechat.activeId = newest ? newest.id : '';
    }
    this.saveFreeChat();
    return this.getFreeChat();
  }

  lastMessage() {
    let best = null;
    for (const thread of this.sortedThreads()) {
      const last = thread.messages[thread.messages.length - 1];
      if (!last) continue;
      if (!best || (last.ts || 0) > (best.ts || 0)) best = last;
    }
    return best ? clone(best) : null;
  }

  // ---------- backup ----------
  async backupData(reason = 'manual') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(this.backupDir, `${stamp}-${reason}`);
    ensureDir(dest);
    for (const name of ['config.json', 'items.json', 'characters.json', 'daily.json', 'sessions.json', 'freechat.json']) {
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
  DEFAULT_THREAD_TITLE,
  makeThreadTitle,
  threadSummary,
};
