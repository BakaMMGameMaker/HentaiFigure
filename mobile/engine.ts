import type {
  ChatMessage, FreeChatState, Item, Phase, RitualState, Session,
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
  ApiError, completeText, emitText, friendlyError, modelSupportsVision,
  requestChat,
} from './ai';

const PHASE_INSTRUCTION: Record<Phase, string> = {
  wipe:
    '【当前阶段：擦拭】用户正把一件已拥有的藏品取出来除尘，照片是实拍。你是收藏室的管理员，站在旁边看着他动手：指挥他擦哪里、用多大劲、翻哪个面，评价藏品的细节和他的手法，带点色气和调侃。不要用藏品的口吻说话，也不要替他擦；你是那个看着、点评、发号施令的管理员。',
  fantasy:
    '【当前阶段：意淫】这件藏品还在补款的路上，用户手上只有宣传图和想象。你是管理员，和他一起想象她到货后的样子，点评他挑的款式、价格和眼光，撩他、逼他描述，但不要扮演她。',
  instigate:
    '【当前阶段：教唆】这件藏品还在购物车里，用户迟迟不下单。你是仓库管理员，从库存、绝版、尾款、钱包、别人眼光这些角度逼他做一个决定。不要扮演藏品；你是那个看穿他犹豫的人。',
};

const SHOT_LABELS: Record<string, string> = Object.fromEntries(SHOT_OPTIONS.map((s) => [s.value, s.label]));
const TYPE_LABELS: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map((t) => [t.value, t.label]));

