import type {
  Character, ChatMessage, ChatThread, ChatThreadSummary, Config, FreeChatState, Item, Session,
} from '../src/types';
import { PROMPT_DEFAULTS, resolvePrompts } from '../src/prompts';
import { DEEPSEEK_URL, DEFAULT_VISION_MODEL, isVisionReady, migrateVisionModel } from '../electron/lib/vision-config.mjs';
import { dailyChatScheduleChanged } from '../electron/lib/daily-chat-schedule.mjs';

const DB_NAME = 'hentaifigure';
const DB_VERSION = 2;
const STORE_NAME = 'kv';

// 默认人格来自 electron/prompts.default.json，不在代码里写死。
export const DEFAULT_SYSTEM_PROMPT = PROMPT_DEFAULTS.persona || '';

export interface MobileConfig {
  baseUrl: string;
  model: string;
  verifiedVision?: string;
  temperature: number;
  imageDetail: 'high' | 'low';
  systemPrompt: string;
  prompts: Record<string, string>;
  devPromptMode: boolean;
  userName: string;
  managerAvatar: string;
  autoUpdate: boolean;
  dailyChatEnabled: boolean;
  dailyChatTime: string;
  dailyChatScheduleChangedAt: number;
  apiKey: string;
}

export interface FreeChat {
  threads: Record<string, ChatThread>;
  activeId: string;
  lastProactiveDay: string | null;
  lastProactiveAt: number | null;
  lastAttemptAt: number | null;
  createdAt: number;
  updatedAt: number;
}

type NewThreadOptions = { title?: string; origin?: ChatThread['origin']; itemId?: string | null };

const DEFAULT_THREAD_TITLE = '新的对话';

const DEFAULT_CONFIG: MobileConfig = {
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
  apiKey: '',
};

