'use strict';

const { streamChat, completeText, friendlyError, ApiError, dataUrlFromFile } =
  require('./deepseek.cjs');
const promptLib = require('./prompts.cjs');
const { VIEW_ITEM_PHOTOS, createPhotoAccess } = require('./chat-photos.mjs');
const { LIST_COLLECTION, MEMORY_LOOKUP_TOOLS, collectionPage, readMemory, searchMemory } = require('./chat-memory.mjs');
const { assertVisionReady, isVisionReady } = require('./vision-config.mjs');

const PHASES = ['wipe', 'fantasy', 'instigate'];
// 阶段规则不再写死在这里，而是来自 electron/prompts.default.json
// （键名 ritual.phaseWipe / phaseFantasy / phaseInstigate），可以由用户在进阶设置里改。
const PHASE_META = {
  wipe: {
    label: '擦拭',
    status: 'owned',
    itemWord: '已拥有',
    finishLabel: '擦拭完毕',
    promptKey: 'ritual.phaseWipe',
  },
  fantasy: {
    label: '意淫',
    status: 'pending',
    itemWord: '待补款',
    finishLabel: '意淫完毕',
    promptKey: 'ritual.phaseFantasy',
  },
  instigate: {
    label: '教唆',
    status: 'watching',
    itemWord: '观望中',
    finishLabel: '结束本轮',
    promptKey: 'ritual.phaseInstigate',
  },
};

const SHOT_LABELS = {
  promo: '宣传图',
  real: '实物图',
  full: '全身照',
  face: '脸蛋',
  armpit: '腋下',
  chest: '胸部',
  back: '美背',
  belly: '肚子',
  private: '私处',
  butt: '屁股',
  underSkirt: '裙底',
  thigh: '大腿',
  feet: '玉足',
  other: '其他',
};

const TYPE_LABELS = {
  figure: '手办',
  acrylic: '亚克力立牌',
  pillow: '抱枕',
  poster: '海报',
  badge: '徽章',
  itabag: '痛包',
  plush: '毛绒',
  other: '周边',
};

