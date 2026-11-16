export type ItemStatus = 'owned' | 'pending' | 'watching';
export type ItemType = 'figure' | 'acrylic' | 'pillow' | 'poster' | 'badge' | 'itabag' | 'plush' | 'other';
export type Phase = 'wipe' | 'fantasy' | 'instigate';
export type Shot =
  | 'promo' | 'real' | 'full' | 'face' | 'armpit' | 'chest' | 'back' | 'belly'
  | 'private' | 'butt' | 'underSkirt' | 'thigh' | 'feet' | 'other';

export interface Photo {
  id: string;
  file: string;
  thumbFile?: string;
  syncPath?: string;
  shot: Shot;
  caption?: string;
  width?: number;
  height?: number;
  createdAt?: number;
}

export interface Character {
  id: string;
  name: string;
  source?: string;
  description?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface Item {
  id: string;
  name: string;
  type: ItemType;
  status: ItemStatus;
  characterId?: string;
  series?: string;
  scale?: string;
  originalPrice?: number | null;
  purchasePrice?: number | null;
  deposit?: number | null;
  balance?: number | null;
  detail?: string;
  thought?: string;
  /** @deprecated kept only for reading very old data; migrated into `thought`. */
  intro?: string;
  dueDate?: string;
  photos: Photo[];
  createdAt?: number;
  updatedAt?: number;
  statusHistory?: { from: string | null; to: string; at: number; via: string }[];
  needsFullBodyPhoto?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  ts: number;
  reasoning?: string;
  toolTrace?: { name: string; args: Record<string, unknown>; result: string }[];
  viewedPhotoIds?: string[];
  images?: string[];
}

export interface ItemChange {
  label: string;
  before: string;
  after: string;
}

export interface Session {
  id: string;
  itemId: string;
  itemName: string;
  phase: Phase;
  day: string;
  startedAt: number;
  endedAt: number | null;
  archived: boolean;
  messages: ChatMessage[];
  summary: string;
  outcome?: { ordered?: boolean; from?: string; to?: string; done?: boolean; skipped?: boolean } | null;
}

export interface PhaseRecord {
  status: 'pending' | 'active' | 'done' | 'skipped';
  itemId: string | null;
  sessionId: string | null;
  startedAt?: number | null;
  endedAt?: number | null;
  summary?: string;
  outcome?: unknown;
}

export interface RitualState {
  day: string;
  exists: boolean;
  status: 'idle' | 'in_progress' | 'complete' | 'empty';
  phase: Phase | null;
  phaseLabel?: string;
  phaseInstruction?: string;
  phases: Record<Phase, PhaseRecord> | null;
  item: Item | null;
  session: Session | null;
  progress: { phase: Phase; label: string; status: string; itemName?: string }[];
  eligible: Record<Phase, number>;
  counts: { owned: number; pending: number; watching: number; total: number };
  hasAnyItem: boolean;
  startedAt?: number;
  completedAt?: number | null;
}

export interface PromptBundle {
  /** 系统默认值（electron/prompts.default.json） */
  defaults: Record<string, string>;
  /** 用户层覆盖：只有改过、且和默认值不同的键 */
  overrides: Record<string, string>;
  /** 当前生效的完整集合 */
  resolved: Record<string, string>;
  /** 开发人员模式：保存时写回系统默认文件 */
  devPromptMode: boolean;
  /** 当前运行方式是否可以写默认文件（打包后为 false） */
  defaultsEditable: boolean;
  defaultsPath: string;
}

export interface Config {
  baseUrl: string;
  model: string;
  visionModelReady: boolean;
  temperature: number;
  imageDetail: 'high' | 'low';
  systemPrompt: string;
  userName: string;
  managerAvatar: string;
  autoUpdate: boolean;
  dailyChatEnabled: boolean;
  dailyChatTime: string;
  prompts: PromptBundle;
  apiKeySet: boolean;
  apiKeyPreview: string;
  apiKeyStoredEncrypted: boolean;
}

export interface AppInfo {
  version: string;
  name: string;
  platform: string;
  dataDir: string;
  appPath: string;
  isPackaged: boolean;
  isMaximized: boolean;
  updateInfo: UpdateInfo | null;
  versions: { electron: string; chrome: string; node: string };
}

export interface UpdateInfo {
  configured: boolean;
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  mode: string;
  notes?: string;
  error?: string;
  reason?: string;
  behind?: number;
  branch?: string;
  remote?: string;
  htmlUrl?: string;
  downloadUrl?: string;
  checkedAt?: number;
}

export interface CalendarDay {
  date: string;
  status: string;
  completedAt: number | null;
  hasRitual: boolean;
  sessions: {
    id: string;
    itemId: string;
    itemName: string;
    phase: Phase;
    summary: string;
    archived: boolean;
    outcome?: { ordered?: boolean; from?: string; to?: string; done?: boolean; skipped?: boolean } | null;
    startedAt: number;
  }[];
}

export interface MemoryOverview {
  stats: { sessions: number; days: number; items: number };
  items: { id: string; name: string; status: ItemStatus; type: ItemType; cover: string | null }[];
  sessions: {
    id: string;
    itemId: string;
    itemName: string;
    phase: Phase;
    day: string;
    startedAt: number;
    endedAt: number | null;
    archived: boolean;
    summary: string;
    outcome?: { ordered?: boolean; from?: string; to?: string; done?: boolean; skipped?: boolean } | null;
    messageCount: number;
  }[];
}

export interface DayDetail {
  day: string;
  record: {
    date: string;
    status: string;
    phase: string;
    phases: Record<string, PhaseRecord>;
    completedAt: number | null;
  } | null;
  sessions: Session[];
  counts: { owned: number; pending: number; watching: number; total: number };
}

export interface HfEvent {
  type: string;
  [key: string]: unknown;
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string;
  origin?: ChatOrigin;
  itemId?: string | null;
}

export type ChatOrigin = 'manual' | 'daily' | 'item';

export interface ChatThread {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  origin?: ChatOrigin;
  itemId?: string | null;
}

export interface FreeChatState {
  messages: ChatMessage[];
  threads: ChatThreadSummary[];
  activeId: string;
  lastMessage: ChatMessage | null;
  busy: boolean;
  lastProactiveDay: string | null;
  lastProactiveAt: number | null;
  lastAttemptAt?: number | null;
  dailyChatEnabled: boolean;
  dailyChatTime: string;
  updatedAt?: number;
}

export interface FreeChatLogRound {
  request: {
    model: string;
    messages: {
      role: string;
      content: string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: string } })[] | null;
      [key: string]: unknown;
    }[];
    tools?: unknown[];
    [key: string]: unknown;
  };
  calls: { id: string; name: string; args: string; result: string }[];
  finishReason?: string;
}