const MEMORY_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description: '在全部过去的对话记忆中按关键词搜索。适合查找某款周边、某一天、某个阶段发生过什么，或用户说过的偏好。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要搜索的关键词，例如周边名、日期、某个话题' },
          limit: { type: 'integer', description: '返回条数，1-10，默认 5' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_memory',
      description: '读取某一次历史对话的完整记录。参数是 search_memory 或 list_events 返回的 sessionId。',
      parameters: { type: 'object', properties: { session_id: { type: 'string' } }, required: ['session_id'] },
    },
  },
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
  {
    type: 'function',
    function: {
      name: 'list_collection',
      description: '列出收藏室里所有周边及其状态、价格、补款日。',
      parameters: { type: 'object', properties: {} },
    },
  },
];

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
  freeChatController: AbortController | null = null;
  proactiveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(store: MobileStore, emit: (event: any) => void) {
    this.store = store;
    this.emit = emit;
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
      phaseInstruction: phase ? PHASE_INSTRUCTION[phase] : '',
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
  pickPhotos(item: Item | null, limit: number) {
    if (!item) return [];
    const priority = ['full', 'face', 'chest', 'thigh', 'feet', 'butt', 'belly', 'back', 'armpit', 'private', 'underSkirt', 'real', 'promo', 'other'];
    return (item.photos || [])
      .map((photo, index) => ({ photo, index, rank: Math.max(0, priority.indexOf(photo.shot)) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .slice(0, Math.max(1, Math.min(10, limit)))
      .map((s) => s.photo);
  }

  itemContext(item: Item | null): string {
    if (!item) return '（这款周边的资料已经被删除了。）';
    const lines = [];
    lines.push(`名称：${item.name}`);
    lines.push(`类型：${TYPE_LABELS[item.type] || item.type || '周边'}`);
    lines.push(`状态：${item.status === 'owned' ? '已拥有' : item.status === 'pending' ? '待补款' : '观望中（购物车）'}`);
    if (item.series) lines.push(`作品 / 角色：${item.series}`);
    if (item.scale) lines.push(`规格：${item.scale}`);
    if (item.originalPrice != null) lines.push(`原始价格：${money(item.originalPrice)}`);
    if (item.purchasePrice != null) lines.push(`购入价格：${money(item.purchasePrice)}`);
    if (item.deposit != null) lines.push(`定金：${money(item.deposit)}`);
    if (item.balance != null) lines.push(`尾款：${money(item.balance)}`);
    if (item.dueDate) lines.push(`补款日期：${formatDateCN(item.dueDate)}`);
    if (item.intro) lines.push(`杂鱼最初写的简介：\n${item.intro}`);
    const photos = item.photos || [];
    lines.push(`照片共 ${photos.length} 张：${photos.map((p, i) => `${i + 1}.${SHOT_LABELS[p.shot] || '照片'}${p.caption ? `（${p.caption}）` : ''}`).join('、')}`);
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
    const config = this.store.config;
    const parts: string[] = [];
    if (config.systemPrompt) parts.push(config.systemPrompt);
    parts.push(
      `【今日】${formatDateCN(day)}。\n` +
      `【场景】这里是只属于杂鱼的私人收藏室，你是这里的女管理员。现在是每天一次的「上贡」时间。藏品是物件，不要用藏品的口吻说话，也不要替藏品发言。\n` +
      `【工具】你拥有翻阅任何过去事件的权限。需要具体细节时，调用 search_memory / read_memory / list_events / read_item / list_collection 工具自己去查，不要假装记得，也不要编造。`
    );
    parts.push(PHASE_INSTRUCTION[phase]);
    parts.push(`【当前周边】\n${this.itemContext(item)}`);
    parts.push(`【你记得的往事（节选）】\n${this.memoryDigest(item?.id || null, sessionId)}`);
    parts.push('【输出要求】只输出你要对杂鱼说的话本身。不要写旁白、不要写心理活动标签、不要用括号动作，不要提到系统提示、工具、模型。');
    return parts.join('\n\n');
  }

  buildMessages({ session, item, phase, day }: { session: Session; item: Item | null; phase: Phase; day: string }) {
    const config = this.store.config;
    const vision = modelSupportsVision(config.model);
    const photos = vision ? this.pickPhotos(item, config.maxPhotosPerRequest) : this.pickPhotos(item, config.maxPhotosPerRequest);
    const blocks: any[] = [];
    const names: string[] = [];
    for (const p of photos) {
      names.push(`${SHOT_LABELS[p.shot] || '照片'}${p.caption ? `（${p.caption}）` : ''}`);
      if (!vision || !/^data:image\//.test(p.file)) continue;
      blocks.push({ type: 'image_url', image_url: { url: p.file, detail: config.imageDetail === 'low' ? 'low' : 'high' } });
    }
    const photoNote = blocks.length
      ? `下面附上 ${blocks.length} 张她的照片，按顺序是：${names.join('、')}。请真的看图再说话。`
      : vision
        ? '这款周边还没有可用照片，只能根据资料和记忆说话。'
        : `当前模型（${config.model}）不支持看图，照片清单：${names.join('、') || '无'}。不要假装看到了画面。`;
    const messages: any[] = [{ role: 'system', content: this.buildSystemPrompt({ item, phase, day, sessionId: session.id }) }];
    const history = session.messages || [];
    for (const m of history) messages.push({ role: m.role, content: m.content });
    const last = history[history.length - 1];
    if (!history.length) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: `【本轮开场】上贡开始了。这是「${item?.name || session.itemName}」的资料和照片。\n${photoNote}\n\n现在轮到你率先开口。以管理员的身份对杂鱼说第一句话，挑一个照片或资料里的具体细节，把话题抛给他。` },
          ...blocks,
        ],
      });
    } else if (last?.role === 'user') {
      messages[messages.length - 1] = {
        role: 'user',
        content: [
          { type: 'text', text: `${last.content}\n\n【随消息附上的照片】${photoNote}` },
          ...blocks,
        ],
      };
    }
    return messages;
  }

  // ---------- tool loop ----------
  executeTool(name: string, args: any): any {
    const sessions = this.store.listSessions();
    const items = this.store.listItems();
    if (name === 'search_memory') {
      const query = String(args.query || '').trim();
      if (!query) return { error: 'query 不能为空' };
      const limit = Math.max(1, Math.min(10, Number(args.limit) || 5));
      const q = query.toLowerCase();
      const scored: any[] = [];
      for (const s of sessions) {
        if (!s.archived) continue;
        let score = 0;
        if (String(s.itemName).toLowerCase().includes(q)) score += 6;
        if (String(s.summary).toLowerCase().includes(q)) score += 4;
        if (String(s.day).includes(q)) score += 3;
        let snippet = '';
        for (const m of s.messages || []) {
          if (!snippet && String(m.content).toLowerCase().includes(q)) {
            const idx = String(m.content).toLowerCase().indexOf(q);
            snippet = truncate(String(m.content).slice(Math.max(0, idx - 60), idx + 180), 220);
            score += 3;
          }
        }
        if (score) scored.push({ score, sessionId: s.id, date: s.day, phase: PHASE_META[s.phase]?.label || s.phase, itemName: s.itemName, summary: truncate(s.summary, 220), snippet });
      }
      scored.sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)));
      return { results: scored.slice(0, limit).map(({ score, ...rest }) => rest) };
    }
    if (name === 'read_memory') {
      const s = sessions.find((x) => x.id === args.session_id);
      if (!s) return { error: '没有这次对话记录' };
      const transcript = (s.messages || []).map((m) => `${m.role === 'user' ? '杂鱼' : '管理员'}：${m.content}`).join('\n');
      return { sessionId: s.id, date: s.day, phase: PHASE_META[s.phase]?.label || s.phase, itemName: s.itemName, summary: s.summary, outcome: s.outcome, transcript: truncate(transcript, 9000) };
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
      return { item: { id: item.id, name: item.name, type: TYPE_LABELS[item.type] || item.type, status: item.status, series: item.series, scale: item.scale, originalPrice: item.originalPrice, purchasePrice: item.purchasePrice, deposit: item.deposit, balance: item.balance, dueDate: item.dueDate, intro: item.intro, photos: (item.photos || []).map((p) => SHOT_LABELS[p.shot] || '照片') }, history };
    }
    if (name === 'list_collection') {
      return {
        counts: this.counts(),
        items: items.map((i) => ({ id: i.id, name: i.name, type: TYPE_LABELS[i.type] || i.type, status: i.status, price: i.purchasePrice ?? i.originalPrice ?? null, deposit: i.deposit ?? null, balance: i.balance ?? null, dueDate: i.dueDate || null })),
      };
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
    if (!apiKey) {
      const err = new ApiError('missing key', { code: 'NO_KEY' });
      this.emit({ type: 'chat:error', sessionId, message: friendlyError(err) });
      throw err;
    }
    const item = this.store.getItem(session.itemId);
    const working = this.buildMessages({ session, item, phase: session.phase, day: session.day || this.today() });
    this.busy.add(sessionId);
    const controller = new AbortController();
    this.controllers.set(sessionId, controller);
    this.emit({ type: 'chat:start', sessionId, phase: session.phase });
    const trace: any[] = [];
    let finalText = '';

    try {
      for (let round = 0; round < 4; round += 1) {
        const result = await requestChat({
          config: this.store.config,
          apiKey,
          messages: working,
          tools: MEMORY_TOOLS,
          signal: controller.signal,
        });
        if (result.toolCalls.length) {
          const assistantMessage = {
            role: 'assistant',
            content: result.content || null,
            tool_calls: result.toolCalls.map((tc, i) => ({ id: tc.id || `call_${round}_${i}`, type: 'function', function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '{}' } })),
          };
          working.push(assistantMessage);
          for (const tc of assistantMessage.tool_calls) {
            let args: any = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
            this.emit({ type: 'chat:tool', sessionId, name: tc.function.name, args, status: 'running' });
            let toolResult: any;
            try { toolResult = this.executeTool(tc.function.name, args); } catch (err: any) { toolResult = { error: err?.message || '工具执行失败' }; }
            const text = JSON.stringify(toolResult);
            trace.push({ name: tc.function.name, args, result: truncate(text, 500) });
            this.emit({ type: 'chat:tool', sessionId, name: tc.function.name, args, status: 'done', preview: truncate(text, 160) });
            working.push({ role: 'tool', tool_call_id: tc.id, content: truncate(text, 12000) });
          }
          continue;
        }
        finalText = result.content || '';
        break;
      }
      if (!finalText.trim()) throw new Error('没有收到回复内容，请重试。');
      await emitText(finalText.trim(), (text) => this.emit({ type: 'chat:delta', sessionId, text }));
      const message = msg('assistant', finalText.trim(), { toolTrace: trace.length ? trace : undefined });
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
    const transcript = session.messages.map((m) => `${m.role === 'user' ? '杂鱼' : '管理员'}：${m.content}`).join('\n');
    if (!transcript.trim()) return this.fallbackSummary(session);
    try {
      const text = await completeText({
        config: this.store.config,
        apiKey,
        messages: [
          { role: 'system', content: '你是记忆整理员。用不超过 140 字的中文、第三人称，客观记录这次「上贡」对话。必须保留：对这款周边的评价、用户透露的偏好或雷点、双方约定与承诺、情绪变化。不要续写，不要评价，不要虚构，不要用第一人称。' },
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

  // ---------- free chat ----------
  freeChatState(): FreeChatState {
    const chat = this.store.getFreeChat();
    return { ...chat, busy: this.freeChatBusy, dailyChatEnabled: this.store.config.dailyChatEnabled !== false, dailyChatTime: this.store.config.dailyChatTime || '22:00' };
  }

  collectionDigest() {
    const items = this.store.listItems();
    const counts = this.counts();
    const lines = [`已拥有 ${counts.owned} 件，待补款 ${counts.pending} 件，观望中 ${counts.watching} 件。`];
    if (!items.length) {
      lines.push('收藏室目前是空的。');
      return lines.join('\n');
    }
    for (const item of items.slice(0, 12)) {
      const status = item.status === 'owned' ? '已拥有' : item.status === 'pending' ? '待补款' : '观望中';
      const price = item.status === 'pending' ? `尾款 ${money(item.balance)}${item.dueDate ? `，补款 ${formatDateCN(item.dueDate)}` : ''}` : `价格 ${money(item.purchasePrice ?? item.originalPrice)}`;
      lines.push(`- ${item.name}（${TYPE_LABELS[item.type] || '周边'}，${status}，${price}）`);
    }
    for (const item of items.filter((i) => i.intro).slice(0, 3)) lines.push(`· ${item.name} 的简介：${truncate(item.intro, 160)}`);
    return lines.join('\n');
  }

  buildFreeChatSystemPrompt() {
    const parts: string[] = [];
    if (this.store.config.systemPrompt) parts.push(this.store.config.systemPrompt);
    parts.push(`【今日】${formatDateCN(this.today())}。\n【场景】这是收藏室的日常对话，不是「上贡」流程。你是收藏室的女管理员，替他打理这间仓库；他是藏家杂鱼。你们随便聊收藏、钱、旧事和欲望。不要主动推进擦拭/意淫/教唆阶段，除非杂鱼提起。`);
    parts.push(`【收藏室】\n${this.collectionDigest()}`);
    parts.push(`【你记得的往事（节选）】\n${this.memoryDigest(null, null)}`);
    parts.push('【工具】你拥有翻阅任何过去事件的权限。需要旧对话、某一天或某款周边资料时，调用 search_memory / read_memory / list_events / read_item / list_collection 工具自己查，不要编造。');
    parts.push('【输出要求】只输出你要对杂鱼说的话。你是管理员本人，不要用藏品的口吻说话，不要替藏品发言。');
    return parts.join('\n\n');
  }

  buildFreeChatMessages(openingInstruction?: string) {
    const chat = this.store.getFreeChat();
    const history = chat.messages.slice(-40);
    const messages: any[] = [{ role: 'system', content: this.buildFreeChatSystemPrompt() }];
    for (const m of history) messages.push({ role: m.role, content: m.content });
    if (openingInstruction) messages.push({ role: 'user', content: openingInstruction });
    else if (!history.length) messages.push({ role: 'user', content: '【日常开场】杂鱼刚打开收藏室。以管理员的身份主动开口，从收藏室最近的情况或你记得的旧事里挑一个点，调侃他、撩他，把话题抛给他。不要提这是系统提醒。' });
    return messages;
  }

  async sendFreeChatUserMessage(text: string) {
    if (this.freeChatBusy) throw new Error('管理员还在说话，等一句说完。');
    const content = String(text || '').trim();
    if (!content) throw new Error('说点什么再发。');
    if (content.length > 4000) throw new Error('一次最多 4000 字。');
    const chat = this.store.getFreeChat();
    const message = msg('user', content);
    chat.messages.push(message);
    await this.store.putFreeChat(chat);
    return message;
  }

  stopFreeChat() {
    try { this.freeChatController?.abort(); } catch {}
  }

  async generateFreeChat({ openingInstruction, proactive = false }: { openingInstruction?: string; proactive?: boolean } = {}) {
    if (this.freeChatBusy) return null;
    const chat = this.store.getFreeChat();
    const last = chat.messages[chat.messages.length - 1];
    if (!openingInstruction && last?.role === 'assistant') return null;
    const apiKey = this.store.getApiKey();
    if (!apiKey) {
      const err = new ApiError('missing key', { code: 'NO_KEY' });
      this.emit({ type: 'chat:error', sessionId: 'freechat', message: friendlyError(err) });
      throw err;
    }
    this.freeChatBusy = true;
    const controller = new AbortController();
    this.freeChatController = controller;
    const sessionId = 'freechat';
    this.emit({ type: 'chat:start', sessionId, proactive });
    const working = this.buildFreeChatMessages(openingInstruction);
    const trace: any[] = [];
    let finalText = '';

    try {
      for (let round = 0; round < 4; round += 1) {
        const result = await requestChat({ config: this.store.config, apiKey, messages: working, tools: MEMORY_TOOLS, signal: controller.signal });
        if (result.toolCalls.length) {
          const assistantMessage = {
            role: 'assistant', content: result.content || null,
            tool_calls: result.toolCalls.map((tc, i) => ({ id: tc.id || `free_${round}_${i}`, type: 'function', function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '{}' } })),
          };
          working.push(assistantMessage);
          for (const tc of assistantMessage.tool_calls) {
            let args: any = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
            this.emit({ type: 'chat:tool', sessionId, name: tc.function.name, args, status: 'running' });
            let toolResult: any;
            try { toolResult = this.executeTool(tc.function.name, args); } catch (err: any) { toolResult = { error: err?.message || '工具执行失败' }; }
            const text = JSON.stringify(toolResult);
            trace.push({ name: tc.function.name, args, result: truncate(text, 500) });
            this.emit({ type: 'chat:tool', sessionId, name: tc.function.name, args, status: 'done', preview: truncate(text, 160) });
            working.push({ role: 'tool', tool_call_id: tc.id, content: truncate(text, 12000) });
          }
          continue;
        }
        finalText = result.content || '';
        break;
      }
      if (!finalText.trim()) throw new Error('没有收到回复内容，请重试。');
      await emitText(finalText.trim(), (text) => this.emit({ type: 'chat:delta', sessionId, text }));
      const message = msg('assistant', finalText.trim(), { toolTrace: trace.length ? trace : undefined });
      const fresh = this.store.getFreeChat();
      fresh.messages.push(message);
      await this.store.putFreeChat(fresh);
      this.emit({ type: 'chat:done', sessionId, message, proactive });
      return message;
    } catch (err) {
      if (controller.signal.aborted) this.emit({ type: 'chat:stopped', sessionId });
      else this.emit({ type: 'chat:error', sessionId, message: friendlyError(err) });
      throw err;
    } finally {
      this.freeChatBusy = false;
      this.freeChatController = null;
    }
  }

  async maybeProactiveFreeChat(force = false) {
    const config = this.store.config;
    if (!force && config.dailyChatEnabled === false) return { skipped: true, reason: 'disabled' };
    if (!this.store.getApiKey()) return { skipped: true, reason: 'no-key' };
    const now = Date.now();
    const day = this.today();
    const chat = this.store.getFreeChat();
    if (!force) {
      if (chat.lastProactiveDay === day) return { skipped: true, reason: 'done' };
      const [hh, mm] = String(config.dailyChatTime || '22:00').split(':').map((n) => Number(n) || 0);
      const d = new Date();
      if (d.getHours() * 60 + d.getMinutes() < hh * 60 + mm) return { skipped: true, reason: 'not-due' };
      const last = chat.messages[chat.messages.length - 1];
      if (last && now - last.ts < 30 * 60 * 1000) {
        chat.lastProactiveDay = day;
        await this.store.putFreeChat(chat);
        return { skipped: true, reason: 'recent-chat' };
      }
      if (chat.lastAttemptAt && now - chat.lastAttemptAt < 10 * 60 * 1000) return { skipped: true, reason: 'cooldown' };
    }
    if (this.freeChatBusy) return { skipped: true, reason: 'busy' };
    const instruction = `【每日主动话题】现在是 ${config.dailyChatTime || '22:00'}，轮到你主动来找杂鱼。先翻阅你的记忆和收藏室：挑一件最近上贡 / 待补款 / 观望中的周边，或者翻一件旧账，以管理员的身份主动说第一句话，把话题抛给他。不要提系统提醒，不要重复最近才聊过的话题，2～4 段以内。`;
    try {
      const message = await this.generateFreeChat({ openingInstruction: instruction, proactive: true });
      if (!message) return { skipped: true, reason: 'empty' };
      const fresh = this.store.getFreeChat();
      fresh.lastAttemptAt = Date.now();
      if (!force) {
        fresh.lastProactiveDay = day;
        fresh.lastProactiveAt = Date.now();
      }
      await this.store.putFreeChat(fresh);
      this.emit({ type: 'free:proactive', message });
      return { message };
    } catch (err) {
      const fresh = this.store.getFreeChat();
      fresh.lastAttemptAt = Date.now();
      await this.store.putFreeChat(fresh);
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


