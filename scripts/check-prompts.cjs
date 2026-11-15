'use strict';

// 临时冒烟测试：验证提示词注册表、用户覆盖层、开发人员模式写回。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const promptLib = require(path.join(ROOT, 'electron/lib/prompts.cjs'));
const { Store } = require(path.join(ROOT, 'electron/lib/store.cjs'));
const { RitualService } = require(path.join(ROOT, 'electron/lib/ritual.cjs'));

const defaultsFile = promptLib.DEFAULTS_PATH;
const backup = fs.readFileSync(defaultsFile, 'utf8');

function tmpStore(options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-prompt-'));
  return { dir, store: new Store(dir, options) };
}

try {
  const { store } = tmpStore({ defaultsWritable: false });

  // 1. 默认值来自 JSON
  const values = store.promptValues();
  assert.strictEqual(values.persona, promptLib.get('persona'));
  assert.ok(values.persona.includes('收藏室的女管理员'));
  assert.ok(values['ritual.phaseWipe'].includes('【当前阶段：擦拭】'));

  // 2. 人格走覆盖层
  let pub = store.updateConfig({ systemPrompt: '这是我的自定义人格。' });
  assert.strictEqual(pub.prompts.overrides.persona, '这是我的自定义人格。');
  assert.strictEqual(pub.systemPrompt, '这是我的自定义人格。');
  pub = store.updateConfig({ systemPrompt: promptLib.get('persona') });
  assert.strictEqual(pub.prompts.overrides.persona, undefined);
  assert.strictEqual(pub.systemPrompt, promptLib.get('persona'));

  // 3. 覆盖任意一条指令
  pub = store.savePrompts({ prompts: { 'ritual.opening': '自定义开场：{item}' } });
  assert.strictEqual(pub.prompts.resolved['ritual.opening'], '自定义开场：{item}');
  assert.strictEqual(pub.prompts.overrides['ritual.opening'], '自定义开场：{item}');

  // 4. 渲染：只替换提供的变量
  const ritual = new RitualService({ store, sendEvent: () => {} });
  const opening = ritual.prompt('ritual.opening', { item: '测试手办' });
  assert.strictEqual(opening, '自定义开场：测试手办');
  assert.strictEqual(promptLib.render('保留 {unknown} 和 {name}', { name: '非非喵' }), '保留 {unknown} 和 非非喵');

  // 5. system prompt 结构
  const system = ritual.buildSystemPrompt({ item: null, phase: 'wipe', day: '2026-01-01', sessionId: 'ses_test' });
  assert.ok(system.includes('【今日】2026年1月1日'));
  assert.ok(system.includes('【当前阶段：擦拭】'));
  assert.ok(system.includes('【输出要求】'));
  assert.ok(system.includes('（这款周边的资料已经被删除了。）'));

  // 6. 恢复单条 / 全部
  pub = store.savePrompts({ reset: ['ritual.opening'] });
  assert.strictEqual(pub.prompts.overrides['ritual.opening'], undefined);
  assert.strictEqual(pub.prompts.resolved['ritual.opening'], promptLib.get('ritual.opening'));

  // 7. 开发人员模式在只读环境下必须报错
  store.setDevPromptMode(true);
  assert.throws(() => store.savePrompts({ prompts: { 'summary.system': '不应写入' } }), /不能修改系统默认提示词/);
  store.setDevPromptMode(false);

  // 8. 开发人员模式写回默认文件（只在源码目录有效）
  const writable = tmpStore({ defaultsWritable: true }).store;
  writable.setDevPromptMode(true);
  const saved = writable.savePrompts({ prompts: { 'summary.system': '测试默认值' } });
  const onDisk = JSON.parse(fs.readFileSync(defaultsFile, 'utf8'));
  assert.strictEqual(onDisk['summary.system'], '测试默认值');
  assert.strictEqual(saved.prompts.defaults['summary.system'], '测试默认值');
  assert.strictEqual(saved.prompts.overrides['summary.system'], undefined);
  assert.strictEqual(promptLib.get('summary.system'), '测试默认值');
  const reopened = tmpStore({ defaultsWritable: true }).store;
  assert.strictEqual(reopened.promptValues()['summary.system'], '测试默认值');

  console.log('prompt smoke tests: OK');
} finally {
  fs.writeFileSync(defaultsFile, backup, 'utf8');
  console.log('defaults file restored');
}