const MEMORY_TOOLS = [
  ...MEMORY_LOOKUP_TOOLS,
  {
    type: 'function',
    function: {
      name: 'list_events',
      description: '按日期范围、阶段或周边列出过去发生的事件（上贡记录）。可按需筛选。',
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
      parameters: {
        type: 'object',
        properties: { item_id: { type: 'string' } },
        required: ['item_id'],
      },
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
  {
    type: 'function',
    function: {
      name: 'read_character',
      description: '读取某个角色档案的完整设定，以及关联在这个角色名下的所有周边和上贡记录。参数是 list_characters 或 read_item 返回的 characterId。',
      parameters: {
        type: 'object',
        properties: { character_id: { type: 'string' } },
        required: ['character_id'],
      },
    },
  },
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dateLabel(dateKey) {
  if (!dateKey) return '';
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey;
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日 周${weekday}`;
}

function moneyLabel(value) {
  if (value === null || value === undefined || value === '') return '未记录';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `¥${n.toLocaleString('zh-CN')}`;
}

function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function truncate(text, max) {
  const str = String(text || '');
  if (str.length <= max) return str;
  return `${str.slice(0, Math.max(0, max - 1))}…`;
}

function newPhaseRecord() {
  return {
    status: 'pending',
    itemId: null,
    sessionId: null,
    startedAt: null,
    endedAt: null,
    outcome: null,
  };
}

class RitualService {
  constructor({ store, sendEvent }) {
    this.store = store;
    this.sendEvent = (payload) => {
      try { sendEvent(payload); } catch {}
    };
    this.busy = new Set();
    this.controllers = new Map();
    this.freeChatBusy = false;
    this.freeChatController = null;
    this.freeChatThreadId = null;
  }

  // ---------- dates ----------
  today() {
    return localDateKey();
  }

  /** 用户设置的昵称；管理员照着这个称呼他。 */
  userName() {
    const name = String(this.store.config.userName || '').trim();
    return name || '杂鱼';
  }

  /** 取一条当前生效的提示词模板（系统默认 + 用户覆盖层）并渲染变量。 */
  prompt(key, vars) {
    const values = this.store.promptValues();
    return promptLib.render(values[key] ?? promptLib.get(key), vars);
  }

  /** 只保留非空片段，避免用户在进阶设置里删空某一块后留下空行。 */
  pushPart(parts, text) {
    const value = String(text || '');
    if (value.trim()) parts.push(value);
    return parts;
  }

  // ---------- state ----------
  counts() {
    const items = this.store.listItems();
    return {
      owned: items.filter((i) => i.status === 'owned').length,
      pending: items.filter((i) => i.status === 'pending').length,
      watching: items.filter((i) => i.status === 'watching').length,
      total: items.length,
    };
  }

  eligibleFor(phase, record) {
    const status = PHASE_META[phase].status;
    const used = record?.phases?.[phase]?.itemId;
    return this.store.listItems().filter((item) => item.status === status && item.id !== used);
  }

  eligibleCounts(record) {
    return {
      wipe: this.eligibleFor('wipe', record).length,
      fantasy: this.eligibleFor('fantasy', record).length,
      instigate: this.eligibleFor('instigate', record).length,
    };
  }

  hydrate(record, day = this.today()) {
    const items = this.store.listItems();
    const counts = {
      owned: items.filter((i) => i.status === 'owned').length,
      pending: items.filter((i) => i.status === 'pending').length,
      watching: items.filter((i) => i.status === 'watching').length,
      total: items.length,
    };
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

    const phase = record.phase === 'done' ? null : record.phase;
    const phaseRec = phase ? record.phases[phase] : null;
    const item = phaseRec?.itemId ? this.store.getItem(phaseRec.itemId) : null;
    const session = phaseRec?.sessionId ? this.store.getSession(phaseRec.sessionId) : null;

    return {
      day: record.date,
      exists: true,
      status: record.status,
      phase,
      phaseLabel: phase ? PHASE_META[phase].label : '',
      phaseInstruction: phase ? this.prompt(PHASE_META[phase].promptKey, {}) : '',
      phases: record.phases,
      item,
      session,
      progress: PHASES.map((p) => ({
        phase: p,
        label: PHASE_META[p].label,
        status: record.phases[p]?.status || 'pending',
        itemName: record.phases[p]?.itemId
          ? (items.find((i) => i.id === record.phases[p].itemId)?.name ||
             this.store.getSession(record.phases[p]?.sessionId)?.itemName || '')
          : '',
      })),
      eligible: this.eligibleCounts(record),
      counts,
      hasAnyItem: items.length > 0,
      startedAt: record.startedAt,
      completedAt: record.completedAt || null,
    };
  }

  ensureRecord(day) {
    let record = this.store.getDaily(day);
    if (record && record.status === 'empty') {
      this.store.daily[day] = null;
      delete this.store.daily[day];
      this.store.saveDaily();
      record = null;
    }
    if (record) return record;
    const now = Date.now();
    record = {
      date: day,
      status: 'in_progress',
      phase: 'wipe',
      phases: {
        wipe: newPhaseRecord(),
        fantasy: newPhaseRecord(),
        instigate: newPhaseRecord(),
      },
      startedAt: now,
      completedAt: null,
    };
    this.store.putDaily(record);
    return this.store.getDaily(day);
  }

  advancePointer(record) {
    const idx = PHASES.indexOf(record.phase);
    if (idx < 0 || idx === PHASES.length - 1) {
      record.phase = 'done';
      return;
    }
    record.phase = PHASES[idx + 1];
  }

  /**
   * Skip empty phases, finish the round when exhausted.
   * Returns 'empty' when nothing at all could be done and no session happened.
   */
  normalize(record) {
    let guard = 0;
    while (guard < 8) {
      guard += 1;
      if (record.status === 'complete') return;
      if (record.phase === 'done') break;
      const ph = record.phase;
      const prec = record.phases[ph];
      if (prec.status === 'done' || prec.status === 'skipped') {
        this.advancePointer(record);
        continue;
      }
      if (prec.status === 'active') return;
      if (this.eligibleFor(ph, record).length === 0) {
        if (prec.status === 'pending') {
          prec.status = 'skipped';
          prec.skippedAt = Date.now();
        }
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

  start(day = this.today()) {
    if (!this.counts().total) {
      return {
        state: this.hydrate(null, day),
        empty: true,
        message: '收藏室还是空的。先点左上角的「添加」，把她放进来吧。',
      };
    }
    let record = this.ensureRecord(day);
    if (record.status === 'complete') {
      return { state: this.hydrate(record, day), complete: true };
    }
    this.normalize(record);
    if (record.status === 'empty') {
      delete this.store.daily[day];
      this.store.saveDaily();
      return {
        state: this.hydrate(null, day),
        empty: true,
        message: '今天没有可以上贡的周边：已拥有、待补款、观望中都是空的。',
      };
    }
    this.store.putDaily(record);
    return { state: this.hydrate(record, day) };
  }

  getState(day = this.today()) {
    const record = this.store.getDaily(day);
    if (!record) return this.hydrate(null, day);
    // Do not advance/complete on a pure read; just report.
    return this.hydrate(record, day);
  }

  open(day = this.today()) {
    let record = this.store.getDaily(day);
    if (!record) return this.start(day);
    if (record.status === 'complete') return { state: this.hydrate(record, day), complete: true };

    this.normalize(record);
    if (record.status === 'complete') {
      this.store.putDaily(record);
      return { state: this.hydrate(record, day), complete: true };
    }
    if (record.status === 'empty') {
      delete this.store.daily[day];
      this.store.saveDaily();
      return {
        state: this.hydrate(null, day),
        empty: true,
        message: '今天没有可以上贡的周边。',
      };
    }

    const phase = record.phase;
    if (!PHASES.includes(phase)) {
      this.store.putDaily(record);
      return { state: this.hydrate(record, day) };
    }
    const prec = record.phases[phase];

    if (prec.status === 'active' && prec.sessionId) {
      this.store.putDaily(record);
      return { state: this.hydrate(record, day) };
    }

    const pool = this.eligibleFor(phase, record);
    if (!pool.length) {
      this.normalize(record);
      this.store.putDaily(record);
      return { state: this.hydrate(record, day) };
    }

    // Prefer items that have waited longest since their last turn, then randomize
    // within that pool so repeats across rounds stay uncommon but not predictable.
    const lastField = { wipe: 'lastWipedAt', fantasy: 'lastFantasyAt', instigate: 'lastInstigatedAt' }[phase];
    const sorted = pool.slice().sort((a, b) => (a[lastField] || 0) - (b[lastField] || 0));
    const poolSize = Math.max(1, Math.min(sorted.length, Math.ceil(sorted.length * 0.5)));
    const item = shuffle(sorted.slice(0, poolSize))[0] || sorted[0];

    const sessionId = this.store.newId('ses');
    const now = Date.now();
    const session = {
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
      toolTrace: [],
    };
    this.store.putSession(session);

    prec.status = 'active';
    prec.itemId = item.id;
    prec.sessionId = sessionId;
    prec.startedAt = now;
    this.store.putDaily(record);

    return { state: this.hydrate(record, day) };
  }

  findPhaseBySession(recordOrDay, sessionId) {
    const record = typeof recordOrDay === 'string' ? this.store.getDaily(recordOrDay) : recordOrDay;
    if (!record) return { record: null, phase: null, prec: null };
    for (const p of PHASES) {
      if (record.phases[p]?.sessionId === sessionId) {
        return { record, phase: p, prec: record.phases[p] };
      }
    }
    return { record, phase: null, prec: null };
  }

  skipPhase(day = this.today()) {
    const record = this.store.getDaily(day);
    if (!record || record.status === 'complete') {
      return { state: this.hydrate(record, day) };
    }
    const prec = record.phases[record.phase];
    if (prec?.status === 'active' && prec.sessionId) {
      this.stop(prec.sessionId);
      const session = this.store.getSession(prec.sessionId);
      if (session) {
        session.endedAt = Date.now();
        session.archived = true;
        session.summary = session.summary || '（本阶段被跳过）';
        session.outcome = { ...(session.outcome || {}), skipped: true };
        this.store.putSession(session);
      }
    }
    if (prec) {
      prec.status = 'skipped';
      prec.endedAt = Date.now();
    }
    this.advancePointer(record);
    this.normalize(record);
    this.store.putDaily(record);
    return { state: this.hydrate(record, day) };
  }

  // ---------- chat ----------
  stop(sessionId) {
    const controller = this.controllers.get(sessionId);
    if (controller) {
      try { controller.abort(); } catch {}
    }
  }

  isBusy(sessionId) {
    return this.busy.has(sessionId);
  }

  photoAccess(item, history) {
    return createPhotoAccess({
      photos: item?.photos || [],
      history,
      labels: SHOT_LABELS,
      config: this.store.config,
      loadImage: (photo) => {
        const abs = this.store.absImagePath(photo.file);
        return abs ? dataUrlFromFile(abs, 1400) : null;
      },
    });
  }

  characterFor(item) {
    if (!item || !item.characterId) return null;
    return this.store.getCharacter(item.characterId);
  }

  characterContext(character, items) {
    if (!character) return '';
    const lines = [`角色：${character.name}`];
    if (character.source) lines.push(`出自作品：${character.source}`);
    if (character.description) lines.push(`角色背景：${character.description}`);
    const related = (items || this.store.listItems()).filter((i) => i.characterId === character.id);
    if (related.length > 1) {
      lines.push(`这个角色在收藏室里还有 ${related.length - 1} 款周边：${related.filter((i) => i.name).map((i) => i.name).slice(0, 8).join('、')}。`);
    }
    return lines.join('\n');
  }

  itemContext(item) {
    if (!item) return '（这款周边的资料已经被删除了。）';
    const name = this.userName();
    const lines = [];
    lines.push(`名称：${item.name}`);
    lines.push(`类型：${TYPE_LABELS[item.type] || item.type || '周边'}`);
    const statusLabel = item.status === 'owned' ? '已拥有' : item.status === 'pending' ? '待补款' : '观望中（购物车）';
    lines.push(`状态：${statusLabel}`);
    const character = this.characterFor(item);
    if (character) {
      lines.push(`角色：${character.name}${character.source ? `（出自 ${character.source}）` : ''}`);
    } else if (item.series) {
      lines.push(`作品 / 角色：${item.series}`);
    }
    if (item.scale) lines.push(`规格：${item.scale}`);
    if (item.originalPrice != null) lines.push(`原始价格：${moneyLabel(item.originalPrice)}`);
    if (item.purchasePrice != null) lines.push(`购入价格：${moneyLabel(item.purchasePrice)}`);
    if (item.deposit != null) lines.push(`定金：${moneyLabel(item.deposit)}`);
    if (item.balance != null) lines.push(`尾款：${moneyLabel(item.balance)}`);
    if (item.dueDate) lines.push(`补款日期：${dateLabel(item.dueDate)}`);
    if (item.detail) lines.push(`商品详情 / 情报（这款周边本身是什么、为什么会有）：\n${item.detail}`);
    if (item.thought) lines.push(`${name} 当时写下的「最初的想法」（他买下或加购时的心路历程，可作为鉴赏和调戏的素材）：\n${item.thought}`);
    const photos = Array.isArray(item.photos) ? item.photos : [];
    lines.push(`照片共 ${photos.length} 张：${photos.map((p, i) => `${i + 1}.${SHOT_LABELS[p.shot] || '照片'}${p.caption ? `（${p.caption}）` : ''}`).join('、')}`);
    return lines.join('\n');
  }

  memoryDigest(currentItemId, currentSessionId) {
    const sessions = this.store.listSessions()
      .filter((s) => s.archived && s.id !== currentSessionId)
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

    const itemSessions = sessions.filter((s) => s.itemId === currentItemId).slice(0, 6);
    const globalSessions = sessions.slice(0, 12);
    const seen = new Set();
    const lines = [];

    for (const s of itemSessions) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      lines.push(`· ${s.day} ${PHASE_META[s.phase]?.label || s.phase}「${s.itemName}」：${truncate(s.summary || '（没有摘要）', 240)}`);
    }
    for (const s of globalSessions) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      lines.push(`· ${s.day} ${PHASE_META[s.phase]?.label || s.phase}「${s.itemName}」：${truncate(s.summary || '（没有摘要）', 200)}`);
    }
    if (!lines.length) return '（这是你们的第一次上贡，还没有可翻的旧账。）';
    return truncate(lines.join('\n'), 5200);
  }

  buildSystemPrompt({ item, phase, day, sessionId }) {
    const name = this.userName();
    const parts = [];
    this.pushPart(parts, this.prompt('persona', { name }));
    this.pushPart(parts, this.prompt('ritual.scene', { date: dateLabel(day), name }));
    this.pushPart(parts, this.prompt('ritual.tools', { name }));
    const meta = PHASE_META[phase];
    if (meta) this.pushPart(parts, this.prompt(meta.promptKey, { name }));
    this.pushPart(parts, this.prompt('ritual.itemBlock', { context: this.itemContext(item), name }));
    const character = this.characterFor(item);
    if (character) {
      this.pushPart(parts, this.prompt('ritual.characterBlock', {
        context: this.characterContext(character),
        name,
      }));
    }
    this.pushPart(parts, this.prompt('ritual.memoryBlock', {
      digest: this.memoryDigest(item?.id, sessionId),
      name,
    }));
    this.pushPart(parts, this.prompt('ritual.output', { name }));
    return parts.join('\n\n');
  }

  buildMessages({ session, item, phase, day, photoAccess }) {
    const system = this.buildSystemPrompt({ item, phase, day, sessionId: session.id });
    const photoNote = photoAccess
      ? this.prompt('ritual.photoNote', { count: photoAccess.count, names: photoAccess.names })
      : this.prompt('ritual.photoNoteNoFiles', {});
    const messages = [{ role: 'system', content: `${system}\n\n${photoAccess?.instructions || photoNote}` }];

    const history = Array.isArray(session.messages) ? session.messages : [];
    for (const m of history) {
      if (m.role === 'assistant') messages.push({ role: 'assistant', content: m.content });
      else messages.push({ role: 'user', content: m.content });
    }

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
      const idx = messages.length - 1;
      messages[idx] = {
        role: 'user',
        content: this.prompt('ritual.photoAttached', { text: last.content, photoNote }),
      };
    }

    return messages;
  }

  appendMessage(session, message) {
    session.messages = Array.isArray(session.messages) ? session.messages : [];
    session.messages.push(message);
    this.store.putSession(session);
    return message;
  }

  async generate(sessionId) {
    if (this.busy.has(sessionId)) return;
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error('这次对话不存在。');
    if (session.archived) throw new Error('这次对话已经归档了。');
    const last = session.messages[session.messages.length - 1];
    if (last?.role === 'assistant') return;

    const item = this.store.getItem(session.itemId);
    const day = session.day || this.today();
    const photoAccess = this.photoAccess(item, session.messages);
    const messages = this.buildMessages({ session, item, phase: session.phase, day, photoAccess });
    const apiKey = this.store.getApiKey();
    const config = { ...this.store.config };
    if (!apiKey) {
      const err = new ApiError('missing key', { code: 'NO_KEY' });
      this.sendEvent({ type: 'chat:error', sessionId, message: friendlyError(err) });
      throw err;
    }

    this.busy.add(sessionId);
    const controller = new AbortController();
    this.controllers.set(sessionId, controller);
    this.sendEvent({ type: 'chat:start', sessionId, phase: session.phase });
    let full = '';
    let reasoning = '';
    const toolTrace = [];
    const working = messages.slice();
    const tools = photoAccess ? [...MEMORY_TOOLS, VIEW_ITEM_PHOTOS] : MEMORY_TOOLS;

    try {
      for (let round = 0; round < 4; round += 1) {
        const result = await streamChat({
          config,
          apiKey,
          messages: working,
          tools: round < 3 ? tools : undefined,
          signal: controller.signal,
          onDelta: (text) => {
            full += text;
            this.sendEvent({ type: 'chat:delta', sessionId, text });
          },
          onReasoning: (text) => {
            reasoning += text;
            this.sendEvent({ type: 'chat:reasoning', sessionId, text });
          },
        });

        if (result.toolCalls?.length) {
          const assistantToolMessage = {
            role: 'assistant',
            content: result.content || null,
            ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
            tool_calls: result.toolCalls.map((tc, i) => ({
              id: tc.id || `call_${round}_${i}`,
              type: 'function',
              function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '{}' },
            })),
          };
          if (result.content) {
            full = result.content;
            this.sendEvent({ type: 'chat:reset', sessionId, text: full });
          }
          working.push(assistantToolMessage);

          for (const tc of assistantToolMessage.tool_calls) {
            let args = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
            this.sendEvent({
              type: 'chat:tool',
              sessionId,
              name: tc.function.name,
              args,
              status: 'running',
            });
            let toolResult;
            let photoResult;
            try {
              if (tc.function.name === VIEW_ITEM_PHOTOS.function.name) photoResult = photoAccess?.view(args);
              toolResult = photoResult?.result ?? this.executeTool(tc.function.name, args);
            } catch (err) {
              toolResult = { error: err?.message || '工具执行失败' };
            }
            const text = JSON.stringify(toolResult);
            toolTrace.push({
              name: tc.function.name,
              args,
              result: truncate(text, 500),
            });
            this.sendEvent({
              type: 'chat:tool',
              sessionId,
              name: tc.function.name,
              args,
              status: 'done',
              preview: truncate(text, 160),
            });
            working.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: photoResult?.content ?? (tc.function.name === 'read_item' ? text : truncate(text, 12000)),
            });
          }
          const images = photoAccess?.takeImageMessage();
          if (images) working.push(images);
          full = '';
          reasoning = '';
          continue;
        }

        full = result.content || full;
        break;
      }

      const text = full.trim();
      if (!text) throw new Error('没有收到回复内容，请重试。');
      const message = {
        id: this.store.newId('msg'),
        role: 'assistant',
        content: text,
        ts: Date.now(),
        reasoning: reasoning ? truncate(reasoning, 6000) : '',
        toolTrace: toolTrace.length ? toolTrace : undefined,
        viewedPhotoIds: photoAccess?.viewedIds.size ? [...photoAccess.viewedIds] : undefined,
      };
      this.appendMessage(session, message);
      this.sendEvent({ type: 'chat:done', sessionId, message });
    } catch (err) {
      if (controller.signal.aborted) {
        this.sendEvent({ type: 'chat:stopped', sessionId });
      } else {
        this.sendEvent({ type: 'chat:error', sessionId, message: friendlyError(err) });
      }
      throw err;
    } finally {
      this.busy.delete(sessionId);
      this.controllers.delete(sessionId);
    }
  }

  async sendUserMessage(sessionId, text) {
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error('这次对话不存在。');
    if (session.archived) throw new Error('这次对话已经归档了。');
    if (this.busy.has(sessionId)) throw new Error('管理员还在说话，等一句说完。');
    const content = String(text || '').trim();
    if (!content) throw new Error('说点什么再发。');
    if (content.length > 4000) throw new Error('一次最多 4000 字。');
    const message = {
      id: this.store.newId('msg'),
      role: 'user',
      content,
      ts: Date.now(),
    };
    this.appendMessage(session, message);
    return message;
  }

  // ---------- free chat with the manager (multi-thread) ----------
  freeChatState() {
    const chat = this.store.getFreeChat();
    return {
      ...chat,
      busy: this.freeChatBusy,
      dailyChatEnabled: this.store.config.dailyChatEnabled !== false,
      dailyChatTime: this.store.config.dailyChatTime || '22:00',
    };
  }

  freeThreads() {
    return this.store.listThreadSummaries();
  }

  freeSelectThread(threadId) {
    this.store.setActiveThread(threadId);
    return this.freeChatState();
  }

  freeNewThread(title) {
    const thread = this.store.createThread({ title: title || undefined, origin: 'manual' });
    return { id: thread.id, state: this.freeChatState() };
  }

  freeRenameThread(threadId, title) {
    return this.store.renameThread(threadId, title);
  }

  freeDeleteThread(threadId) {
    if (this.freeChatBusy && this.freeChatThreadId === threadId) this.stopFreeChat(threadId);
    this.store.deleteThread(threadId);
    return { state: this.freeChatState() };
  }

  collectionDigest() {
    const items = this.store.listItems();
    const counts = this.counts();
    const lines = [];
    lines.push(`已拥有 ${counts.owned} 件，待补款 ${counts.pending} 件，观望中 ${counts.watching} 件。`);
    if (!items.length) {
      lines.push('收藏室目前是空的。');
      return lines.join('\n');
    }
    for (const item of items.slice(0, 12)) {
      const statusText = item.status === 'owned' ? '已拥有' : item.status === 'pending' ? '待补款' : '观望中';
      const price = item.status === 'pending'
        ? `尾款 ${moneyLabel(item.balance)}${item.dueDate ? `，补款 ${dateLabel(item.dueDate)}` : ''}`
        : `价格 ${moneyLabel(item.purchasePrice ?? item.originalPrice)}`;
      const character = this.characterFor(item);
      const roleText = character ? `，角色 ${character.name}` : '';
      const photoLabels = (item.photos || []).map((p) => SHOT_LABELS[p.shot] || '照片').slice(0, 8).join('/');
      lines.push(`- ${item.name}（${TYPE_LABELS[item.type] || '周边'}${roleText}，${statusText}，${price}）照片：${photoLabels || '无'}`);
    }
    const intros = items.filter((i) => i.detail || i.thought).slice(0, 3);
    for (const item of intros) {
      if (item.detail) lines.push(`· ${item.name} 的商品详情：${truncate(item.detail, 160)}`);
      if (item.thought) lines.push(`· ${item.name} 的最初想法：${truncate(item.thought, 160)}`);
    }
    return lines.join('\n');
  }

  characterDigest() {
    const characters = this.store.listCharacters();
    if (!characters.length) return '';
    const items = this.store.listItems();
    const lines = characters.slice(0, 16).map((character) => {
      const related = items.filter((i) => i.characterId === character.id);
      const bits = [`- ${character.name}`];
      if (character.source) bits.push(`出自《${character.source}》`);
      bits.push(related.length ? `收藏室里 ${related.length} 款周边` : '还没有关联的周边');
      if (character.description) bits.push(truncate(character.description.replace(/\s+/g, ' '), 180));
      return bits.join('，');
    });
    if (characters.length > 16) lines.push(`- ……还有 ${characters.length - 16} 个角色档案。`);
    return lines.join('\n');
  }

  buildFreeChatSystemPrompt(thread) {
    const name = this.userName();
    const parts = [];
    this.pushPart(parts, this.prompt('persona', { name }));
    this.pushPart(parts, this.prompt('freechat.scene', { date: dateLabel(this.today()), name }));
    this.pushPart(parts, this.prompt('freechat.collectionBlock', { digest: this.collectionDigest(), name }));
    const characterDigest = this.characterDigest();
    if (characterDigest) {
      this.pushPart(parts, this.prompt('freechat.characterBlock', { digest: characterDigest, name }));
    }
    if (thread?.itemId) {
      const item = this.store.getItem(thread.itemId);
      if (item) {
        this.pushPart(parts, this.prompt('freechat.itemBlock', { context: this.itemContext(item), name }));
        const character = this.characterFor(item);
        if (character) {
          this.pushPart(parts, this.prompt('ritual.characterBlock', {
            context: this.characterContext(character),
            name,
          }));
        }
      }
    }
    this.pushPart(parts, this.prompt('freechat.memoryBlock', {
      digest: this.memoryDigest(thread?.itemId || null, null),
      name,
    }));
    this.pushPart(parts, this.prompt('freechat.tools', { name }));
    this.pushPart(parts, this.prompt('freechat.output', { name }));
    return parts.join('\n\n');
  }

  buildFreeChatMessages(thread, openingInstruction, photoAccess) {
    const name = this.userName();
    const history = (thread.messages || []).slice(-40);
    const system = this.buildFreeChatSystemPrompt(thread);
    const messages = [{ role: 'system', content: photoAccess ? `${system}\n\n${photoAccess.instructions}` : system }];
    for (const m of history) {
      messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
    }
    if (openingInstruction) {
      const note = photoAccess ? this.prompt('freechat.photoNote', { names: photoAccess.names }) : '';
      messages.push({
        role: 'user',
        content: note ? `${openingInstruction}\n\n${note}` : openingInstruction,
      });
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
        messages.push({
          role: 'user',
          content: this.prompt('freechat.openingDaily', { name }),
        });
      }
    }
    return messages;
  }

  async sendFreeChatUserMessage(text, threadId) {
    if (this.freeChatBusy) throw new Error('管理员还在说话，等一句说完。');
    const content = String(text || '').trim();
    if (!content) throw new Error('说点什么再发。');
    if (content.length > 4000) throw new Error('一次最多 4000 字。');
    const thread = threadId ? this.store.getThread(threadId) : this.store.ensureActiveThread();
    if (!thread) throw new Error('这个对话不在了。');
    const message = {
      id: this.store.newId('msg'),
      role: 'user',
      content,
      ts: Date.now(),
    };
    const updated = this.store.appendThreadMessage(thread.id, message);
    this.sendEvent({ type: 'free:threads', threads: this.store.listThreadSummaries(), threadId: thread.id, channel: 'freechat' });
    return { message, threadId: updated.id };
  }

  stopFreeChat(threadId) {
    if (threadId && this.freeChatThreadId && threadId !== this.freeChatThreadId) return;
    try { this.freeChatController?.abort(); } catch {}
  }

  async generateFreeChat({ openingInstruction, proactive = false, threadId } = {}) {
    if (this.freeChatBusy) return null;
    const thread = threadId ? this.store.getThread(threadId) : this.store.ensureActiveThread();
    if (!thread) throw new Error('这个对话不在了。');
    const last = thread.messages[thread.messages.length - 1];
    if (!openingInstruction && last?.role === 'assistant') return null;

    const apiKey = this.store.getApiKey();
    const config = { ...this.store.config };
    if (!apiKey) {
      const err = new ApiError('missing key', { code: 'NO_KEY' });
      this.sendEvent({ type: 'chat:error', sessionId: thread.id, channel: 'freechat', message: friendlyError(err) });
      throw err;
    }

    this.freeChatBusy = true;
    this.freeChatThreadId = thread.id;
    const controller = new AbortController();
    this.freeChatController = controller;
    const sessionId = thread.id;
    const eventBase = { sessionId, threadId, channel: 'freechat' };
    this.sendEvent({ type: 'chat:start', ...eventBase, proactive });
    let full = '';
    let reasoning = '';
    const toolTrace = [];
    const item = thread.itemId ? this.store.getItem(thread.itemId) : null;
    const photoAccess = this.photoAccess(item, thread.messages);
    const working = this.buildFreeChatMessages(thread, openingInstruction, photoAccess);
    const tools = photoAccess ? [...MEMORY_TOOLS, VIEW_ITEM_PHOTOS] : MEMORY_TOOLS;

    try {
      for (let round = 0; round < 4; round += 1) {
        const result = await streamChat({
          config,
          apiKey,
          messages: working,
          tools: round < 3 ? tools : undefined,
          signal: controller.signal,
          onDelta: (text) => {
            full += text;
            this.sendEvent({ type: 'chat:delta', ...eventBase, text });
          },
          onReasoning: (text) => {
            reasoning += text;
            this.sendEvent({ type: 'chat:reasoning', ...eventBase, text });
          },
        });

        if (result.toolCalls?.length) {
          const assistantToolMessage = {
            role: 'assistant',
            content: result.content || null,
            ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
            tool_calls: result.toolCalls.map((tc, i) => ({
              id: tc.id || `free_call_${round}_${i}`,
              type: 'function',
              function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '{}' },
            })),
          };
          if (result.content) {
            full = result.content;
            this.sendEvent({ type: 'chat:reset', ...eventBase, text: full });
          }
          working.push(assistantToolMessage);
          for (const tc of assistantToolMessage.tool_calls) {
            let args = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
            this.sendEvent({ type: 'chat:tool', ...eventBase, name: tc.function.name, args, status: 'running' });
            let toolResult;
            let photoResult;
            try {
              if (tc.function.name === VIEW_ITEM_PHOTOS.function.name) photoResult = photoAccess?.view(args);
              toolResult = photoResult?.result ?? this.executeTool(tc.function.name, args);
            } catch (err) {
              toolResult = { error: err?.message || '工具执行失败' };
            }
            const text = JSON.stringify(toolResult);
            toolTrace.push({ name: tc.function.name, args, result: truncate(text, 500) });
            this.sendEvent({
              type: 'chat:tool', ...eventBase, name: tc.function.name, args,
              status: 'done', preview: truncate(text, 160),
            });
            working.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: photoResult?.content ?? (tc.function.name === 'read_item' ? text : truncate(text, 12000)),
            });
          }
          const images = photoAccess?.takeImageMessage();
          if (images) working.push(images);
          full = '';
          reasoning = '';
          continue;
        }

        full = result.content || full;
        break;
      }

      const text = full.trim();
      if (!text) throw new Error('没有收到回复内容，请重试。');
      const message = {
        id: this.store.newId('msg'),
        role: 'assistant',
        content: text,
        ts: Date.now(),
        reasoning: reasoning ? truncate(reasoning, 6000) : '',
        toolTrace: toolTrace.length ? toolTrace : undefined,
        viewedPhotoIds: photoAccess?.viewedIds.size ? [...photoAccess.viewedIds] : undefined,
      };
      const appended = this.store.appendThreadMessage(thread.id, message);
      if (!appended) {
        this.sendEvent({ type: 'chat:stopped', ...eventBase });
        return null;
      }
      this.sendEvent({
        type: 'chat:done', ...eventBase, message, proactive,
        threads: this.store.listThreadSummaries(),
      });
      return message;
    } catch (err) {
      if (controller.signal.aborted) {
        this.sendEvent({ type: 'chat:stopped', ...eventBase });
      } else {
        this.sendEvent({ type: 'chat:error', ...eventBase, message: friendlyError(err) });
      }
      throw err;
    } finally {
      this.freeChatBusy = false;
      this.freeChatController = null;
      this.freeChatThreadId = null;
    }
  }

  /**
   * 新增 / 编辑藏品后，让管理员主动开一段关于这款藏品的对话。
   * mode = 'create' 时介绍新入库的藏品；'update' 时针对前后差异开口。
   */
  async itemIntro({ itemId, mode = 'create', changes = [] } = {}) {
    const item = this.store.getItem(itemId);
    if (!item) throw new Error('这款周边已经被删除了。');
    if (!this.store.getApiKey()) return { skipped: 'no-key' };
    if (!isVisionReady(this.store.config)) return { skipped: 'vision-model' };
    if (this.freeChatBusy) return { skipped: 'busy' };

    const name = this.userName();
    const titleBase = mode === 'update' ? '藏品变化' : '新藏品';
    const title = `${titleBase} · ${item.name}`.slice(0, 40);
    const thread = this.store.createThread({ title, origin: 'item', itemId: item.id });
    const context = this.itemContext(item);
    const character = this.characterFor(item);
    const characterBlock = character
      ? this.prompt('ritual.characterBlock', { context: this.characterContext(character), name })
      : '';
    let instruction;
    if (mode === 'update') {
      const list = (Array.isArray(changes) ? changes : [])
        .filter((c) => c && c.label)
        .slice(0, 20)
        .map((c) => `· ${c.label}：${String(c.before || '（空）')} → ${String(c.after || '（空）')}`);
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
    if (characterBlock.trim()) instruction = `${instruction}\n\n${characterBlock}`;
    this.generateFreeChat({ openingInstruction: instruction, threadId: thread.id, proactive: true }).catch(() => {});
    return { threadId: thread.id, started: true };
  }

  async maybeProactiveFreeChat(force = false, threadId) {
    const config = this.store.config;
    if (!force && config.dailyChatEnabled === false) return { skipped: true, reason: 'disabled' };
    if (!this.store.getApiKey()) return { skipped: true, reason: 'no-key' };
    if (!force && !isVisionReady(config)) return { skipped: true, reason: 'vision-model' };
    assertVisionReady(config);
    const now = Date.now();
    const day = this.today();
    const chat = this.store.getFreeChat();
    if (!force) {
      if (chat.lastProactiveDay === day) return { skipped: true, reason: 'done' };
      const time = String(config.dailyChatTime || '22:00');
      const [hh, mm] = time.split(':').map((n) => Number(n) || 0);
      const date = new Date();
      if (date.getHours() * 60 + date.getMinutes() < hh * 60 + mm) {
        return { skipped: true, reason: 'not-due' };
      }
      const last = chat.lastMessage;
      if (last && now - last.ts < 30 * 60 * 1000) {
        this.store.putFreeChat({ lastProactiveDay: day });
        return { skipped: true, reason: 'recent-chat' };
      }
      if (chat.lastAttemptAt && now - chat.lastAttemptAt < 10 * 60 * 1000) {
        return { skipped: true, reason: 'cooldown' };
      }
    }
    if (this.freeChatBusy) return { skipped: true, reason: 'busy' };

    const name = this.userName();
    const instruction = this.prompt('freechat.proactive', {
      time: config.dailyChatTime || '22:00',
      name,
    });
    try {
      const message = await this.generateFreeChat({ openingInstruction: instruction, proactive: true, threadId });
      if (!message) return { skipped: true, reason: 'empty' };
      const patch = { lastAttemptAt: Date.now() };
      if (!force) {
        patch.lastProactiveDay = day;
        patch.lastProactiveAt = Date.now();
      }
      this.store.putFreeChat(patch);
      return { message, threadId: this.store.getFreeChat().activeId };
    } catch (err) {
      this.store.putFreeChat({ lastAttemptAt: Date.now() });
      throw err;
    }
  }

  // ---------- tools ----------
  executeTool(name, args) {
    const sessions = this.store.listSessions();
    const items = this.store.listItems();

    if (name === 'search_memory' || name === 'read_memory') {
      const context = {
        getItemName: (itemId) => itemId ? this.store.getItem(itemId)?.name : undefined,
        phaseLabel: (phase) => PHASE_META[phase]?.label || phase,
        dateKey: localDateKey,
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
      list.sort((a, b) => String(b.day).localeCompare(String(a.day)) || (b.startedAt - a.startedAt));
      return {
        events: list.slice(0, limit).map((s) => ({
          sessionId: s.id,
          date: s.day,
          phase: PHASE_META[s.phase]?.label || s.phase,
          itemName: s.itemName,
          summary: truncate(s.summary, 200),
          outcome: s.outcome,
        })),
        total: list.length,
      };
    }

    if (name === 'read_item') {
      const item = items.find((i) => i.id === args.item_id);
      if (!item) return { error: '没有这款周边' };
      const itemSessions = sessions
        .filter((s) => s.itemId === item.id && s.archived)
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      return {
        item: {
          id: item.id,
          name: item.name,
          type: TYPE_LABELS[item.type] || item.type,
          status: item.status,
          characterId: item.characterId || null,
          character: (() => { const ch = this.characterFor(item); return ch ? { id: ch.id, name: ch.name, source: ch.source, description: truncate(ch.description, 600) } : null; })(),
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
          createdAt: item.createdAt,
        },
        history: itemSessions.slice(0, 10).map((s) => ({
          sessionId: s.id,
          date: s.day,
          phase: PHASE_META[s.phase]?.label || s.phase,
          summary: truncate(s.summary, 260),
        })),
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
        counts: {
          owned: items.filter((i) => i.status === 'owned').length,
          pending: items.filter((i) => i.status === 'pending').length,
          watching: items.filter((i) => i.status === 'watching').length,
        },
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
      const character = this.store.getCharacter(args.character_id);
      if (!character) return { error: '没有这个角色档案' };
      const related = items.filter((i) => i.characterId === character.id);
      const events = sessions
        .filter((s) => s.archived && related.some((i) => i.id === s.itemId))
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
        .slice(0, 12)
        .map((s) => ({
          sessionId: s.id,
          date: s.day,
          phase: PHASE_META[s.phase]?.label || s.phase,
          itemName: s.itemName,
          summary: truncate(s.summary, 220),
        }));
      return {
        characterId: character.id,
        name: character.name,
        source: character.source,
        description: character.description,
        items: related.map((i) => ({
          id: i.id,
          name: i.name,
          type: TYPE_LABELS[i.type] || i.type,
          status: i.status,
          detail: truncate(i.detail, 300),
          thought: truncate(i.thought, 300),
        })),
        history: events,
      };
    }

    return { error: `未知工具 ${name}` };
  }

  // ---------- summaries & finishing ----------
  fallbackSummary(session) {
    const msgs = session.messages || [];
    const firstAssistant = msgs.find((m) => m.role === 'assistant')?.content || '';
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')?.content || '';
    const bits = [firstAssistant, lastUser].filter(Boolean).map((t) => truncate(t.replace(/\s+/g, ' '), 90));
    return bits.length ? truncate(bits.join(' / '), 220) : '（这次没有留下太多话。）';
  }

  async summarizeSession(session) {
    const apiKey = this.store.getApiKey();
    if (!apiKey) return this.fallbackSummary(session);
    const transcript = (session.messages || [])
      .map((m) => `${m.role === 'user' ? this.userName() : '你'}：${m.content}`)
      .join('\n');
    if (!transcript.trim()) return this.fallbackSummary(session);
    try {
      const text = await completeText({
        config: this.store.config,
        apiKey,
        messages: [
          {
            role: 'system',
            content: this.prompt('summary.system', {}),
          },
          {
            role: 'user',
            content: `日期：${session.day}\n周边：${session.itemName}\n阶段：${PHASE_META[session.phase]?.label || session.phase}\n\n${truncate(transcript, 9000)}`,
          },
        ],
        maxTokens: 320,
        temperature: 0.5,
        signal: AbortSignal.timeout(45000),
      });
      const cleaned = String(text || '').trim();
      if (cleaned) return truncate(cleaned, 500);
    } catch {}
    return this.fallbackSummary(session);
  }

  updateItemAfterPhase(item, phase, now) {
    if (!item) return;
    const patches = {};
    if (phase === 'wipe') patches.lastWipedAt = now;
    if (phase === 'fantasy') patches.lastFantasyAt = now;
    if (phase === 'instigate') patches.lastInstigatedAt = now;
    const fresh = this.store.getItem(item.id);
    if (!fresh) return;
    Object.assign(fresh, patches, { updatedAt: now });
    this.store.upsertItem(fresh);
  }

  async finishPhase(day = this.today(), sessionId) {
    const record = this.store.getDaily(day);
    if (!record) throw new Error('今天还没有开始上贡。');
    if (record.status === 'complete') return { state: this.hydrate(record, day), complete: true };

    const { phase, prec } = this.findPhaseBySession(record, sessionId);
    if (!phase) throw new Error('找不到这次对话对应的阶段。');
    if (prec.status !== 'active') throw new Error('这个阶段已经结束了。');

    const session = this.store.getSession(sessionId);
    if (!session) throw new Error('这次对话不存在。');
    this.stop(sessionId);

    // A short pause can let a summary run; it is allowed to finish an empty chat too.
    const summary = await this.summarizeSession(session);
    session.summary = summary;
    session.archived = true;
    session.endedAt = Date.now();
    if (!session.outcome) session.outcome = { done: true };
    this.store.putSession(session);

    prec.status = 'done';
    prec.endedAt = Date.now();
    prec.summary = summary;
    const item = this.store.getItem(session.itemId);
    this.updateItemAfterPhase(item, phase, Date.now());

    this.advancePointer(record);
    this.normalize(record);
    this.store.putDaily(record);
    return { state: this.hydrate(record, day), summary };
  }

  async applyInstigate(day, sessionId, { ordered, targetStatus }) {
    const record = this.store.getDaily(day);
    if (!record) throw new Error('今天还没有开始上贡。');
    const { phase, prec } = this.findPhaseBySession(record, sessionId);
    if (phase !== 'instigate') throw new Error('只有教唆阶段可以下单。');
    if (prec.status !== 'active') throw new Error('这个阶段已经结束了。');

    const session = this.store.getSession(sessionId);
    if (!session) throw new Error('这次对话不存在。');
    const item = this.store.getItem(session.itemId);

    if (ordered) {
      if (!item) throw new Error('这款周边已经被删除了。');
      if (!['pending', 'owned'].includes(targetStatus)) throw new Error('目标状态不对。');
      const now = Date.now();
      item.status = targetStatus;
      item.updatedAt = now;
      item.statusHistory = Array.isArray(item.statusHistory) ? item.statusHistory : [];
      item.statusHistory.push({ from: 'watching', to: targetStatus, at: now, via: 'ritual' });
      if (targetStatus === 'owned' && item.type === 'figure') {
        const hasFull = (item.photos || []).some((p) => p.shot === 'full');
        if (!hasFull) item.needsFullBodyPhoto = true;
      }
      this.store.upsertItem(item);
      session.outcome = { ordered: true, from: 'watching', to: targetStatus };
    } else {
      session.outcome = { ordered: false, from: 'watching' };
    }
    this.store.putSession(session);
    const result = await this.finishPhase(day, sessionId);
    return { ...result, outcome: session.outcome };
  }

  // ---------- calendar / memory ----------
  calendar(year, month) {
    const prefix = `${year}-${pad2(month)}`;
    const days = {};
    for (const rec of this.store.listDaily()) {
      if (!rec.date.startsWith(prefix)) continue;
      const sessions = Object.values(rec.phases || {})
        .map((p) => (p.sessionId ? this.store.getSession(p.sessionId) : null))
        .filter(Boolean);
      days[rec.date] = {
        date: rec.date,
        status: rec.status,
        completedAt: rec.completedAt,
        sessions: sessions.map((s) => ({
          id: s.id,
          itemId: s.itemId,
          itemName: s.itemName,
          phase: s.phase,
          summary: s.summary,
          archived: s.archived,
          outcome: s.outcome,
          startedAt: s.startedAt,
        })),
        hasRitual: Boolean(rec.completedAt),
      };
    }
    return days;
  }

  dayDetail(date) {
    const rec = this.store.getDaily(date);
    const sessions = this.store.listSessions().filter((s) => s.day === date);
    return {
      day: date,
      record: rec,
      sessions,
      counts: this.counts(),
    };
  }

  memoryOverview() {
    const sessions = this.store.listSessions();
    const items = this.store.listItems();
    return {
      sessions,
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        status: i.status,
        type: i.type,
        cover: (i.photos || [])[0]?.file || null,
      })),
      stats: {
        sessions: sessions.filter((s) => s.archived).length,
        days: Object.values(this.store.daily).filter((d) => d.completedAt).length,
        items: items.length,
      },
    };
  }
}

module.exports = {
  RitualService,
  PHASES,
  PHASE_META,
  SHOT_LABELS,
  TYPE_LABELS,
  localDateKey,
  dateLabel,
};


