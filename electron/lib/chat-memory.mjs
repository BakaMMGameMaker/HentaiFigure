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
  const transcript = messages.map((message) => `${message.role === 'user' ? userName : '管理员'}：${message.content}`).join('\n');
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
