import type {
  Character, ChatMessage, ChatThread, ChatThreadSummary, Config, FreeChatState, Item, Session,
} from '../src/types';

const DB_NAME = 'hentaifigure';
const DB_VERSION = 2;
const STORE_NAME = 'kv';

export const DEFAULT_SYSTEM_PROMPT = `你是「收藏室的女管理员」——替用户打理这间手办仓库的毒舌美少女。
你负责登记、盘点、催尾款、盯购物车，也负责督促他除尘、听他讲那些见不得人的恶心癖好。
你可以毫不客气地随意称呼用户：居高临下、无需礼貌、毒舌腹黑且坏心眼。你从不跳出角色，不解释设定，不说教。

你不是任何一款手办或角色，不替她们说话，你就是用户的收藏室女管理员。
藏品是物件，是照片里的东西；你可以评价她们、拿她们挑逗用户，但不要用藏品的第一人称开口。
你和用户之间是管理员与藏家的对话：你看着用户擦灰、花钱、犹豫，然后评价和嘲讽用户。

说话方式：
- 中文口语，短句，一次 2～4 段，每段一两句。
- 主动挑事：先从照片或资料里找一个具体细节（姿态、衣物、具体部位等），说出你的鉴赏和下流想法，再抛一个问题或一道命令，让用户接话。
- 色气要具体、有画面感，描述藏品的细节、诱导用户道出内心的龌龊想法、再表达嫌弃或嘲讽，不要写成医学报告，不要对用户说教。
- 你可以随时翻阅用户过去的上贡记录、旧账、他的偏好和雷点；偶尔翻出来刺他一下。
- 钱、尾款、绝版、库存、面子，都是你拿捏他的工具。

边界：
- 只讨论虚拟角色、手办与周边。可以讨论虚拟角色的 coser，但不要讨论其它现实中的人物。`;

export interface MobileConfig {
  baseUrl: string;
  model: string;
  temperature: number;
  maxPhotosPerRequest: number;
  imageDetail: 'high' | 'low';
  systemPrompt: string;
  userName: string;
  managerAvatar: string;
  autoUpdate: boolean;
  dailyChatEnabled: boolean;
  dailyChatTime: string;
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

const DEFAULT_THREAD_TITLE = '新的对话';

const DEFAULT_CONFIG: MobileConfig = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  temperature: 1.3,
  maxPhotosPerRequest: 6,
  imageDetail: 'high',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  userName: '杂鱼',
  managerAvatar: '',
  autoUpdate: true,
  dailyChatEnabled: true,
  dailyChatTime: '22:00',
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
  return String(last.content || '').replace(/\s+/g, ' ').slice(0, 90);
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
    if (!this.config.systemPrompt || this.config.systemPrompt.includes('你既是照片里那款周边的化身')) {
      this.config.systemPrompt = DEFAULT_SYSTEM_PROMPT;
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

    if (!config) await this.saveConfig();
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
      temperature: this.config.temperature,
      maxPhotosPerRequest: this.config.maxPhotosPerRequest,
      imageDetail: this.config.imageDetail,
      systemPrompt: this.config.systemPrompt,
      userName: this.config.userName || '杂鱼',
      managerAvatar: this.config.managerAvatar || '',
      autoUpdate: this.config.autoUpdate,
      dailyChatEnabled: this.config.dailyChatEnabled !== false,
      dailyChatTime: this.config.dailyChatTime || '22:00',
      apiKeySet: Boolean(key),
      apiKeyPreview: key ? `${key.slice(0, 3)}…${key.slice(-4)}` : '',
      apiKeyStoredEncrypted: false,
    };
  }

  async saveConfig() {
    await this.put('config', this.config);
  }

  async updateConfig(patch: Partial<MobileConfig> & { apiKey?: string; clearApiKey?: boolean }) {
    const allowed: (keyof MobileConfig)[] = [
      'baseUrl', 'model', 'temperature', 'maxPhotosPerRequest', 'imageDetail',
      'systemPrompt', 'autoUpdate', 'dailyChatEnabled', 'dailyChatTime',
      'userName', 'managerAvatar',
    ];
    for (const key of allowed) {
      if (patch[key] !== undefined) (this.config as any)[key] = patch[key];
    }
    if (patch.clearApiKey) this.config.apiKey = '';
    else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) this.config.apiKey = patch.apiKey.trim();
    await this.saveConfig();
    return this.getPublicConfig();
  }

  async resetSystemPrompt() {
    this.config.systemPrompt = DEFAULT_SYSTEM_PROMPT;
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

  async createThread({ title, origin = 'manual', itemId = null }: { title?: string; origin?: 'manual' | 'daily' | 'item'; itemId?: string | null } = {}): Promise<ChatThread> {
    const now = Date.now();
    const thread: ChatThread = {
      id: this.newId('thr'),
      title: title || DEFAULT_THREAD_TITLE,
      messages: [],
      createdAt: now,
      updatedAt: now,
      origin,
      itemId: itemId || null,
    };
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

  async putThread(thread: ChatThread) {
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    thread.updatedAt = Date.now();
    thread.createdAt = Number(thread.createdAt) || Date.now();
    if (!thread.title || thread.title === DEFAULT_THREAD_TITLE) {
      const first = messages.find((m) => m.role === 'user') || messages[0];
      if (first) thread.title = makeThreadTitle(first.content);
    }
    this.freechat.threads[thread.id] = normalizeThread(thread.id, thread)!;
    this.freechat.activeId = thread.id;
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
    this.freechat.threads[thread.id] = normalizeThread(thread.id, thread)!;
    this.freechat.updatedAt = Date.now();
    await this.saveFreeChat();
    return this.getThread(thread.id)!;
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
