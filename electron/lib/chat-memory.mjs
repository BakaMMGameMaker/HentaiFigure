export const MEMORY_LOOKUP_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description: '跨整个收藏室搜索过去的对话，包括上贡和日常聊天，也可以查其他藏品。可按周边名、日期或对话关键词查找。不填关键词时浏览最近的对话。用结果里的 sessionId 调用 read_memory。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', description: '每页 1–10 条，默认 5' },
          offset: { type: 'integer', description: '下一页使用上次返回的 nextOffset' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_memory',
      description: '按 sessionId 读取任意已保存的上贡或日常对话原文。若返回 nextOffset，可以继续读取后续原文。',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          offset: { type: 'integer', description: '下一段使用上次返回的 nextOffset' },
        },
        required: ['session_id'],
      },
    },
  },
];

export const LIST_COLLECTION = {
  type: 'function',
  function: {
    name: 'list_collection',
    description: '在整个收藏室查找周边，返回 ID、状态、价格和补款日。可按名称、角色、作品或类型筛选，用返回的 ID 调用 read_item 获取详情。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        offset: { type: 'integer', description: '下一页使用上次返回的 nextOffset' },
      },
    },
  },
};

export const READ_CHARACTER = {
  type: 'function',
  function: {
    name: 'read_character',
    description: '查看角色档案、同角色的藏品清单和最近相关的上贡与日常聊天。可传角色 ID 或名称，也可省略参数查看当前周边绑定的角色。用 read_item 查藏品详情，用 read_memory 读对话原文。',
    parameters: {
      type: 'object',
      properties: {
        character_id: { type: 'string' },
        character_name: { type: 'string', description: '角色名或能唯一匹配档案的部分名称' },
        offset: { type: 'integer', description: '查看下一页同角色藏品时，使用上次返回的 nextOffset' },
      },
    },
  },
};

export const FREE_CHAT_COLLECTION_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_collection_counts',
      description: '查看收藏室里已拥有、待补款、观望中的藏品数量和总数。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_recent_items',
      description: '按最近聊到的时间列出曾上贡或日常聊过的藏品，只返回去重后的名称、ID、日期和对话类型。',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', description: '返回 1–20 件，默认 8' } },
      },
    },
  },
];

function asOffset(value) {
  return Math.max(0, Math.trunc(Number(value)) || 0);
}

function matches(value, query) {
  return String(value ?? '').toLowerCase().includes(query);
}

function sessionRecord(session, phaseLabel) {
  return {
    sessionId: session.id,
    kind: 'ritual',
    date: session.day,
    phase: phaseLabel(session.phase),
    itemName: session.itemName,
    summary: session.summary,
    outcome: session.outcome,
    timestamp: session.startedAt || 0,
    messages: session.messages || [],
  };
}

function threadRecord(thread, getItemName, dateKey) {
  const date = new Date(thread.updatedAt || thread.createdAt || 0);
  return {
    sessionId: thread.id,
    kind: 'freechat',
    date: dateKey(date),
    title: thread.title,
    itemName: getItemName(thread.itemId),
    timestamp: date.getTime(),
    messages: thread.messages || [],
  };
}

export function searchMemory({ sessions, threads, getItemName, phaseLabel, dateKey, args }) {
  const query = String(args?.query || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(10, Math.trunc(Number(args?.limit)) || 5));
  const offset = asOffset(args?.offset);
  const records = [
    ...sessions.map((session) => sessionRecord(session, phaseLabel)),
    ...threads.map((thread) => threadRecord(thread, getItemName, dateKey)),
  ];
  const ranked = [];
  for (const { messages, outcome, summary, ...record } of records) {
    if (!messages.length && !summary) continue;
    const hit = query && messages.find((message) => matches(message.content, query));
    const score = query
      ? 6 * Number(matches(record.itemName, query) || matches(record.title, query))
        + 4 * Number(matches(summary, query))
        + 3 * Number(matches(record.date, query))
        + 3 * Number(Boolean(hit))
        + 2 * Number(matches(record.phase, query))
      : 1;
    if (!score) continue;
    const content = String((hit || messages[0])?.content || '');
    const start = Math.max(0, content.toLowerCase().indexOf(query) - 60);
    ranked.push({ ...record, score, summary: String(summary || '').slice(0, 220), snippet: content.slice(start, start + 220) });
  }
  ranked.sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)) || b.timestamp - a.timestamp);
  return {
    results: ranked.slice(offset, offset + limit).map(({ score, timestamp, ...result }) => result),
    nextOffset: offset + limit < ranked.length ? offset + limit : null,
  };
}

