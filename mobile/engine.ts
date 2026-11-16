import type {
  Character, ChatMessage, ChatThread, FreeChatLogRound, FreeChatState, Item, Phase, RitualState, Session,
} from '../src/types';
import {
  PHASE_META, PHASES, SHOT_OPTIONS, TYPE_OPTIONS, formatDateCN,
} from '../src/constants';

// localDateKey is not exported from constants; keep a local helper.
function dayKey(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

import { MobileStore } from './store';
import {
  ApiError, completeText, emitText, friendlyError,
  requestChat,
} from './ai';

import { PROMPT_DEFAULTS, renderPrompt } from '../src/prompts';
import { chatMessageContent, validateChatImages } from '../electron/lib/chat-attachments.mjs';
import { FreeChatLog } from '../electron/lib/free-chat-log.mjs';
import { VIEW_ITEM_PHOTOS, createPhotoAccess } from '../electron/lib/chat-photos.mjs';
import {
  FREE_CHAT_COLLECTION_TOOLS, LIST_COLLECTION, MEMORY_LOOKUP_TOOLS, READ_CHARACTER,
  collectionPage, listRecentItems, readCharacter, readMemory, searchMemory,
} from '../electron/lib/chat-memory.mjs';
import { assertVisionReady, isVisionReady } from '../electron/lib/vision-config.mjs';
import { dailyChatScheduleChanged, isDailyChatDue } from '../electron/lib/daily-chat-schedule.mjs';

const PHASE_PROMPT_KEY: Record<Phase, string> = {
  wipe: 'ritual.phaseWipe',
  fantasy: 'ritual.phaseFantasy',
  instigate: 'ritual.phaseInstigate',
};

const SHOT_LABELS: Record<string, string> = Object.fromEntries(SHOT_OPTIONS.map((s) => [s.value, s.label]));
const TYPE_LABELS: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map((t) => [t.value, t.label]));

