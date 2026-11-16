'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { RitualService } = require('../electron/lib/ritual.cjs');
const { Store } = require('../electron/lib/store.cjs');

function testStore(t) {
  const root = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(root, 'hf-daily-chat-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(dir)), root);
    fs.rmSync(dir, { recursive: true });
  });
  const store = new Store(dir);
  store.updateConfig({ apiKey: 'test-key' });
  return store;
}

const at = (day, hours, minutes = 0) => new Date(2026, 10, day, hours, minutes).getTime();
const reply = () => Response.json({ choices: [{ message: { content: '测试主动话题。' } }] });

test('修改为零点后从次日生效，定时话题单独保存', async (t) => {
  let now = at(15, 21, 35);
  t.mock.method(Date, 'now', () => now);
  const fetch = t.mock.method(globalThis, 'fetch', async () => reply());
  const store = testStore(t);
  const oldThread = store.createThread({ title: '已有藏品对话', origin: 'item', itemId: 'item-1' });
  store.appendThreadMessage(oldThread.id, { id: 'old', role: 'assistant', content: '旧消息', ts: at(15, 18) });
  store.updateConfig({ dailyChatTime: '00:00' });

  now = at(15, 21, 36);
  store.updateConfig({ dailyChatTime: '00:00', userName: '测试' });
  const reopened = new Store(store.root);
  const events = [];
  const service = new RitualService({ store: reopened, sendEvent: (event) => events.push(event) });
  assert.equal(reopened.config.dailyChatScheduleChangedAt, at(15, 21, 35));
  assert.equal((await service.maybeProactiveFreeChat()).reason, 'not-due');
  now = at(15, 23, 59);
  assert.equal((await service.maybeProactiveFreeChat()).reason, 'not-due');
  assert.equal(fetch.mock.callCount(), 0);

  now = at(16, 0);
  const result = await service.maybeProactiveFreeChat();
  assert.notEqual(result.threadId, oldThread.id);
  const saved = new Store(store.root);
  const newThread = saved.getThread(result.threadId);
  assert.equal(newThread.origin, 'daily');
  assert.equal(newThread.itemId, null);
  assert.deepEqual(newThread.messages.map((message) => message.id), [result.message.id]);
  assert.equal(newThread.messages[0].content, result.message.content);
  assert.equal(saved.getThread(oldThread.id).messages.length, 1);
  assert.equal(saved.getActiveThread().id, oldThread.id);
  assert.equal(saved.getFreeChat().lastProactiveAt, result.message.ts);
  const restarted = new RitualService({ store: saved, sendEvent: () => {} });
  assert.equal((await restarted.freeChatLog.list(result.threadId))[0].status, 'done');
  assert.equal(events.find(({ type }) => type === 'chat:done').threadId, newThread.id);
  assert.equal((await service.maybeProactiveFreeChat()).reason, 'done');
  assert.equal(fetch.mock.callCount(), 1);
});

test('错过当天时间可补发，生成失败可重试，改时间会丢弃旧任务的回复', async (t) => {
  let now = at(15, 22, 20);
  t.mock.method(Date, 'now', () => now);
  const pending = Promise.withResolvers();
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 500 }));
  const store = testStore(t);
  const service = new RitualService({ store, sendEvent: () => {} });

  await assert.rejects(service.maybeProactiveFreeChat(), /HTTP 500/);
  assert.equal(store.listThreadSummaries().length, 0);
  assert.equal((await service.maybeProactiveFreeChat()).reason, 'cooldown');
  now = at(15, 22, 31);
  fetch.mock.mockImplementation(() => pending.promise);
  const running = service.maybeProactiveFreeChat();
  assert.equal((await service.maybeProactiveFreeChat()).reason, 'busy');
  store.updateConfig({ dailyChatTime: '00:00' });
  pending.resolve(reply());
  assert.ok((await running).skipped);
  assert.equal(store.listThreadSummaries().length, 0);
  assert.equal(store.getFreeChat().lastProactiveDay, null);

  fetch.mock.mockImplementation(async () => reply());
  now = at(16, 8);
  assert.ok((await service.maybeProactiveFreeChat()).message);
  assert.equal(store.getFreeChat().lastProactiveDay, '2026-11-16');
});