const DEFAULT_FREECHAT: FreeChat = {
  threads: {},
  activeId: '',
  lastProactiveDay: null,
  lastProactiveAt: null,
  lastAttemptAt: null,
  createdAt: 0,
  updatedAt: 0,
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbClear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function makeThreadTitle(text: string | undefined, fallback = DEFAULT_THREAD_TITLE): string {
  const flat = String(text || '').replace(/[#>*`_~]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!flat) return fallback;
  const cleaned = flat.replace(/^【[^】]*】\s*/, '');
  const firstSentence = (cleaned.split(/[。！？!?\n]/)[0] || cleaned).trim();
  const base = firstSentence.length >= 4 ? firstSentence : cleaned;
  return base.length > 20 ? `${base.slice(0, 20)}…` : base || fallback;
}

function threadPreview(thread: ChatThread): string {
  const last = thread.messages[thread.messages.length - 1];
  if (!last) return '还没有开口。';
  return String(last.content || '').replace(/\s+/g, ' ').slice(0, 90) || (last.images?.length ? '[图片]' : '');
}

export function threadSummary(thread: ChatThread): ChatThreadSummary {
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

function normalizeThread(id: string, raw: any): ChatThread | null {
  if (!raw || typeof raw !== 'object') return null;
  const messages: ChatMessage[] = Array.isArray(raw.messages) ? raw.messages : [];
  const createdAt = Number(raw.createdAt) || Number(messages[0]?.ts) || Date.now();
  const updatedAt = Number(raw.updatedAt) || Number(messages[messages.length - 1]?.ts) || createdAt;
  return {
    id: String(raw.id || id),
    title: String(raw.title || '').slice(0, 60) || makeThreadTitle(messages[0]?.content),
    messages,
    createdAt,
    updatedAt,
    origin: ['manual', 'daily', 'item'].includes(raw.origin) ? raw.origin : 'manual',
    itemId: raw.itemId ? String(raw.itemId) : null,
  };
}

function normalizeFreeChat(raw: any): FreeChat {
  const chat: FreeChat = { ...JSON.parse(JSON.stringify(DEFAULT_FREECHAT)), ...(raw && typeof raw === 'object' ? raw : {}) };
  const threads: Record<string, ChatThread> = {};
  const source = chat.threads && typeof chat.threads === 'object' ? chat.threads : {};
  for (const [id, value] of Object.entries(source as Record<string, any>)) {
    const thread = normalizeThread(id, value);
    if (thread) threads[thread.id] = thread;
  }
  if (!Object.keys(threads).length && Array.isArray((chat as any).messages) && (chat as any).messages.length) {
    const messages = (chat as any).messages as ChatMessage[];
    const id = `thr_${Math.random().toString(36).slice(2, 12)}`;
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
  delete (chat as any).messages;
  if (!threads[chat.activeId]) {
    const newest = Object.values(threads).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    chat.activeId = newest ? newest.id : '';
  }
  chat.threads = threads;
  return chat;
}

export class MobileStore {
  config: MobileConfig = { ...DEFAULT_CONFIG };
  items: Item[] = [];
  characters: Character[] = [];
  daily: Record<string, any> = {};
  sessions: Record<string, Session> = {};
  freechat: FreeChat = JSON.parse(JSON.stringify(DEFAULT_FREECHAT));
  ready: Promise<void>;
  private db: IDBDatabase | null = null;

  constructor() {
    this.ready = this.load();
  }

  private async load() {
    this.db = await openDb();
    const config = await idbGet<MobileConfig>(this.db, 'config');
    const items = await idbGet<Item[]>(this.db, 'items');
    const characters = await idbGet<Character[]>(this.db, 'characters');
    const daily = await idbGet<Record<string, any>>(this.db, 'daily');
    const sessions = await idbGet<Record<string, Session>>(this.db, 'sessions');
    const freechat = await idbGet<any>(this.db, 'freechat');
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) };
    const model = migrateVisionModel(this.config);
    let configChanged = model !== this.config.model;
    if (Object.hasOwn(this.config, 'maxPhotosPerRequest')) {
      Reflect.deleteProperty(this.config, 'maxPhotosPerRequest');
      configChanged = true;
    }
    this.config.model = model;
    if (!this.config.prompts || typeof this.config.prompts !== 'object' || Array.isArray(this.config.prompts)) {
      this.config.prompts = {};
    }
    if (Object.hasOwn(this.config.prompts, 'ritual.photoNoteNoVision')) {
      delete this.config.prompts['ritual.photoNoteNoVision'];
      configChanged = true;
    }
    this.config.devPromptMode = Boolean(this.config.devPromptMode);
    // 旧版本把人格底色存在 systemPrompt 里：和默认值不同就搬进覆盖层。
    const legacyPersona = String(this.config.systemPrompt || '').trim();
    if (!legacyPersona || legacyPersona.includes('你既是照片里那款周边的化身')) {
      delete this.config.prompts.persona;
      this.config.systemPrompt = DEFAULT_SYSTEM_PROMPT;
    } else if (!this.config.prompts.persona && legacyPersona !== String(DEFAULT_SYSTEM_PROMPT).trim()) {
      this.config.prompts.persona = legacyPersona.slice(0, 30000);
    }
    if (typeof this.config.userName !== 'string' || !this.config.userName.trim()) this.config.userName = '杂鱼';
    if (typeof this.config.managerAvatar !== 'string') this.config.managerAvatar = '';
    this.items = Array.isArray(items) ? items : [];
    this.characters = Array.isArray(characters) ? characters : [];
    this.daily = daily && typeof daily === 'object' ? daily : {};
    this.sessions = sessions && typeof sessions === 'object' ? sessions : {};
    this.freechat = normalizeFreeChat(freechat);

    let migrated = false;
    for (const item of this.items) {
      for (const photo of item.photos || []) {
        if ((photo as any).shot === 'mango') {
          (photo as any).shot = 'private';
          migrated = true;
        }
      }
      if (typeof (item as any).intro === 'string' && !item.thought) {
        item.thought = (item as any).intro;
        migrated = true;
      }
      if ((item as any).intro !== undefined) {
        delete (item as any).intro;
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
    if (this.syncCharactersFromItems()) migrated = true;
    if (migrated) await this.saveItems();

    if (!config || configChanged) await this.saveConfig();
    await this.saveFreeChat();
    if (!characters) await this.saveCharacters();
  }

  private async put(key: string, value: unknown) {
    if (!this.db) this.db = await openDb();
    await idbPut(this.db, key, value);
  }

  private syncCharactersFromItems(): boolean {
    let changed = false;
    for (const item of this.items) {
      if (item.characterId && this.characters.some((c) => c.id === item.characterId)) continue;
      const name = String(item.series || '').trim();
      if (!name) continue;
      const existing = this.characters.find((c) => c.name === name);
      if (existing) {
        item.characterId = existing.id;
        changed = true;
        continue;
      }
      const now = Date.now();
      const character: Character = {
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
  getApiKey(): string {
    return this.config.apiKey || '';
  }

  getPublicConfig(): Config {
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
      apiKeyStoredEncrypted: false,
    };
  }

  // ---------- prompts ----------
  promptValues(): Record<string, string> {
    return resolvePrompts(this.config.prompts);
  }

  promptBundle() {
    return {
      defaults: { ...PROMPT_DEFAULTS },
      overrides: { ...this.config.prompts },
      resolved: this.promptValues(),
      devPromptMode: Boolean(this.config.devPromptMode),
      // 手机版把默认值打进了安装包，改不了。
      defaultsEditable: false,
      defaultsPath: '打包在应用内的 prompts.default.json',
    };
  }

  getPrompts() {
    return this.promptBundle();
  }

  async savePrompts({ prompts = {}, reset = [] }: { prompts?: Record<string, string>; reset?: string[] } = {}) {
    if (this.config.devPromptMode) {
      throw new Error('手机版不能修改系统默认提示词。请用桌面端的开发人员选项，或先关闭开发人员选项。');
    }
    const values = prompts && typeof prompts === 'object' ? prompts : {};
    const resetKeys = (Array.isArray(reset) ? reset : []).filter((key) => key in PROMPT_DEFAULTS);
    for (const [key, value] of Object.entries(values)) {
      if (!(key in PROMPT_DEFAULTS)) continue;
      const text = String(value === undefined || value === null ? '' : value).slice(0, 30000);
      if (!text.trim() || text.trim() === String(PROMPT_DEFAULTS[key] || '').trim()) {
        delete this.config.prompts[key];
      } else {
        this.config.prompts[key] = text;
      }
    }
    for (const key of resetKeys) delete this.config.prompts[key];
    this.config.systemPrompt = this.promptValues().persona || '';
    await this.saveConfig();
    return this.getPublicConfig();
  }

  async setDevPromptMode(value: boolean) {
    this.config.devPromptMode = Boolean(value);
    await this.saveConfig();
    return this.getPublicConfig();
  }

  async saveConfig() {
    await this.put('config', this.config);
  }

  async updateConfig(patch: Partial<MobileConfig> & { apiKey?: string; clearApiKey?: boolean }) {
    if (dailyChatScheduleChanged(this.config, patch)) this.config.dailyChatScheduleChangedAt = Date.now();
    const allowed: (keyof MobileConfig)[] = [
      'baseUrl', 'model', 'verifiedVision', 'temperature', 'imageDetail',
      'autoUpdate', 'dailyChatEnabled', 'dailyChatTime',
      'userName', 'managerAvatar',
    ];
    for (const key of allowed) {
      if (patch[key] !== undefined) (this.config as any)[key] = patch[key];
    }
    if (patch.systemPrompt !== undefined) {
      const text = String(patch.systemPrompt).slice(0, 30000);
      if (!text.trim() || text.trim() === String(PROMPT_DEFAULTS.persona || '').trim()) {
        delete this.config.prompts.persona;
      } else {
        this.config.prompts.persona = text;
      }
      this.config.systemPrompt = this.promptValues().persona || '';
    }
    if (patch.clearApiKey) this.config.apiKey = '';
    else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) this.config.apiKey = patch.apiKey.trim();
    await this.saveConfig();
    return this.getPublicConfig();
  }

  async resetSystemPrompt() {
    delete this.config.prompts.persona;
    this.config.systemPrompt = this.promptValues().persona || '';
    await this.saveConfig();
    return this.getPublicConfig();
  }

  // ---------- characters ----------
  listCharacters(): Character[] {
    return JSON.parse(JSON.stringify(this.characters));
  }

  getCharacter(id: string): Character | null {
    const character = this.characters.find((c) => c.id === id);
    return character ? JSON.parse(JSON.stringify(character)) : null;
  }

  async saveCharacters() {
    await this.put('characters', this.characters);
  }

  async upsertCharacter(input: Partial<Character>): Promise<Character> {
    const name = String(input.name || '').trim().slice(0, 80);
    if (!name) throw new Error('角色名不能为空。');
    const now = Date.now();
    const existing = input.id ? this.characters.find((c) => c.id === input.id) : undefined;
    if (existing) {
      existing.name = name;
      existing.source = String(input.source || '').trim().slice(0, 120);
      existing.description = String(input.description || '').trim().slice(0, 4000);
      existing.updatedAt = now;
      await this.saveCharacters();
      return JSON.parse(JSON.stringify(existing));
    }
    const character: Character = {
      id: this.newId('chr'),
      name,
      source: String(input.source || '').trim().slice(0, 120),
      description: String(input.description || '').trim().slice(0, 4000),
      createdAt: now,
      updatedAt: now,
    };
    this.characters.unshift(character);
    await this.saveCharacters();
    return JSON.parse(JSON.stringify(character));
  }

  async deleteCharacter(id: string) {
    this.characters = this.characters.filter((c) => c.id !== id);
    await this.saveCharacters();
    let changed = false;
    for (const item of this.items) {
      if (item.characterId === id) {
        delete item.characterId;
        item.updatedAt = Date.now();
        changed = true;
      }
    }
    if (changed) await this.saveItems();
  }

  // ---------- items ----------
  listItems(): Item[] {
    return JSON.parse(JSON.stringify(this.items));
  }

  getItem(id: string): Item | null {
    const item = this.items.find((i) => i.id === id);
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  async upsertItem(item: Item) {
    const idx = this.items.findIndex((i) => i.id === item.id);
    if (idx >= 0) this.items[idx] = item;
    else this.items.unshift(item);
    await this.saveItems();
    return JSON.parse(JSON.stringify(item));
  }

  async deleteItem(id: string) {
    this.items = this.items.filter((i) => i.id !== id);
    await this.saveItems();
  }

  async saveItems() {
    await this.put('items', this.items);
  }

  // ---------- daily ----------
  getDaily(day: string): any {
    return this.daily[day] ? JSON.parse(JSON.stringify(this.daily[day])) : null;
  }

  listDaily(): any[] {
    return Object.values(this.daily).map((d) => JSON.parse(JSON.stringify(d)));
  }

  async putDaily(record: any) {
    this.daily[record.date] = record;
    await this.put('daily', this.daily);
  }

  async deleteDaily(day: string) {
    delete this.daily[day];
    await this.put('daily', this.daily);
  }

  // ---------- sessions ----------
  getSession(id: string): Session | null {
    return this.sessions[id] ? JSON.parse(JSON.stringify(this.sessions[id])) : null;
  }

  listSessions(): Session[] {
    return Object.values(this.sessions)
      .map((s) => JSON.parse(JSON.stringify(s)))
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }

  async putSession(session: Session) {
    this.sessions[session.id] = session;
    await this.put('sessions', this.sessions);
  }

  async deleteSession(id: string) {
    delete this.sessions[id];
    await this.put('sessions', this.sessions);
  }

  // ---------- free chat (multi-thread) ----------
  getFreeChat(): FreeChatState {
    const active = this.getActiveThread();
    return {
      messages: active ? JSON.parse(JSON.stringify(active.messages)) : [],
      threads: this.listThreadSummaries(),
      activeId: active ? active.id : '',
      lastMessage: this.lastMessage(),
      busy: false,
      lastProactiveDay: this.freechat.lastProactiveDay || null,
      lastProactiveAt: this.freechat.lastProactiveAt || null,
      lastAttemptAt: this.freechat.lastAttemptAt || null,
      dailyChatEnabled: this.config.dailyChatEnabled !== false,
      dailyChatTime: this.config.dailyChatTime || '22:00',
      updatedAt: this.freechat.updatedAt || 0,
    };
  }

  async putFreeChat(patch: Partial<FreeChat>) {
    for (const key of ['lastProactiveDay', 'lastProactiveAt', 'lastAttemptAt'] as const) {
      if (patch[key] !== undefined) (this.freechat as any)[key] = patch[key];
    }
    this.freechat.updatedAt = Date.now();
    await this.saveFreeChat();
    return this.getFreeChat();
  }

  async saveFreeChat() {
    await this.put('freechat', this.freechat);
  }

  sortedThreads(): ChatThread[] {
    return Object.values(this.freechat.threads).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  listThreadSummaries(): ChatThreadSummary[] {
    return this.sortedThreads().map((t) => threadSummary(t));
  }

  getThread(id: string): ChatThread | null {
    const thread = id ? this.freechat.threads[id] : null;
    return thread ? JSON.parse(JSON.stringify(thread)) : null;
  }

  getActiveThread(): ChatThread | null {
    const active = this.getThread(this.freechat.activeId);
    if (active) return active;
    const newest = this.sortedThreads()[0];
    if (newest) {
      this.freechat.activeId = newest.id;
      return JSON.parse(JSON.stringify(newest));
    }
    return null;
  }

  async setActiveThread(id: string) {
    if (id && this.freechat.threads[id]) {
      this.freechat.activeId = id;
      this.freechat.updatedAt = Date.now();
      await this.saveFreeChat();
    }
    return this.getFreeChat();
  }

  newThread({ title, origin = 'manual', itemId = null }: NewThreadOptions = {}): ChatThread {
    const now = Date.now();
    return {
      id: this.newId('thr'),
      title: title || DEFAULT_THREAD_TITLE,
      messages: [],
      createdAt: now,
      updatedAt: now,
      origin,
      itemId: itemId || null,
    };
  }

  async createThread(options?: NewThreadOptions): Promise<ChatThread> {
    const thread = this.newThread(options);
    this.freechat.threads[thread.id] = thread;
    this.freechat.activeId = thread.id;
    await this.saveFreeChat();
    return JSON.parse(JSON.stringify(thread));
  }

  async ensureActiveThread(): Promise<ChatThread> {
    const active = this.getActiveThread();
    if (active) return active;
    return this.createThread({});
  }

  async putThread(thread: ChatThread, { proactiveDay }: { proactiveDay?: string } = {}) {
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    thread.updatedAt = Date.now();
    thread.createdAt = Number(thread.createdAt) || Date.now();
    if (!thread.title || thread.title === DEFAULT_THREAD_TITLE) {
      const first = messages.find((m) => m.role === 'user') || messages[0];
      if (first) thread.title = makeThreadTitle(first.content);
    }
    this.freechat.threads[thread.id] = normalizeThread(thread.id, thread)!;
    if (proactiveDay) {
      this.freechat.lastProactiveDay = proactiveDay;
      this.freechat.lastProactiveAt = messages[0].ts;
      this.freechat.lastAttemptAt = messages[0].ts;
    }
    if (!proactiveDay || !this.freechat.activeId) this.freechat.activeId = thread.id;
    this.freechat.updatedAt = Date.now();
    await this.saveFreeChat();
    return this.getThread(thread.id);
  }

  async appendThreadMessage(threadId: string, message: ChatMessage) {
    const thread = this.getThread(threadId);
    if (!thread) return null;
    thread.messages.push(message);
    thread.updatedAt = Date.now();
    if (!thread.title || thread.title === DEFAULT_THREAD_TITLE) {
      const first = thread.messages.find((m) => m.role === 'user') || thread.messages[0];
      if (first) thread.title = makeThreadTitle(first.content);
    }
    const previous = this.freechat.threads[thread.id];
    const previousUpdatedAt = this.freechat.updatedAt;
    const next = normalizeThread(thread.id, thread)!;
    this.freechat.threads[thread.id] = next;
    this.freechat.updatedAt = thread.updatedAt;
    try {
      await this.saveFreeChat();
    } catch (err) {
      if (this.freechat.threads[thread.id] === next) this.freechat.threads[thread.id] = previous;
      if (this.freechat.updatedAt === next.updatedAt) this.freechat.updatedAt = previousUpdatedAt;
      throw err;
    }
    return this.getThread(thread.id);
  }

  async renameThread(id: string, title: string) {
    const thread = this.freechat.threads[id];
    if (!thread) throw new Error('这个对话不在了。');
    const next = String(title || '').trim().slice(0, 60);
    thread.title = next || DEFAULT_THREAD_TITLE;
    thread.updatedAt = Date.now();
    await this.saveFreeChat();
    return this.listThreadSummaries();
  }

  async deleteThread(id: string) {
    if (!this.freechat.threads[id]) return this.getFreeChat();
    delete this.freechat.threads[id];
    if (this.freechat.activeId === id) {
      const newest = this.sortedThreads()[0];
      this.freechat.activeId = newest ? newest.id : '';
    }
    await this.saveFreeChat();
    return this.getFreeChat();
  }

  lastMessage(): ChatMessage | null {
    let best: ChatMessage | null = null;
    for (const thread of this.sortedThreads()) {
      const last = thread.messages[thread.messages.length - 1];
      if (!last) continue;
      if (!best || (last.ts || 0) > (best.ts || 0)) best = last;
    }
    return best ? JSON.parse(JSON.stringify(best)) : null;
  }

  // ---------- sync helpers ----------
  async exportData() {
    return {
      items: this.listItems(),
      characters: this.listCharacters(),
      daily: JSON.parse(JSON.stringify(this.daily)),
      sessions: JSON.parse(JSON.stringify(this.sessions)),
      freechat: JSON.parse(JSON.stringify(this.freechat)),
    };
  }

  async importData(data: {
    items?: Item[];
    characters?: Character[];
    daily?: any;
    sessions?: any;
    freechat?: any;
  }) {
    if (Array.isArray(data.items)) this.items = data.items;
    if (Array.isArray(data.characters)) this.characters = data.characters;
    if (data.daily && typeof data.daily === 'object') this.daily = data.daily;
    if (data.sessions && typeof data.sessions === 'object') this.sessions = data.sessions;
    if (data.freechat) this.freechat = normalizeFreeChat(data.freechat);
    await Promise.all([
      this.put('items', this.items),
      this.put('characters', this.characters),
      this.put('daily', this.daily),
      this.put('sessions', this.sessions),
      this.put('freechat', this.freechat),
    ]);
  }

  async clear() {
    if (!this.db) this.db = await openDb();
    await idbClear(this.db);
    this.config = { ...DEFAULT_CONFIG };
    this.items = [];
    this.characters = [];
    this.daily = {};
    this.sessions = {};
    this.freechat = JSON.parse(JSON.stringify(DEFAULT_FREECHAT));
  }

  newId(prefix: string): string {
    const rand = (crypto as any).randomUUID?.().replace(/-/g, '').slice(0, 12)
      || Math.random().toString(36).slice(2, 14);
    return `${prefix}_${rand}`;
  }
}

export type { FreeChatState };