const MEMORY_TOOLS = [
  ...MEMORY_LOOKUP_TOOLS,
  {
    type: 'function',
    function: {
      name: 'list_events',
      description: '按日期范围、阶段或周边列出过去发生的事件（上贡记录）。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '起始日期 YYYY-MM-DD，可省略' },
          to: { type: 'string', description: '结束日期 YYYY-MM-DD，可省略' },
          phase: { type: 'string', enum: ['wipe', 'fantasy', 'instigate'] },
          item_id: { type: 'string' },
          limit: { type: 'integer', description: '最多返回条数，默认 20' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_item',
      description: '查看某款周边的完整资料：类型、状态、价格、简介、补款日、照片清单、历史记录摘要。',
      parameters: { type: 'object', properties: { item_id: { type: 'string' } }, required: ['item_id'] },
    },
  },
  LIST_COLLECTION,
  {
    type: 'function',
    function: {
      name: 'list_characters',
      description: '列出收藏室里所有角色档案：角色名、出自哪部作品、背景设定、关联了几款周边。想在聊天里对某个 IP / 角色有更完整的背景时先查这个。',
      parameters: { type: 'object', properties: {} },
    },
  },
  READ_CHARACTER,
];
const FREE_CHAT_TOOLS = [...MEMORY_TOOLS, ...FREE_CHAT_COLLECTION_TOOLS];

function truncate(text: unknown, max: number): string {
  const str = String(text || '');
  if (str.length <= max) return str;
  return `${str.slice(0, Math.max(0, max - 1))}…`;
}

function money(value: unknown): string {
  if (value === null || value === undefined || value === '') return '未记录';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `¥${n.toLocaleString('zh-CN')}`;
}

function shuffle<T>(list: T[]): T[] {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function newPhaseRecord() {
  return {
    status: 'pending' as const,
    itemId: null as string | null,
    sessionId: null as string | null,
    startedAt: null as number | null,
    endedAt: null as number | null,
    outcome: null as any,
  };
}

function msg(role: 'user' | 'assistant', content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 12)}`,
    role,
    content,
    ts: Date.now(),
    ...extra,
  };
}

export class MobileEngine {
  store: MobileStore;
  emit: (event: any) => void;
  busy = new Set<string>();
  controllers = new Map<string, AbortController>();
  freeChatBusy = false;
  freeChatThreadId: string | null = null;
  freeChatController: AbortController | null = null;
  freeChatLog: FreeChatLog;
  proactiveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(store: MobileStore, emit: (event: any) => void) {
    this.store = store;
    this.emit = emit;
    this.freeChatLog = new FreeChatLog(store, (threadId) => this.emit({ type: 'free:log', threadId, channel: 'freechat' }));
  }

  today() { return dayKey(); }

  counts() {
    const items = this.store.listItems();
    return {
      owned: items.filter((i) => i.status === 'owned').length,
      pending: items.filter((i) => i.status === 'pending').length,
      watching: items.filter((i) => i.status === 'watching').length,
      total: items.length,
    };
  }

  eligibleFor(phase: Phase, record: any) {
    const status = PHASE_META[phase] ? (phase === 'wipe' ? 'owned' : phase === 'fantasy' ? 'pending' : 'watching') : 'owned';
    const used = record?.phases?.[phase]?.itemId;
    return this.store.listItems().filter((item) => item.status === status && item.id !== used);
  }

  eligibleCounts(record: any) {
    return {
      wipe: this.eligibleFor('wipe', record).length,
      fantasy: this.eligibleFor('fantasy', record).length,
      instigate: this.eligibleFor('instigate', record).length,
    };
  }

  hydrate(record: any, day = this.today()): RitualState {
    const items = this.store.listItems();
    const counts = this.counts();
    if (!record) {
      return {
        day,
        exists: false,
        status: 'idle',
        phase: null,
        phases: null,
        item: null,
        session: null,
        progress: PHASES.map((p) => ({ phase: p, label: PHASE_META[p].label, status: 'pending' })),
        eligible: {
          wipe: items.filter((i) => i.status === 'owned').length,
          fantasy: items.filter((i) => i.status === 'pending').length,
          instigate: items.filter((i) => i.status === 'watching').length,
        },
        counts,
        hasAnyItem: items.length > 0,
      };
    }
    const phase: Phase | null = record.phase === 'done' ? null : record.phase;
    const phaseRec = phase ? record.phases[phase] : null;
    const item = phaseRec?.itemId ? this.store.getItem(phaseRec.itemId) : null;
    const session = phaseRec?.sessionId ? this.store.getSession(phaseRec.sessionId) : null;
    return {
      day: record.date,
      exists: true,
      status: record.status,
      phase,
      phaseLabel: phase ? PHASE_META[phase].label : '',
      phaseInstruction: phase ? this.prompt(PHASE_PROMPT_KEY[phase], {}) : '',
      phases: record.phases,
      item,
      session,
      progress: PHASES.map((p) => ({
        phase: p,
        label: PHASE_META[p].label,
        status: record.phases[p]?.status || 'pending',
        itemName: record.phases[p]?.itemId
          ? (items.find((i) => i.id === record.phases[p].itemId)?.name
            || this.store.getSession(record.phases[p]?.sessionId)?.itemName || '')
          : '',
      })),
      eligible: this.eligibleCounts(record),
      counts,
      hasAnyItem: items.length > 0,
      startedAt: record.startedAt,
      completedAt: record.completedAt || null,
    };
  }

  async ensureRecord(day: string) {
    let record = this.store.getDaily(day);
    if (record && record.status === 'empty') record = null;
    if (record) return record;
    const now = Date.now();
    record = {
      date: day,
      status: 'in_progress',
      phase: 'wipe',
      phases: { wipe: newPhaseRecord(), fantasy: newPhaseRecord(), instigate: newPhaseRecord() },
      startedAt: now,
      completedAt: null,
    };
    await this.store.putDaily(record);
    return record;
  }

  advancePointer(record: any) {
    const idx = PHASES.indexOf(record.phase);
    if (idx < 0 || idx === PHASES.length - 1) record.phase = 'done';
    else record.phase = PHASES[idx + 1];
  }

  normalize(record: any) {
    let guard = 0;
    while (guard < 8) {
      guard += 1;
      if (record.status === 'complete') return;
      if (record.phase === 'done') break;
      const ph: Phase = record.phase;
      const prec = record.phases[ph];
      if (prec.status === 'done' || prec.status === 'skipped') {
        this.advancePointer(record);
        continue;
      }
      if (prec.status === 'active') return;
      if (this.eligibleFor(ph, record).length === 0) {
        prec.status = 'skipped';
        prec.skippedAt = Date.now();
        this.advancePointer(record);
        continue;
      }
      return;
    }
    if (record.phase === 'done') {
      const anyDone = PHASES.some((p) => record.phases[p].status === 'done');
      if (anyDone) {
        record.status = 'complete';
        record.completedAt = Date.now();
      } else {
        record.status = 'empty';
      }
    }
  }

  async start(day = this.today()) {
    if (!this.counts().total) {
      return { state: this.hydrate(null, day), empty: true, message: '收藏室还是空的。先点左上角的「添加」，把她放进来吧。' };
    }
    let record = await this.ensureRecord(day);
    if (record.status === 'complete') return { state: this.hydrate(record, day), complete: true };
    this.normalize(record);
    if (record.status === 'empty') {
      await this.store.deleteDaily(day);
      return { state: this.hydrate(null, day), empty: true, message: '今天没有可以上贡的周边。' };
    }
    await this.store.putDaily(record);
    return { state: this.hydrate(record, day) };
  }

  getState(day = this.today()) {
    const record = this.store.getDaily(day);
    return this.hydrate(record, day);
  }

  async open(day = this.today()) {
    let record = this.store.getDaily(day);
    if (!record) return this.start(day);
    if (record.status === 'complete') return { state: this.hydrate(record, day), complete: true };
    this.normalize(record);
    if (record.status === 'complete') {
      await this.store.putDaily(record);
      return { state: this.hydrate(record, day), complete: true };
    }
    if (record.status === 'empty') {
      await this.store.deleteDaily(day);
      return { state: this.hydrate(null, day), empty: true, message: '今天没有可以上贡的周边。' };
    }
    const phase: Phase = record.phase;
    if (!PHASES.includes(phase)) {
      await this.store.putDaily(record);
      return { state: this.hydrate(record, day) };
    }
    const prec = record.phases[phase];
    if (prec.status === 'active' && prec.sessionId) {
      await this.store.putDaily(record);
      return { state: this.hydrate(record, day) };
    }
    const pool = this.eligibleFor(phase, record);
    if (!pool.length) {
      this.normalize(record);
      await this.store.putDaily(record);
      return { state: this.hydrate(record, day) };
    }
    const lastField = ({ wipe: 'lastWipedAt', fantasy: 'lastFantasyAt', instigate: 'lastInstigatedAt' } as const)[phase];
    const sorted = pool.slice().sort((a, b) => ((a as any)[lastField] || 0) - ((b as any)[lastField] || 0));
    const poolSize = Math.max(1, Math.min(sorted.length, Math.ceil(sorted.length * 0.5)));
    const item = shuffle(sorted.slice(0, poolSize))[0] || sorted[0];
    const sessionId = this.store.newId('ses');
    const now = Date.now();
    const session: Session = {
      id: sessionId,
      itemId: item.id,
      itemName: item.name,
      phase,
      day,
      startedAt: now,
      endedAt: null,
      archived: false,
      messages: [],
      summary: '',
      outcome: null,
    };
    await this.store.putSession(session);
    prec.status = 'active';
    prec.itemId = item.id;
    prec.sessionId = sessionId;
    prec.startedAt = now;
    await this.store.putDaily(record);
    return { state: this.hydrate(record, day) };
  }

  findPhase(record: any, sessionId: string): { phase: Phase | null; prec: any } {
    if (!record) return { phase: null, prec: null };
    for (const p of PHASES) {
      if (record.phases[p]?.sessionId === sessionId) return { phase: p, prec: record.phases[p] };
    }
    return { phase: null, prec: null };
  }

  stop(sessionId: string) {
    try { this.controllers.get(sessionId)?.abort(); } catch {}
  }

  async skipPhase(day = this.today()) {
    const record = this.store.getDaily(day);
    if (!record || record.status === 'complete') return { state: this.hydrate(record, day) };
    const prec = record.phases[record.phase];
    if (prec?.status === 'active' && prec.sessionId) {
      this.stop(prec.sessionId);
      const session = this.store.getSession(prec.sessionId);
      if (session) {
        session.endedAt = Date.now();
        session.archived = true;
        session.summary = session.summary || '（本阶段被跳过）';
        session.outcome = { ...(session.outcome || {}), skipped: true };
        await this.store.putSession(session);
      }
    }
    if (prec) {
      prec.status = 'skipped';
      prec.endedAt = Date.now();
    }
    this.advancePointer(record);
    this.normalize(record);
    await this.store.putDaily(record);
    return { state: this.hydrate(record, day) };
  }

  // ---------- prompts ----------
  photoAccess(item: Item | null, history: ChatMessage[]) {
    return createPhotoAccess({
      photos: item?.photos || [],
      history,
      labels: SHOT_LABELS,
      config: this.store.config,
      loadImage: (photo) => /^data:image\//.test(photo.file) ? photo.file : null,
    });
  }

  itemContext(item: Item | null): string {
    if (!item) return '（这款周边的资料已经被删除了。）';
    const lines = [];
    lines.push(`名称：${item.name}`);
    lines.push(`类型：${TYPE_LABELS[item.type] || item.type || '周边'}`);
    lines.push(`状态：${item.status === 'owned' ? '已拥有' : item.status === 'pending' ? '待补款' : '观望中（购物车）'}`);
    const character = this.characterFor(item);
    if (character) {
      lines.push(`角色：${character.name}${character.source ? `（出自 ${character.source}）` : ''}`);
    } else if (item.series) {
      lines.push(`作品 / 角色：${item.series}`);
    }
    if (item.scale) lines.push(`规格：${item.scale}`);
    if (item.originalPrice != null) lines.push(`原始价格：${money(item.originalPrice)}`);
    if (item.purchasePrice != null) lines.push(`购入价格：${money(item.purchasePrice)}`);
    if (item.deposit != null) lines.push(`定金：${money(item.deposit)}`);
    if (item.balance != null) lines.push(`尾款：${money(item.balance)}`);
    if (item.dueDate) lines.push(`补款日期：${formatDateCN(item.dueDate)}`);
    const name = this.userName();
    if (item.detail) lines.push(`商品详情 / 情报（这款周边本身是什么、为什么会有）：\n${item.detail}`);
    if (item.thought) lines.push(`${name} 当时写下的「最初的想法」（他买下或加购时的心路历程，可作为鉴赏和调戏的素材）：\n${item.thought}`);
    return lines.join('\n');
  }

  memoryDigest(currentItemId: string | null, currentSessionId: string | null): string {
    const sessions = this.store.listSessions()
      .filter((s) => s.archived && s.id !== currentSessionId)
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    const itemSessions = sessions.filter((s) => s.itemId === currentItemId).slice(0, 6);
    const globalSessions = sessions.slice(0, 12);
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const s of [...itemSessions, ...globalSessions]) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      lines.push(`· ${s.day} ${PHASE_META[s.phase]?.label || s.phase}「${s.itemName}」：${truncate(s.summary || '（没有摘要）', 220)}`);
    }
    if (!lines.length) return '（这是你们的第一次上贡，还没有可翻的旧账。）';
    return truncate(lines.join('\n'), 5200);
  }

  buildSystemPrompt({ item, phase, day, sessionId }: { item: Item | null; phase: Phase; day: string; sessionId: string }) {
    const name = this.userName();
    const parts: string[] = [];
    this.pushPart(parts, this.prompt('persona', { name }));
    this.pushPart(parts, this.prompt('ritual.scene', { date: formatDateCN(day), name }));
    this.pushPart(parts, this.prompt('ritual.tools', { name }));
    this.pushPart(parts, this.prompt(PHASE_PROMPT_KEY[phase], { name }));
    this.pushPart(parts, this.prompt('ritual.itemBlock', { context: this.itemContext(item), name }));
    const character = this.characterFor(item);
    if (character) {
      this.pushPart(parts, this.prompt('ritual.characterBlock', { context: this.characterContext(character), name }));
    }
    this.pushPart(parts, this.prompt('ritual.memoryBlock', { digest: this.memoryDigest(item?.id || null, sessionId), name }));
    this.pushPart(parts, this.prompt('ritual.output', { name }));
    return parts.join('\n\n');
  }

  buildMessages({ session, item, phase, day, photoAccess }: {
    session: Session; item: Item | null; phase: Phase; day: string; photoAccess: ReturnType<typeof createPhotoAccess>;
  }) {
    const system = this.buildSystemPrompt({ item, phase, day, sessionId: session.id });
    const photoNote = photoAccess
      ? this.prompt('ritual.photoNote', { count: photoAccess.count, names: photoAccess.names })
      : this.prompt('ritual.photoNoteNoFiles', {});
    const messages: any[] = [{ role: 'system', content: `${system}\n\n${photoAccess?.instructions || photoNote}` }];
    const history = session.messages || [];
    for (const m of history) messages.push({ role: m.role, content: m.content });
    const last = history[history.length - 1];
    if (!history.length) {
      messages.push({
        role: 'user',
        content: this.prompt('ritual.opening', {
          item: item?.name || session.itemName,
          photoNote,
          name: this.userName(),
        }),
      });
    } else if (last?.role === 'user') {
      messages[messages.length - 1] = {
        role: 'user',
        content: this.prompt('ritual.photoAttached', { text: last.content, photoNote }),
      };
    }
    return messages;
  }

  // ---------- tool loop ----------
  executeTool(name: string, args: any, currentItem?: Item | null, currentThreadId?: string): any {
    if (name === 'get_collection_counts') return this.counts();
    const sessions = this.store.listSessions();
    const items = this.store.listItems();
    if (name === 'list_recent_items') {
      return listRecentItems({ items, sessions, threads: this.store.sortedThreads(), args, dateKey: dayKey });
    }
    if (name === 'search_memory' || name === 'read_memory') {
      const context = {
        getItemName: (itemId?: string | null) => itemId ? this.store.getItem(itemId)?.name : undefined,
        phaseLabel: (phase: Phase) => PHASE_META[phase]?.label || phase,
        dateKey: dayKey,
      };
      if (name === 'search_memory') {
        return searchMemory({ ...context, sessions, threads: this.store.sortedThreads(), args });
      }
      const session = sessions.find((entry) => entry.id === args?.session_id);
      return readMemory({
        ...context,
        session,
        thread: session ? null : this.store.getThread(args?.session_id),
        userName: this.userName(),
        args,
      });
    }

    if (name === 'list_events') {
      const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
      let list = sessions.filter((s) => s.archived);
      if (args.phase) list = list.filter((s) => s.phase === args.phase);
      if (args.item_id) list = list.filter((s) => s.itemId === args.item_id);
      if (args.from) list = list.filter((s) => s.day >= args.from);
      if (args.to) list = list.filter((s) => s.day <= args.to);
      list.sort((a, b) => String(b.day).localeCompare(String(a.day)) || b.startedAt - a.startedAt);
      return { events: list.slice(0, limit).map((s) => ({ sessionId: s.id, date: s.day, phase: PHASE_META[s.phase]?.label || s.phase, itemName: s.itemName, summary: truncate(s.summary, 200), outcome: s.outcome })), total: list.length };
    }
    if (name === 'read_item') {
      const item = items.find((i) => i.id === args.item_id);
      if (!item) return { error: '没有这款周边' };
      const history = sessions.filter((s) => s.itemId === item.id && s.archived).slice(0, 10).map((s) => ({ sessionId: s.id, date: s.day, phase: PHASE_META[s.phase]?.label || s.phase, summary: truncate(s.summary, 260) }));
      const character = this.characterFor(item);
      return {
        item: {
          id: item.id,
          name: item.name,
          type: TYPE_LABELS[item.type] || item.type,
          status: item.status,
          characterId: item.characterId || null,
          character: character ? { id: character.id, name: character.name, source: character.source, description: truncate(character.description, 600) } : null,
          series: item.series,
          scale: item.scale,
          originalPrice: item.originalPrice,
          purchasePrice: item.purchasePrice,
          deposit: item.deposit,
          balance: item.balance,
          dueDate: item.dueDate,
          detail: item.detail,
          thought: item.thought,
          photos: (item.photos || []).map((photo) => ({
            label: SHOT_LABELS[photo.shot] || '照片',
            caption: photo.caption,
          })),
        },
        history,
      };
    }
    if (name === 'list_collection') {
      const { page, total, nextOffset } = collectionPage(items, args?.query, args?.offset, (item) => {
        const character = this.characterFor(item);
        return [item.name, item.series, item.type, TYPE_LABELS[item.type], character?.name, character?.source];
      });
      return {
        total,
        nextOffset,
        counts: this.counts(),
        items: page.map((i) => ({
          id: i.id,
          name: i.name,
          type: TYPE_LABELS[i.type] || i.type,
          status: i.status,
          characterId: i.characterId || null,
          characterName: this.characterFor(i)?.name || null,
          price: i.purchasePrice ?? i.originalPrice ?? null,
          deposit: i.deposit ?? null,
          balance: i.balance ?? null,
          dueDate: i.dueDate || null,
        })),
      };
    }
    if (name === 'list_characters') {
      const characters = this.store.listCharacters();
      return {
        total: characters.length,
        characters: characters.map((c) => ({
          characterId: c.id,
          name: c.name,
          source: c.source,
          description: truncate(c.description, 400),
          itemCount: items.filter((i) => i.characterId === c.id).length,
          items: items.filter((i) => i.characterId === c.id).map((i) => i.name).slice(0, 8),
        })),
      };
    }
    if (name === 'read_character') {
      return readCharacter({
        characters: this.store.listCharacters(),
        items,
        sessions,
        threads: this.store.sortedThreads(),
        currentItem,
        currentThreadId,
        args,
        dateKey: dayKey,
        phaseLabel: (phase) => PHASE_META[phase]?.label || phase,
        typeLabel: (type) => TYPE_LABELS[type] || type,
      });
    }
    return { error: `未知工具 ${name}` };
  }

  async appendMessage(session: Session, message: ChatMessage) {
    session.messages = Array.isArray(session.messages) ? session.messages : [];
    session.messages.push(message);
    await this.store.putSession(session);
    return message;
  }

  async generate(sessionId: string) {
    if (this.busy.has(sessionId)) return;
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error('这次对话不存在。');
    if (session.archived) throw new Error('这次对话已经归档了。');
    const last = session.messages[session.messages.length - 1];
    if (last?.role === 'assistant') return;
    const apiKey = this.store.getApiKey();
    const config = { ...this.store.config };
    if (!apiKey) {
      const err = new ApiError('missing key', { code: 'NO_KEY' });
      this.emit({ type: 'chat:error', sessionId, message: friendlyError(err) });
      throw err;
    }
    const item = this.store.getItem(session.itemId);
    const photoAccess = this.photoAccess(item, session.messages);
    const working = this.buildMessages({ session, item, phase: session.phase, day: session.day || this.today(), photoAccess });
    this.busy.add(sessionId);
    const controller = new AbortController();
    this.controllers.set(sessionId, controller);
    this.emit({ type: 'chat:start', sessionId, phase: session.phase });
    const trace: any[] = [];
    const tools = photoAccess ? [...MEMORY_TOOLS, VIEW_ITEM_PHOTOS] : MEMORY_TOOLS;
    let finalText = '';

    try {
      for (let round = 0; round < 4; round += 1) {
        const result = await requestChat({
          config,
          apiKey,
          messages: working,
          tools: round < 3 ? tools : undefined,
          signal: controller.signal,
        });
        if (result.toolCalls.length) {
          const assistantMessage = {
            role: 'assistant',
            content: result.content || null,
            ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
            tool_calls: result.toolCalls.map((tc, i) => ({ id: tc.id || `call_${round}_${i}`, type: 'function', function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '{}' } })),
          };
          working.push(assistantMessage);
          for (const tc of assistantMessage.tool_calls) {
            let args: any = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
            this.emit({ type: 'chat:tool', sessionId, name: tc.function.name, args, status: 'running' });
            let toolResult: any;
            let photoResult;
            try {
              if (tc.function.name === VIEW_ITEM_PHOTOS.function.name) photoResult = photoAccess?.view(args);
              toolResult = photoResult?.result ?? this.executeTool(tc.function.name, args, item);
            } catch (err: any) {
              toolResult = { error: err?.message || '工具执行失败' };
            }
            const text = JSON.stringify(toolResult);
            trace.push({ name: tc.function.name, args, result: truncate(text, 500) });
            this.emit({ type: 'chat:tool', sessionId, name: tc.function.name, args, status: 'done', preview: truncate(text, 160) });
            working.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: photoResult?.content ?? (['read_item', 'read_character'].includes(tc.function.name) ? text : truncate(text, 12000)),
            });
          }
          const images = photoAccess?.takeImageMessage();
          if (images) working.push(images);
          continue;
        }
        finalText = result.content || '';
        break;
      }
      if (!finalText.trim()) throw new Error('没有收到回复内容，请重试。');
      await emitText(finalText.trim(), (text) => this.emit({ type: 'chat:delta', sessionId, text }));
      const message = msg('assistant', finalText.trim(), {
        toolTrace: trace.length ? trace : undefined,
        viewedPhotoIds: photoAccess?.viewedIds.size ? [...photoAccess.viewedIds] : undefined,
      });
      await this.appendMessage(session, message);
      this.emit({ type: 'chat:done', sessionId, message });
      return message;
    } catch (err) {
      if (controller.signal.aborted) this.emit({ type: 'chat:stopped', sessionId });
      else this.emit({ type: 'chat:error', sessionId, message: friendlyError(err) });
      throw err;
    } finally {
      this.busy.delete(sessionId);
      this.controllers.delete(sessionId);
    }
  }

  async sendUserMessage(sessionId: string, text: string) {
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error('这次对话不存在。');
    if (session.archived) throw new Error('这次对话已经归档了。');
    if (this.busy.has(sessionId)) throw new Error('管理员还在说话，等一句说完。');
    const content = String(text || '').trim();
    if (!content) throw new Error('说点什么再发。');
    if (content.length > 4000) throw new Error('一次最多 4000 字。');
    const message = msg('user', content);
    await this.appendMessage(session, message);
    return message;
  }

  // ---------- finish ----------
  fallbackSummary(session: Session): string {
    const first = session.messages.find((m) => m.role === 'assistant')?.content || '';
    const lastUser = [...session.messages].reverse().find((m) => m.role === 'user')?.content || '';
    const bits = [first, lastUser].filter(Boolean).map((t) => truncate(t.replace(/\s+/g, ' '), 90));
    return bits.length ? truncate(bits.join(' / '), 220) : '（这次没有留下太多话。）';
  }

  async summarizeSession(session: Session): Promise<string> {
    const apiKey = this.store.getApiKey();
    if (!apiKey) return this.fallbackSummary(session);
    const transcript = session.messages.map((m) => `${m.role === 'user' ? this.userName() : '管理员'}：${m.content}`).join('\n');
    if (!transcript.trim()) return this.fallbackSummary(session);
    try {
      const text = await completeText({
        config: this.store.config,
        apiKey,
        messages: [
          { role: 'system', content: this.prompt('summary.system', {}) },
          { role: 'user', content: `日期：${session.day}\n周边：${session.itemName}\n阶段：${PHASE_META[session.phase]?.label || session.phase}\n\n${truncate(transcript, 9000)}` },
        ],
        maxTokens: 320,
        temperature: 0.5,
      });
      if (text.trim()) return truncate(text.trim(), 500);
    } catch {}
    return this.fallbackSummary(session);
  }

  async finishPhase(day = this.today(), sessionId: string) {
    const record = this.store.getDaily(day);
    if (!record) throw new Error('今天还没有开始上贡。');
    if (record.status === 'complete') return { state: this.hydrate(record, day), complete: true };
    const { phase, prec } = this.findPhase(record, sessionId);
    if (!phase) throw new Error('找不到这次对话对应的阶段。');
    if (prec.status !== 'active') throw new Error('这个阶段已经结束了。');
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error('这次对话不存在。');
    this.stop(sessionId);
    const summary = await this.summarizeSession(session);
    session.summary = summary;
    session.archived = true;
    session.endedAt = Date.now();
    if (!session.outcome) session.outcome = { done: true } as any;
    await this.store.putSession(session);
    prec.status = 'done';
    prec.endedAt = Date.now();
    prec.summary = summary;
    const item = this.store.getItem(session.itemId);
    if (item) {
      (item as any)[phase === 'wipe' ? 'lastWipedAt' : phase === 'fantasy' ? 'lastFantasyAt' : 'lastInstigatedAt'] = Date.now();
      item.updatedAt = Date.now();
      await this.store.upsertItem(item);
    }
    this.advancePointer(record);
    this.normalize(record);
    await this.store.putDaily(record);
    return { state: this.hydrate(record, day), summary };
  }

  async applyInstigate(day: string, sessionId: string, { ordered, targetStatus }: { ordered: boolean; targetStatus?: 'pending' | 'owned' }) {
    const record = this.store.getDaily(day);
    if (!record) throw new Error('今天还没有开始上贡。');
    const { phase, prec } = this.findPhase(record, sessionId);
    if (phase !== 'instigate') throw new Error('只有教唆阶段可以下单。');
    if (prec.status !== 'active') throw new Error('这个阶段已经结束了。');
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error('这次对话不存在。');
    const item = this.store.getItem(session.itemId);
    if (ordered) {
      if (!item) throw new Error('这款周边已经被删除了。');
      if (!targetStatus) throw new Error('目标状态不对。');
      item.status = targetStatus;
      item.updatedAt = Date.now();
      (item as any).statusHistory = (item as any).statusHistory || [];
      (item as any).statusHistory.push({ from: 'watching', to: targetStatus, at: Date.now(), via: 'ritual' });
      if (targetStatus === 'owned' && item.type === 'figure' && !(item.photos || []).some((p) => p.shot === 'full')) {
        (item as any).needsFullBodyPhoto = true;
      }
      await this.store.upsertItem(item);
      session.outcome = { ordered: true, from: 'watching', to: targetStatus };
    } else {
      session.outcome = { ordered: false, from: 'watching' };
    }
    await this.store.putSession(session);
    const result = await this.finishPhase(day, sessionId);
    return { ...result, outcome: session.outcome };
  }

  // ---------- calendar / memory ----------
  calendar(year: number, month: number) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const days: Record<string, any> = {};
    for (const rec of this.store.listDaily()) {
      if (!String(rec.date).startsWith(prefix)) continue;
      const sessions = Object.values(rec.phases || {}).map((p: any) => (p.sessionId ? this.store.getSession(p.sessionId) : null)).filter(Boolean) as Session[];
      days[rec.date] = {
        date: rec.date,
        status: rec.status,
        completedAt: rec.completedAt,
        sessions: sessions.map((s) => ({ id: s.id, itemId: s.itemId, itemName: s.itemName, phase: s.phase, summary: s.summary, archived: s.archived, outcome: s.outcome, startedAt: s.startedAt })),
        hasRitual: Boolean(rec.completedAt),
      };
    }
    return days;
  }

  dayDetail(date: string) {
    const rec = this.store.getDaily(date);
    const sessions = this.store.listSessions().filter((s) => s.day === date);
    return { day: date, record: rec, sessions, counts: this.counts() };
  }

  memoryOverview() {
    const sessions = this.store.listSessions();
    const items = this.store.listItems();
    return {
      sessions: sessions.map((s) => ({ ...s, messageCount: (s.messages || []).length })),
      items: items.map((i) => ({ id: i.id, name: i.name, status: i.status, type: i.type, cover: (i.photos || [])[0]?.file || null })),
      stats: { sessions: sessions.filter((s) => s.archived).length, days: Object.values(this.store.daily).filter((d: any) => d.completedAt).length, items: items.length },
    };
  }

  // ---------- free chat (multi-thread) ----------
  userName(): string {
    const name = String(this.store.config.userName || '').trim();
    return name || '杂鱼';
  }

  /** 取一条生效中的提示词模板（系统默认 + 用户覆盖层）并渲染变量。 */
  prompt(key: string, vars?: Record<string, string | number | undefined | null>): string {
    const values = this.store.promptValues();
    return renderPrompt(values[key] ?? PROMPT_DEFAULTS[key] ?? '', vars);
  }

  /** 只保留非空片段，避免进阶设置里删空某一块后留下空行。 */
  pushPart(parts: string[], text: string): string[] {
    const value = String(text || '');
    if (value.trim()) parts.push(value);
    return parts;
  }

  freeChatState(): FreeChatState {
    const state = this.store.getFreeChat();
    state.busy = this.freeChatBusy && this.freeChatThreadId === state.activeId;
    return state;
  }

  freeThreads() {
    return this.store.listThreadSummaries();
  }

  async freeSelectThread(threadId: string) {
    await this.store.setActiveThread(threadId);
    return this.freeChatState();
  }

  async freeNewThread(title?: string) {
    const thread = await this.store.createThread({ title: title || undefined, origin: 'manual' });
    return { id: thread.id, state: this.freeChatState() };
  }

  async freeRenameThread(threadId: string, title: string) {
    return this.store.renameThread(threadId, title);
  }

  async freeDeleteThread(threadId: string) {
    if (this.freeChatBusy && this.freeChatThreadId === threadId) this.stopFreeChat(threadId);
    await this.store.deleteThread(threadId);
    return { state: this.freeChatState() };
  }

  characterFor(item: Item | null): Character | null {
    if (!item || !item.characterId) return null;
    return this.store.getCharacter(item.characterId);
  }

  characterContext(character: Character | null, items?: Item[]): string {
    if (!character) return '';
    const lines = [`角色：${character.name}`];
    if (character.source) lines.push(`出自作品：${character.source}`);
    if (character.description) lines.push(`角色背景：${character.description}`);
    const related = (items || this.store.listItems()).filter((i) => i.characterId === character.id);
    if (related.length > 1) {
      lines.push(`这个角色在收藏室里还有 ${related.length - 1} 款周边：${related.slice(0, 8).map((i) => i.name).join('、')}。`);
    }
    return lines.join('\n');
  }

  buildFreeChatSystemPrompt(thread?: ChatThread | null) {
    const name = this.userName();
    const parts: string[] = [];
    this.pushPart(parts, this.prompt('persona', { name }));
    this.pushPart(parts, this.prompt('freechat.scene', { date: formatDateCN(this.today()), name }));
    if (thread?.itemId) {
      const item = this.store.getItem(thread.itemId);
      if (item) {
        this.pushPart(parts, this.prompt('freechat.itemBlock', { context: this.itemContext(item), name }));
      }
    }
    this.pushPart(parts, this.prompt('freechat.tools', { name }));
    this.pushPart(parts, this.prompt('freechat.output', { name }));
    return parts.join('\n\n');
  }

  buildFreeChatMessages(thread: ChatThread, openingInstruction: string | undefined, photoAccess: ReturnType<typeof createPhotoAccess>) {
    const name = this.userName();
    const history = (thread.messages || []).slice(-40);
    const system = this.buildFreeChatSystemPrompt(thread);
    const messages: any[] = [{ role: 'system', content: photoAccess ? `${system}\n\n${photoAccess.instructions}` : system }];
    const detail = this.store.config.imageDetail === 'low' ? 'low' : 'high';
    for (const m of history) messages.push({ role: m.role, content: chatMessageContent(m, detail) });
    if (openingInstruction) {
      const note = photoAccess ? this.prompt('freechat.photoNote', { names: photoAccess.names }) : '';
      messages.push({ role: 'user', content: note ? `${openingInstruction}\n\n${note}` : openingInstruction });
    } else if (!history.length) {
      const item = thread?.itemId ? this.store.getItem(thread.itemId) : null;
      if (item) {
        messages.push({
          role: 'user',
          content: this.prompt('freechat.openingItem', {
            name,
            item: item.name,
            context: this.itemContext(item),
          }),
        });
      } else {
        messages.push({ role: 'user', content: this.prompt('freechat.openingDaily', { name }) });
      }
    }
    return messages;
  }

  async sendFreeChatUserMessage(text: string, threadId?: string, images: string[] = []) {
    if (this.freeChatBusy) throw new Error('管理员还在说话，等一句说完。');
    const content = String(text || '').trim();
    const attachments = validateChatImages(images);
    if (!content && !attachments.length) throw new Error('写点什么或添加图片再发。');
    if (content.length > 4000) throw new Error('一次最多 4000 字。');
    const thread = threadId ? this.store.getThread(threadId) : await this.store.ensureActiveThread();
    if (!thread) throw new Error('这个对话不在了。');
    const message = msg('user', content);
    if (attachments.length) message.images = attachments;
    const updated = await this.store.appendThreadMessage(thread.id, message);
    if (!updated) throw new Error('这个对话不在了。');
    this.emit({ type: 'free:threads', threads: this.store.listThreadSummaries(), threadId: thread.id, channel: 'freechat' });
    return { message, threadId: updated.id };
  }

  stopFreeChat(threadId?: string) {
    if (threadId && this.freeChatThreadId && threadId !== this.freeChatThreadId) return;
    try { this.freeChatController?.abort(); } catch {}
  }

  async generateFreeChat({ openingInstruction, proactive = false, threadId, proactiveDay }: {
    openingInstruction?: string; proactive?: boolean; threadId?: string; proactiveDay?: string;
  } = {}) {
    if (this.freeChatBusy) return null;
    const thread = proactiveDay
      ? this.store.newThread({ origin: 'daily' })
      : threadId ? this.store.getThread(threadId) : await this.store.ensureActiveThread();
    if (this.freeChatBusy) return null;
    if (!thread) throw new Error('这个对话不在了。');
    const last = thread.messages[thread.messages.length - 1];
    if (!openingInstruction && last?.role === 'assistant') return null;
    const apiKey = this.store.getApiKey();
    const config = { ...this.store.config };
    if (!apiKey) {
      const err = new ApiError('missing key', { code: 'NO_KEY' });
      this.emit({ type: 'chat:error', sessionId: thread.id, channel: 'freechat', message: friendlyError(err) });
      throw err;
    }
    this.freeChatBusy = true;
    this.freeChatThreadId = thread.id;
    const controller = new AbortController();
    this.freeChatController = controller;
    const sessionId = thread.id;
    const eventBase = { sessionId, threadId: sessionId, channel: 'freechat' };
    const log = this.freeChatLog.start(sessionId);
    this.emit({ type: 'chat:start', ...eventBase, proactive });
    const trace: any[] = [];
    let finalText = '';

    try {
      const item = thread.itemId ? this.store.getItem(thread.itemId) : null;
      const photoAccess = this.photoAccess(item, thread.messages);
      const working = this.buildFreeChatMessages(thread, openingInstruction, photoAccess);
      const tools = photoAccess ? [...FREE_CHAT_TOOLS, VIEW_ITEM_PHOTOS] : FREE_CHAT_TOOLS;
      for (let round = 0; round < 4; round += 1) {
        const logged: { round?: FreeChatLogRound } = {};
        const result = await requestChat({
          config,
          apiKey,
          messages: working,
          tools: round < 3 ? tools : undefined,
          signal: controller.signal,
          onRequest: (payload) => { logged.round = log.request(payload); },
        });
        if (logged.round) logged.round.finishReason = result.finishReason;
        if (result.toolCalls.length) {
          const assistantMessage = {
            role: 'assistant', content: result.content || null,
            ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
            tool_calls: result.toolCalls.map((tc, i) => ({ id: tc.id || `free_${round}_${i}`, type: 'function', function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '{}' } })),
          };
          working.push(assistantMessage);
          for (const tc of assistantMessage.tool_calls) {
            let args: any = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
            this.emit({ type: 'chat:tool', ...eventBase, name: tc.function.name, args, status: 'running' });
            let toolResult: any;
            let photoResult;
            try {
              if (tc.function.name === VIEW_ITEM_PHOTOS.function.name) photoResult = photoAccess?.view(args);
              toolResult = photoResult?.result ?? this.executeTool(tc.function.name, args, item, thread.id);
            } catch (err: any) {
              toolResult = { error: err?.message || '工具执行失败' };
            }
            const text = JSON.stringify(toolResult);
            logged.round?.calls.push({ id: tc.id, name: tc.function.name, args: tc.function.arguments, result: text });
            trace.push({ name: tc.function.name, args, result: truncate(text, 500) });
            this.emit({ type: 'chat:tool', ...eventBase, name: tc.function.name, args, status: 'done', preview: truncate(text, 160) });
            working.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: photoResult?.content ?? (['read_item', 'read_character'].includes(tc.function.name) ? text : truncate(text, 12000)),
            });
          }
          const images = photoAccess?.takeImageMessage();
          if (images) working.push(images);
          continue;
        }
        finalText = result.content || '';
        break;
      }
      if (!finalText.trim()) throw new Error('没有收到回复内容，请重试。');
      if (!proactiveDay) await emitText(finalText.trim(), (text) => this.emit({ type: 'chat:delta', ...eventBase, text }));
      const message = msg('assistant', finalText.trim(), {
        toolTrace: trace.length ? trace : undefined,
        viewedPhotoIds: photoAccess?.viewedIds.size ? [...photoAccess.viewedIds] : undefined,
      });
      if (proactiveDay && (this.store.config.dailyChatScheduleChangedAt !== config.dailyChatScheduleChangedAt
        || dailyChatScheduleChanged(config, this.store.config))) return null;
      const appended = proactiveDay
        ? await this.store.putThread({ ...thread, messages: [message] }, { proactiveDay })
        : await this.store.appendThreadMessage(thread.id, message);
      if (!appended) {
        this.emit({ type: 'chat:stopped', ...eventBase });
        return null;
      }
      await log.finish('done');
      this.emit({
        type: 'chat:done', ...eventBase, message, proactive,
        ...(proactiveDay && { lastProactiveAt: message.ts }),
        threads: this.store.listThreadSummaries(),
      });
      return { message, threadId: thread.id };
    } catch (err) {
      if (controller.signal.aborted) this.emit({ type: 'chat:stopped', ...eventBase });
      else {
        const message = friendlyError(err);
        await log.finish('error', message.replaceAll(apiKey, '[API Key]'));
        this.emit({ type: 'chat:error', ...eventBase, message });
      }
      throw err;
    } finally {
      await log.finish('stopped');
      this.freeChatBusy = false;
      this.freeChatController = null;
      this.freeChatThreadId = null;
    }
  }

  /** 新增 / 编辑藏品后，让管理员主动开一段关于这款藏品的对话。 */
  async itemIntro({ itemId, mode = 'create', changes = [] }: { itemId: string; mode?: 'create' | 'update'; changes?: { label: string; before: string; after: string }[] }) {
    const item = this.store.getItem(itemId);
    if (!item) throw new Error('这款周边已经被删除了。');
    if (!this.store.getApiKey()) return { skipped: 'no-key' };
    if (!isVisionReady(this.store.config)) return { skipped: 'vision-model' };
    if (this.freeChatBusy) return { skipped: 'busy' };
    const name = this.userName();
    const titleBase = mode === 'update' ? '藏品变化' : '新藏品';
    const title = `${titleBase} · ${item.name}`.slice(0, 40);
    const thread = await this.store.createThread({ title, origin: 'item', itemId: item.id });
    const context = this.itemContext(item);
    let instruction: string;
    if (mode === 'update') {
      const list = (Array.isArray(changes) ? changes : [])
        .filter((c) => c && c.label)
        .slice(0, 20)
        .map((c) => `· ${c.label}：${c.before || '（空）'} → ${c.after || '（空）'}`);
      const changesText = list.length
        ? `前后差异：\n${list.join('\n')}`
        : '资料被重新保存了一遍，但没看出实质变化。';
      instruction = this.prompt('freechat.itemIntroUpdate', {
        name,
        item: item.name,
        changes: changesText,
        context,
      });
    } else {
      instruction = this.prompt('freechat.itemIntroCreate', {
        name,
        item: item.name,
        context,
      });
    }
    this.generateFreeChat({ openingInstruction: instruction, threadId: thread.id, proactive: true }).catch(() => {});
    return { threadId: thread.id, started: true };
  }

  async maybeProactiveFreeChat(force = false, threadId?: string) {
    if (this.freeChatBusy) return { skipped: true, reason: 'busy' };
    const config = { ...this.store.config };
    if (!force && config.dailyChatEnabled === false) return { skipped: true, reason: 'disabled' };
    if (!this.store.getApiKey()) return { skipped: true, reason: 'no-key' };
    if (!force && !isVisionReady(config)) return { skipped: true, reason: 'vision-model' };
    assertVisionReady(config);
    const now = Date.now();
    const day = dayKey(new Date(now));
    const time = String(config.dailyChatTime || '22:00');
    const chat = this.store.getFreeChat();
    if (!force) {
      if (chat.lastProactiveDay === day) return { skipped: true, reason: 'done' };
      if (!isDailyChatDue(now, time, config.dailyChatScheduleChangedAt)) return { skipped: true, reason: 'not-due' };
      const lastMsg = chat.lastMessage;
      if (lastMsg && now - lastMsg.ts < 30 * 60 * 1000) {
        await this.store.putFreeChat({ lastProactiveDay: day });
        return { skipped: true, reason: 'recent-chat' };
      }
      if (chat.lastAttemptAt && now - chat.lastAttemptAt < 10 * 60 * 1000) return { skipped: true, reason: 'cooldown' };
    }
    const name = this.userName();
    const instruction = this.prompt('freechat.proactive', { time, name });
    try {
      const result = await this.generateFreeChat({
        openingInstruction: instruction, proactive: true, threadId, proactiveDay: force ? undefined : day,
      });
      if (!result) return { skipped: true, reason: 'empty' };
      if (force) await this.store.putFreeChat({ lastAttemptAt: Date.now() });
      this.emit({ type: 'free:proactive', ...result, channel: 'freechat' });
      return result;
    } catch (err) {
      if (force || this.store.config.dailyChatScheduleChangedAt === config.dailyChatScheduleChangedAt) {
        await this.store.putFreeChat({ lastAttemptAt: Date.now() });
      }
      throw err;
    }
  }

  startProactiveWatch() {
    if (this.proactiveTimer) clearInterval(this.proactiveTimer);
    const tick = () => {
      if (this.freeChatBusy) return;
      this.maybeProactiveFreeChat(false).catch(() => {});
    };
    setTimeout(tick, 5000);
    this.proactiveTimer = setInterval(tick, 60000);
  }
}