test('藏品开场只发送当前藏品资料，收藏室和相关记忆按工具查询', { timeout: 3000 }, async (t) => {
  const store = testStore(t);
  const character = store.upsertCharacter({ name: '测试角色（全名）', description: '仅查询才返回的角色背景' });
  const focus = store.upsertItem({
    id: 'focus', name: '当前手办', characterId: character.id, type: 'figure', status: 'owned', detail: '当前手办详情',
    photos: [
      { id: 'ph_promo_later', file: 'promo-later.jpg', shot: 'promo', createdAt: 30 },
      { id: 'ph_focus', file: 'focus.jpg', shot: 'full', caption: '正面展示', createdAt: 10 },
      { id: 'ph_promo_earlier', file: 'promo-earlier.jpg', shot: 'promo', createdAt: 20 },
    ],
  });
  const related = store.upsertItem({
    id: 'related', name: '同角色挂件', characterId: character.id, type: 'other', status: 'pending', photos: [],
  });
  const other = store.upsertItem({
    id: 'other', name: '无关藏品', type: 'other', status: 'watching', thought: '无关藏品的最初想法', photos: [],
  });
  store.putSession({
    id: 'ritual-memory', itemId: related.id, itemName: related.name, phase: 'wipe',
    day: '2026-11-13', startedAt: at(13, 19), endedAt: at(13, 20), archived: true,
    summary: '旧上贡摘要', messages: [],
  });
  const manual = store.createThread({ title: '日常聊天' });
  store.appendThreadMessage(manual.id, { id: 'manual-1', role: 'user', content: `聊聊${related.name}`, ts: at(14, 20) });
  store.appendThreadMessage(manual.id, { id: 'manual-2', role: 'user', content: '换一个话题', ts: at(16, 21) });
  const bound = store.createThread({ title: '藏品聊天', origin: 'item', itemId: other.id });
  store.appendThreadMessage(bound.id, { id: 'bound-1', role: 'assistant', content: '当时聊的是绑定的藏品。', ts: at(15, 20) });

  const toolNames = ['get_collection_counts', 'list_recent_items', 'read_character', 'list_collection'];
  const toolCalls = toolNames.map((name) => ({
    id: name, type: 'function', function: { name, arguments: '{}' },
  }));
  let rounds = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async () => ++rounds === 1
    ? Response.json({ choices: [{
      message: { content: '先查查收藏室。', reasoning_content: '准备查询藏品。', tool_calls: toolCalls },
      finish_reason: 'tool_calls',
    }] })
    : reply());
  const done = Promise.withResolvers();
  const service = new RitualService({
    store,
    sendEvent: (event) => {
      if (event.type === 'chat:done') done.resolve(event);
      if (event.type === 'chat:error') done.reject(new Error(event.message));
    },
  });
  const intro = await service.itemIntro({ itemId: focus.id });
  assert.equal((await done.promise).threadId, intro.threadId);

  const [first, second] = fetch.mock.calls.map(({ arguments: [, options] }) => JSON.parse(options.body));
  const firstContext = first.messages.map(({ content }) => content).join('\n');
  assert.equal(firstContext.match(/当前手办详情/g)?.length, 1);
  assert.ok(first.messages[0].content.includes([
    '【当前藏品的照片清单】（括号内为用户的图片备注）',
    'ph_promo_earlier：宣传图',
    'ph_promo_later：宣传图',
    'ph_focus：全身照（正面展示）',
  ].join('\n')));
  assert.equal(firstContext.match(/正面展示/g)?.length, 1);
  assert.doesNotMatch(firstContext, /照片共 \d+ 张/);
  assert.ok(first.tools.some((tool) => tool.function.name === 'view_item_photos'));
  assert.doesNotMatch(firstContext, /无关藏品|同角色挂件|旧上贡摘要|仅查询才返回的角色背景/);
  for (const name of toolNames) assert.ok(first.tools.some((tool) => tool.function.name === name), name);
  assert.equal(fetch.mock.callCount(), 2);

  const results = Object.fromEntries(second.messages.filter(({ role }) => role === 'tool')
    .map(({ tool_call_id, content }) => [tool_call_id, JSON.parse(content)]));
  assert.deepEqual(results.get_collection_counts, { owned: 1, pending: 1, watching: 1, total: 3 });
  assert.deepEqual(results.list_recent_items.items, [
    { id: other.id, name: other.name, kind: 'freechat', date: '2026-11-15' },
    { id: related.id, name: related.name, kind: 'freechat', date: '2026-11-14' },
  ]);
  const profile = results.read_character;
  assert.equal(profile.characterId, character.id);
  assert.equal(profile.currentItemId, focus.id);
  assert.deepEqual(profile.items.map(({ id }) => id).sort(), [focus.id, related.id].sort());
  assert.deepEqual(profile.history.map(({ sessionId, kind }) => [sessionId, kind]), [
    [manual.id, 'freechat'], ['ritual-memory', 'ritual'],
  ]);
  assert.match(service.executeTool('read_memory', { session_id: manual.id }).transcript, /聊聊同角色挂件/);
  assert.equal(service.executeTool('read_character', { character_name: '测试角色' }).characterId, character.id);
  assert.equal(results.list_collection.total, 3);

  const restarted = new RitualService({ store: new Store(store.root), sendEvent: () => {} });
  const [savedLog] = await restarted.freeChatLog.list(intro.threadId);
  assert.equal(savedLog.status, 'done');
  assert.deepEqual(savedLog.rounds.map(({ request }) => request), [first, second]);
  assert.deepEqual(savedLog.rounds[0].calls.map(({ name, result }) => [name, JSON.parse(result)]), Object.entries(results));
  assert.deepEqual(savedLog.rounds.map(({ response }) => response), [
    { content: '先查查收藏室。', reasoning: '准备查询藏品。' },
    { content: '测试主动话题。', reasoning: '' },
  ]);
});