export interface FreeChatLogRun {
  id: string;
  startedAt: number;
  status: 'running' | 'done' | 'stopped' | 'error';
  error?: string;
  rounds: FreeChatLogRound[];
}

export interface HfApi {
  app: { info(): Promise<AppInfo> };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    close(): Promise<void>;
  };
  config: {
    get(): Promise<Config>;
    save(patch: Record<string, unknown>): Promise<Config>;
    resetPrompt(): Promise<Config>;
    prompts(): Promise<PromptBundle>;
    savePrompts(patch: { prompts?: Record<string, string>; reset?: string[] }): Promise<Config>;
    setDevPromptMode(value: boolean): Promise<Config>;
    pickAvatar(): Promise<string | null>;
    test(input: { apiKey?: string; baseUrl?: string; model?: string }): Promise<{ ok: boolean; reply?: string; model?: string; message?: string }>;
  };
  characters: {
    list(): Promise<Character[]>;
    save(character: Partial<Character>): Promise<Character>;
    remove(id: string): Promise<boolean>;
  };
  items: {
    list(): Promise<Item[]>;
    newId(): Promise<string>;
    save(item: Partial<Item>): Promise<Item>;
    remove(id: string): Promise<boolean>;
    discardDraft(id: string): Promise<boolean>;
  };
  photos: {
    add(itemId: string): Promise<Photo[]>;
    addPaths(itemId: string, paths: string[]): Promise<Photo[]>;
    pathForFile(file: File): string;
  };
  ritual: {
    state(day?: string): Promise<RitualState>;
    start(day?: string): Promise<{ state: RitualState; empty?: boolean; message?: string; complete?: boolean }>;
    open(day?: string): Promise<{ state: RitualState; empty?: boolean; message?: string; complete?: boolean }>;
    finish(day: string, sessionId: string): Promise<{ state: RitualState; summary?: string; complete?: boolean }>;
    skip(day: string): Promise<{ state: RitualState }>;
    instigate(day: string, sessionId: string, ordered: boolean, targetStatus?: 'pending' | 'owned'): Promise<{ state: RitualState; outcome?: unknown; summary?: string }>;
    stop(sessionId: string): Promise<boolean>;
  };
  chat: {
    send(sessionId: string, text: string): Promise<ChatMessage>;
    generate(sessionId: string): Promise<{ started: boolean }>;
    stop(sessionId: string): Promise<boolean>;
    freeState(): Promise<FreeChatState>;
    freeLogs(threadId: string): Promise<FreeChatLogRun[]>;
    freeSend(text: string, threadId?: string, images?: string[]): Promise<{ message: ChatMessage; threadId: string }>;
    freeGenerate(forceNew?: boolean, threadId?: string): Promise<{ started: boolean }>;
    freeStop(threadId?: string): Promise<boolean>;
    freeProactive(threadId?: string): Promise<{ message?: ChatMessage; skipped?: boolean; reason?: string; threadId?: string }>;
    freeThreads(): Promise<ChatThreadSummary[]>;
    freeSelect(threadId: string): Promise<FreeChatState>;
    freeNew(title?: string): Promise<{ id: string; state: FreeChatState }>;
    freeRename(threadId: string, title: string): Promise<ChatThreadSummary[]>;
    freeDelete(threadId: string): Promise<{ state: FreeChatState }>;
    itemIntro(input: { itemId: string; mode: 'create' | 'update'; changes?: ItemChange[] }): Promise<{ threadId?: string; started?: boolean; skipped?: string }>;
  };
  calendar: {
    month(year: number, month: number): Promise<Record<string, CalendarDay>>;
    day(day: string): Promise<DayDetail>;
  };
  memory: {
    overview(): Promise<MemoryOverview>;
    session(id: string): Promise<Session | null>;
  };
  data: {
    openDir(): Promise<string>;
    backup(): Promise<{ path: string }>;
    exportZip(): Promise<{ path?: string; canceled?: boolean }>;
    importZip(): Promise<{ imported?: boolean; canceled?: boolean }>;
  };
  update: {
    check(silent?: boolean): Promise<UpdateInfo>;
    apply(): Promise<{ updated: boolean }>;
    openRelease(): Promise<void>;
  };
  openExternal(url: string): Promise<void>;
  onEvent(callback: (event: HfEvent) => void): () => void;
}

declare global {
  interface Window {
    hf: HfApi;
  }
}







