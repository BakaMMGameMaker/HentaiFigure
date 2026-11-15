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
