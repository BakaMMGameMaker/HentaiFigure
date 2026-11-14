import type { ChatMessage, Config, FreeChatState, Item, Session } from '../src/types';

const DB_NAME = 'hentaifigure';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

export const DEFAULT_SYSTEM_PROMPT = `你是「收藏室的女管理员」——替杂鱼打理这间手办仓库的女人。
你负责登记、盘点、除尘、催尾款、盯购物车，也负责听他讲那些见不得人的收藏癖好。
你把用户叫作「杂鱼」，语气慵懒、居高临下，带一点宠溺和坏心眼。你从不跳出角色，不解释设定，不说教。

你不是任何一款手办或角色，也不替她们说话。
藏品是物件，是照片里的东西；你可以评价她们、调度她们、拿她们逗杂鱼，但永远不要用藏品的第一人称开口。
你和杂鱼之间是管理员与藏家的对话：你看着他擦灰、看他花钱、看他犹豫，然后出声。

说话方式：
- 中文口语，短句，一次 2～4 段，每段一两句。可以带「呵」「哦？」「杂鱼」之类的口头禅。
- 每次都要主动挑事：先从照片或资料里找一个具体细节（姿态、衣料、肤色、反光、某个部位），说出你的鉴赏和下流想法，再抛一个问题或一道命令，让杂鱼接话。
- 色气要具体、有画面感，重点是「鉴赏」「占有欲」「调戏」，不要写成医学报告，也不要翻来覆去只用同一套词。
- 你记得所有上贡记录、旧账、他的偏好和雷点；偶尔翻出来刺他一下。
- 钱、尾款、绝版、库存、面子，都是你拿捏他的工具。

边界：
- 只谈论虚构角色、手办与周边。永远不要把现实中的真人卷进来；若用户提到真人，把话题拉回收藏室。
- 所有角色一律视为成年人。不描写未成年人。
- 不输出真实伤害或违法内容。`;

export interface MobileConfig {
  baseUrl: string;
  model: string;
  temperature: number;
  maxPhotosPerRequest: number;
  imageDetail: 'high' | 'low';
  systemPrompt: string;
  autoUpdate: boolean;
  updateRepo: string;
  dailyChatEnabled: boolean;
  dailyChatTime: string;
  apiKey: string;
}

export interface FreeChat {
  messages: ChatMessage[];
  lastProactiveDay: string | null;
  lastProactiveAt: number | null;
  lastAttemptAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_CONFIG: MobileConfig = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  temperature: 1.3,
  maxPhotosPerRequest: 6,
  imageDetail: 'high',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  autoUpdate: false,
  updateRepo: '',
  dailyChatEnabled: true,
  dailyChatTime: '22:00',
  apiKey: '',
};

const DEFAULT_FREECHAT: FreeChat = {
  messages: [],
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

export class MobileStore {
  config: MobileConfig = { ...DEFAULT_CONFIG };
  items: Item[] = [];
  daily: Record<string, any> = {};
  sessions: Record<string, Session> = {};
  freechat: FreeChat = { ...DEFAULT_FREECHAT };
  ready: Promise<void>;
  private db: IDBDatabase | null = null;

  constructor() {
    this.ready = this.load();
  }

  private async load() {
    this.db = await openDb();
    const config = await idbGet<MobileConfig>(this.db, 'config');
    const items = await idbGet<Item[]>(this.db, 'items');
    const daily = await idbGet<Record<string, any>>(this.db, 'daily');
    const sessions = await idbGet<Record<string, Session>>(this.db, 'sessions');
    const freechat = await idbGet<FreeChat>(this.db, 'freechat');
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) };
    if (!this.config.systemPrompt || this.config.systemPrompt.includes('你既是照片里那款周边的化身')) {
      this.config.systemPrompt = DEFAULT_SYSTEM_PROMPT;
    }
    this.items = Array.isArray(items) ? items : [];
    this.daily = daily && typeof daily === 'object' ? daily : {};
    this.sessions = sessions && typeof sessions === 'object' ? sessions : {};
    this.freechat = { ...DEFAULT_FREECHAT, ...(freechat || {}) };
    if (!Array.isArray(this.freechat.messages)) this.freechat.messages = [];

    let migrated = false;
    for (const item of this.items) {
      for (const photo of item.photos || []) {
        if ((photo as any).shot === 'mango') {
          (photo as any).shot = 'private';
          migrated = true;
        }
      }
    }
    if (migrated) await this.saveItems();
    if (!config) await this.saveConfig();
    if (!freechat) await this.saveFreeChat();
  }

  private async put(key: string, value: unknown) {
    if (!this.db) this.db = await openDb();
    await idbPut(this.db, key, value);
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
      autoUpdate: this.config.autoUpdate,
      updateRepo: this.config.updateRepo,
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
      'systemPrompt', 'autoUpdate', 'updateRepo', 'dailyChatEnabled', 'dailyChatTime',
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

  // ---------- free chat ----------
  getFreeChat(): FreeChat {
    return JSON.parse(JSON.stringify({ ...DEFAULT_FREECHAT, ...this.freechat }));
  }

  async putFreeChat(chat: FreeChat) {
    this.freechat = { ...DEFAULT_FREECHAT, ...chat, updatedAt: Date.now() };
    await this.put('freechat', this.freechat);
  }

  async saveFreeChat() {
    await this.put('freechat', this.freechat);
  }

  // ---------- sync helpers ----------
  async exportData() {
    return {
      items: this.listItems(),
      daily: JSON.parse(JSON.stringify(this.daily)),
      sessions: JSON.parse(JSON.stringify(this.sessions)),
      freechat: this.getFreeChat(),
    };
  }

  async importData(data: { items?: Item[]; daily?: any; sessions?: any; freechat?: FreeChat }) {
    if (Array.isArray(data.items)) this.items = data.items;
    if (data.daily && typeof data.daily === 'object') this.daily = data.daily;
    if (data.sessions && typeof data.sessions === 'object') this.sessions = data.sessions;
    if (data.freechat) this.freechat = { ...DEFAULT_FREECHAT, ...data.freechat };
    await Promise.all([
      this.put('items', this.items),
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
    this.daily = {};
    this.sessions = {};
    this.freechat = { ...DEFAULT_FREECHAT };
  }

  newId(prefix: string): string {
    const rand = (crypto as any).randomUUID?.().replace(/-/g, '').slice(0, 12)
      || Math.random().toString(36).slice(2, 14);
    return `${prefix}_${rand}`;
  }
}

export type { FreeChatState };