test('重启保留全部对话日志，删除对话会清理日志且迟到的请求不会写回', async (t) => {
  const store = testStore(t);
  const service = new RitualService({ store, sendEvent: () => {} });
  const deleted = store.createThread({ title: '将删除的对话' });
  const kept = store.createThread({ title: '保留的对话' });
  const payload = {
    model: 'test',
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abcd' } }] }],
  };
  const first = service.freeChatLog.start(kept.id);
  first.request(payload);
  await first.finish('done');
  for (let i = 0; i < 30; i += 1) await service.freeChatLog.start(kept.id).finish('done');
  const interrupted = service.freeChatLog.start(deleted.id);
  interrupted.request(payload);

  const reopened = new Store(store.root);
  const restarted = new RitualService({ store: reopened, sendEvent: () => {} });
  const logs = await restarted.freeChatLog.list(kept.id);
  assert.equal(logs.length, 31);
  const image = logs.find(({ rounds }) => rounds.length).rounds[0].request.messages[0].content[0].image_url;
  assert.equal(image.url, 'data:image/jpeg;base64,[图片数据，4 字符]');
  assert.equal((await restarted.freeChatLog.list(deleted.id))[0].status, 'stopped');

  const pending = Promise.withResolvers();
  t.mock.method(globalThis, 'fetch', () => pending.promise);
  const running = restarted.generateFreeChat({ threadId: deleted.id });
  assert.ok((await restarted.freeChatLog.list(deleted.id)).some(({ status }) => status === 'running'));
  restarted.freeDeleteThread(deleted.id);
  pending.resolve(reply());
  assert.equal(await running, null);

  const saved = new Store(store.root);
  assert.equal(saved.getThread(deleted.id), null);
  assert.equal(fs.existsSync(saved.freeChatLogPath(deleted.id)), false);
  assert.equal(saved.listFreeChatLogs(kept.id).length, 31);
});