export function readMemory({ session, thread, getItemName, phaseLabel, dateKey, userName, args }) {
  const record = session ? sessionRecord(session, phaseLabel) : thread && threadRecord(thread, getItemName, dateKey);
  if (!record) return { error: '没有这次对话记录' };
  const { messages, summary, timestamp, ...metadata } = record;
  const transcript = messages.map((message) => {
    const name = message.role === 'user' ? userName : '管理员';
    const attachmentNote = message.images?.length ? `[图片 ${message.images.length} 张] ` : '';
    return `${name}：${attachmentNote}${message.content}`;
  }).join('\n');
  const offset = asOffset(args?.offset);
  const end = offset + 4000;
  return {
    ...metadata,
    summary: String(summary || '').slice(0, 600),
    transcript: transcript.slice(offset, end),
    nextOffset: end < transcript.length ? end : null,
  };
}

export function collectionPage(items, queryText, offsetValue, getSearchFields) {
  const query = String(queryText || '').trim().toLowerCase();
  const offset = asOffset(offsetValue);
  const filtered = query ? items.filter((item) => getSearchFields(item).some((value) => matches(value, query))) : items;
  const end = offset + 20;
  return {
    page: filtered.slice(offset, end),
    total: filtered.length,
    nextOffset: end < filtered.length ? end : null,
  };
}

function latestMention(thread, names) {
  return thread.messages?.findLast((message) => names.some((name) => name && matches(message.content, name)));
}

function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function listRecentItems({ items, sessions, threads, args, dateKey }) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const byName = new Map();
  for (const item of items) {
    const name = normalizeName(item.name);
    if (name) byName.set(name, byName.has(name) ? null : item.id);
  }
  const latest = new Map();
  function record(id, kind, time) {
    const item = byId.get(id);
    if (!item || !time || time <= (latest.get(id)?.time || 0)) return;
    latest.set(id, { id, name: item.name, kind, time });
  }

  for (const session of sessions) {
    if (!session.messages?.length && (!session.archived || session.outcome?.skipped)) continue;
    record(session.itemId, 'ritual', session.endedAt || session.messages?.at(-1)?.ts || session.startedAt);
  }
  for (const thread of threads) {
    const last = thread.messages?.at(-1);
    if (!last) continue;
    const fallbackTime = thread.updatedAt || thread.createdAt;
    record(thread.itemId, 'freechat', last.ts || fallbackTime);
    for (const [name, id] of byName) {
      if (!id || id === thread.itemId) continue;
      const message = latestMention(thread, [name]);
      if (message) record(id, 'freechat', message.ts || fallbackTime);
    }
  }
  const limit = Math.max(1, Math.min(20, Math.trunc(Number(args?.limit)) || 8));
  return {
    items: [...latest.values()]
      .sort((a, b) => b.time - a.time)
      .slice(0, limit)
      .map(({ time, ...item }) => ({ ...item, date: dateKey(new Date(time)) })),
  };
}

export function readCharacter({ characters, items, sessions, threads, currentItem, currentThreadId, args, phaseLabel, dateKey, typeLabel }) {
  const query = normalizeName(args?.character_name);
  const id = args?.character_id;
  let found;
  if (id || !query) {
    found = characters.filter((character) => character.id === (id || currentItem?.characterId));
  } else {
    const exact = characters.filter((character) => normalizeName(character.name) === query);
    found = exact.length ? exact : characters.filter((character) => matches(character.name, query));
  }
  if (!found.length) return { error: '没有找到角色档案。请提供角色名或角色 ID。' };
  if (found.length > 1) {
    return {
      error: '匹配到多个角色，请使用角色 ID。',
      candidates: found.map(({ id, name, source }) => ({ characterId: id, name, source })),
    };
  }
  const [character] = found;
  const related = items.filter((item) => item.characterId === character.id);
  const { page, nextOffset } = collectionPage(related, '', args?.offset);
  const byId = new Map(related.map((item) => [item.id, item]));
  const names = [character.name, ...related.map((item) => item.name)].map(normalizeName);
  const history = sessions
    .filter((session) => session.archived && byId.has(session.itemId))
    .map((session) => ({
      sessionId: session.id,
      kind: 'ritual',
      date: session.day,
      phase: phaseLabel(session.phase),
      itemName: session.itemName,
      summary: String(session.summary || '').slice(0, 220),
      time: session.endedAt || session.startedAt || 0,
    }));
  for (const thread of threads) {
    if (thread.id === currentThreadId || !thread.messages?.length) continue;
    const item = byId.get(thread.itemId);
    const message = item ? thread.messages.at(-1) : latestMention(thread, names);
    if (!message) continue;
    const time = message.ts || thread.updatedAt || thread.createdAt;
    history.push({
      sessionId: thread.id,
      kind: 'freechat',
      date: dateKey(new Date(time)),
      title: thread.title,
      itemName: item?.name,
      snippet: String(message.content || '').slice(0, 220),
      time,
    });
  }
  return {
    characterId: character.id,
    name: character.name,
    source: character.source,
    description: character.description,
    currentItemId: byId.has(currentItem?.id) ? currentItem.id : null,
    items: page.map((item) => ({
      id: item.id,
      name: item.name,
      type: typeLabel(item.type),
      status: item.status,
    })),
    nextOffset,
    history: history.sort((a, b) => b.time - a.time).slice(0, 12).map(({ time, ...entry }) => entry),
  };
}
