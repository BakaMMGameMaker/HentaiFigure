import { useEffect, useState, type ReactNode } from 'react';
import type { AppInfo, Config, PromptBundle, UpdateInfo } from '../types';
import { PROMPT_SCHEMA } from '../prompts';
import { DEFAULT_VISION_MODEL, isDeepSeekEndpoint } from '../../electron/lib/vision-config.mjs';
import { ManagerAvatar, Modal, Row, SheetHeader, Spinner, Switch, confirmDialog } from './ui';
import {
  IconAlert, IconChat, IconCheck, IconCircleCheck, IconClock, IconDownload, IconFolder, IconInfo,
  IconRefresh, IconSettings, IconSparkles, IconStack, IconUpload, IconWallet,
} from '../icons';
import { cleanError, cx } from '../utils';
import appConfig from '../../app-config.json';

type Tab = 'api' | 'persona' | 'prompts' | 'update' | 'data' | 'about';

const TABS: { id: Tab; label: string; title: string; icon: ReactNode }[] = [
  { id: 'api', label: 'API', title: '连接 DeepSeek', icon: <IconSettings size={16} /> },
  { id: 'persona', label: '管理员', title: '管理员的性格', icon: <IconSparkles size={16} /> },
  { id: 'prompts', label: '进阶', title: '进阶设置', icon: <IconStack size={16} /> },
  { id: 'update', label: '更新', title: '检查更新', icon: <IconRefresh size={16} /> },
  { id: 'data', label: '数据', title: '数据与备份', icon: <IconFolder size={16} /> },
  { id: 'about', label: '关于', title: '关于 HentaiFigure', icon: <IconInfo size={16} /> },
];

export function SettingsModal({
  config,
  appInfo,
  updateInfo,
  initialTab,
  narrow,
  onClose,
  onSaved,
  toast,
}: {
  config: Config;
  appInfo: AppInfo | null;
  updateInfo: UpdateInfo | null;
  initialTab?: string;
  narrow?: boolean;
  onClose: () => void;
  onSaved: (config: Config) => void;
  toast: (text: string, kind?: 'ok' | 'error' | 'info') => void;
}) {
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || 'api');
  const [form, setForm] = useState({
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    imageDetail: config.imageDetail,
    systemPrompt: config.systemPrompt,
    userName: config.userName || '杂鱼',
    autoUpdate: config.autoUpdate,
    dailyChatEnabled: config.dailyChatEnabled !== false,
    dailyChatTime: config.dailyChatTime || '22:00',
  });
  const [apiKey, setApiKey] = useState('');
  const [avatar, setAvatar] = useState(config.managerAvatar || '');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [proactiveBusy, setProactiveBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [info, setInfo] = useState<UpdateInfo | null>(updateInfo);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const [dataBusy, setDataBusy] = useState('');
  const [err, setErr] = useState('');
  const [promptBundle, setPromptBundle] = useState<PromptBundle | null>(config.prompts || null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>(config.prompts?.resolved || {});
  const [promptBusy, setPromptBusy] = useState(false);
  const [devBusy, setDevBusy] = useState(false);

  const isAndroid = appInfo?.platform === 'android';

  useEffect(() => setInfo(updateInfo), [updateInfo]);

  useEffect(() => {
    let alive = true;
    window.hf.config.prompts()
      .then((bundle) => {
        if (!alive) return;
        setPromptBundle(bundle);
        setPromptDrafts(bundle.resolved);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const off = window.hf.onEvent((event) => {
      if (event.type === 'update:info' && event.info) setInfo(event.info as UpdateInfo);
      if (event.type === 'update:available' && event.info) setInfo(event.info as UpdateInfo);
      if (event.type === 'update:progress') setUpdateMessage(String(event.message || ''));
    });
    return off;
  }, []);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const officialEndpoint = isDeepSeekEndpoint(form.baseUrl);
  const selectedModel = officialEndpoint ? DEFAULT_VISION_MODEL : form.model;

  const save = async () => {
    setErr('');
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        ...form,
        baseUrl: form.baseUrl.trim(),
        model: selectedModel.trim(),
        verifyVision: tab === 'api',
        userName: form.userName.trim() || '杂鱼',
        managerAvatar: avatar,
      };
      if (clearKey) patch.clearApiKey = true;
      else if (apiKey.trim()) patch.apiKey = apiKey.trim();
      const saved = await window.hf.config.save(patch);
      onSaved(saved);
      setForm((prev) => ({ ...prev, model: saved.model }));
      setApiKey('');
      setClearKey(false);
      toast('设置已保存。', 'ok');
    } catch (e) {
      setErr(cleanError(e));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.hf.config.test({
        apiKey: apiKey.trim() || undefined,
        baseUrl: form.baseUrl.trim(),
        model: selectedModel.trim(),
      });
      setTestResult(
        result.ok
          ? { ok: true, text: `看图验证通过 · ${result.model}` }
          : { ok: false, text: result.message || '连接失败' }
      );
    } catch (e) {
      setTestResult({ ok: false, text: cleanError(e) });
    } finally {
      setTesting(false);
    }
  };

  const proactiveNow = async () => {
    setProactiveBusy(true);
    try {
      const result = await window.hf.chat.freeProactive();
      if (result?.message) {
        toast('管理员已经挑好话题，去「对话」看看吧。', 'ok');
      } else {
        toast('管理员暂时没有找到合适的话题。', 'info');
      }
    } catch (e) {
      toast(cleanError(e), 'error');
    } finally {
      setProactiveBusy(false);
    }
  };

  const resetPrompt = async () => {
    try {
      const saved = await window.hf.config.resetPrompt();
      setForm((prev) => ({ ...prev, systemPrompt: saved.systemPrompt }));
      setPromptBundle(saved.prompts);
      setPromptDrafts(saved.prompts.resolved);
      onSaved(saved);
      toast('人格设定已恢复默认。', 'ok');
    } catch (e) {
      toast(cleanError(e), 'error');
    }
  };

  const applyPromptConfig = (saved: Config) => {
    onSaved(saved);
    setPromptBundle(saved.prompts);
    setPromptDrafts(saved.prompts.resolved);
  };

  const dirtyPromptKeys = Object.keys(promptDrafts).filter((key) => {
    const base = promptBundle?.resolved[key] ?? '';
    return promptDrafts[key] !== base;
  });

  const savePrompts = async () => {
    if (!dirtyPromptKeys.length) {
      toast('提示词没有改动。', 'info');
      return;
    }
    const patch: Record<string, string> = {};
    for (const key of dirtyPromptKeys) patch[key] = promptDrafts[key];
    setPromptBusy(true);
    setErr('');
    try {
      const saved = await window.hf.config.savePrompts({ prompts: patch });
      applyPromptConfig(saved);
      toast(promptBundle?.devPromptMode ? '已写入系统默认提示词。' : '提示词已保存。', 'ok');
    } catch (e) {
      toast(cleanError(e), 'error');
    } finally {
      setPromptBusy(false);
    }
  };

  const resetPromptKey = async (key: string) => {
    setPromptBusy(true);
    setErr('');
    try {
      const saved = await window.hf.config.savePrompts({ reset: [key] });
      applyPromptConfig(saved);
      toast('已恢复默认。', 'ok');
    } catch (e) {
      toast(cleanError(e), 'error');
    } finally {
      setPromptBusy(false);
    }
  };

  const resetAllPrompts = async () => {
    const keys = Object.keys(promptBundle?.defaults || {});
    if (!keys.length) return;
    const ok = await confirmDialog({
      title: '恢复全部提示词？',
      message: '会把全部提示词恢复成默认值，你改过的内容会丢失。',
      confirmText: '全部恢复',
      danger: true,
    });
    if (!ok) return;
    setPromptBusy(true);
    setErr('');
    try {
      const saved = await window.hf.config.savePrompts({ reset: keys });
      applyPromptConfig(saved);
      toast('全部提示词已恢复默认。', 'ok');
    } catch (e) {
      toast(cleanError(e), 'error');
    } finally {
      setPromptBusy(false);
    }
  };

  const toggleDevPromptMode = async (next: boolean) => {
    if (!promptBundle) return;
    if (next && !promptBundle.defaultsEditable) {
      toast('当前版本不能写入系统默认提示词。请在源码目录里运行开发模式。', 'error');
      return;
    }
    if (next) {
      const ok = await confirmDialog({
        title: '打开开发人员选项？',
        message: '打开后，保存提示词时会直接改写系统默认值文件，不再写用户层。',
        confirmText: '打开',
      });
      if (!ok) return;
    }
    setDevBusy(true);
    setErr('');
    try {
      const saved = await window.hf.config.setDevPromptMode(next);
      applyPromptConfig(saved);
      toast(next ? '开发人员选项已开启。' : '已回到普通模式。', 'ok');
    } catch (e) {
      toast(cleanError(e), 'error');
    } finally {
      setDevBusy(false);
    }
  };

  const pickAvatar = async () => {
    setAvatarBusy(true);
    setErr('');
    try {
      const dataUrl = await window.hf.config.pickAvatar();
      if (dataUrl) setAvatar(dataUrl);
    } catch (e) {
      setErr(cleanError(e));
    } finally {
      setAvatarBusy(false);
    }
  };

  const checkUpdate = async () => {
    setChecking(true);
    setErr('');
    try {
      const result = await window.hf.update.check(false);
      setInfo(result);
      if (result.error) toast(result.error, 'error');
      else if (result.available) toast(`发现新版本 v${result.latestVersion}`, 'info');
      else if (result.configured) toast('已经是最新版本。', 'ok');
      else toast(result.reason || '没有配置更新源。', 'info');
    } catch (e) {
      toast(cleanError(e), 'error');
    } finally {
      setChecking(false);
    }
  };

  const applyUpdate = async () => {
    if (!info?.available) return;
    const ok = await confirmDialog({
      title: '现在更新并重启？',
      message: '更新前会自动备份本地收藏和记忆。更新完成后应用会自动重启。',
      confirmText: '更新',
    });
    if (!ok) return;
    setApplying(true);
    setUpdateMessage('准备更新…');
    try {
      const result = await window.hf.update.apply();
      if (result.updated) setUpdateMessage('更新完成，正在重启…');
    } catch (e) {
      setApplying(false);
      setUpdateMessage('');
      toast(cleanError(e), 'error');
    }
  };

  const openRelease = async () => {
    try {
      await window.hf.update.openRelease();
    } catch (e) {
      toast(cleanError(e), 'error');
    }
  };

  const openExternal = async (url: string) => {
    try {
      await window.hf.openExternal(url);
    } catch (e) {
      toast(cleanError(e), 'error');
    }
  };

  const openDir = async () => {
    if (isAndroid) {
      toast('手机版数据保存在应用本地存储中，请用「导出备份 ZIP」迁移。', 'info');
      return;
    }
    await window.hf.data.openDir();
  };

  const backup = async () => {
    setDataBusy('backup');
    try {
      const result = await window.hf.data.backup();
      toast(`已备份到 ${result.path}`, 'ok');
    } catch (e) {
      toast(cleanError(e), 'error');
    } finally {
      setDataBusy('');
    }
  };

  const exportZip = async () => {
    setDataBusy('export');
    try {
      const result = await window.hf.data.exportZip();
      if (result.path) toast('备份已导出。', 'ok');
    } catch (e) {
      toast(cleanError(e), 'error');
    } finally {
      setDataBusy('');
    }
  };

  const importZip = async () => {
    setDataBusy('import');
    try {
      const result = await window.hf.data.importZip();
      if (result.imported) toast('导入完成，正在重启…', 'ok');
    } catch (e) {
      toast(cleanError(e), 'error');
    } finally {
      setDataBusy('');
    }
  };

  const activeTabMeta = TABS.find((t) => t.id === tab) || TABS[0];
  const showSaveFooter = tab === 'api' || tab === 'persona' || tab === 'update';

  return (
    <Modal size="lg" onClose={onClose} className="settings-sheet">
      <div className={cx('settings', narrow && 'is-narrow')}>
        <aside className="settings-nav">
          {!narrow && (
            <div className="settings-brand">
              <span className="brand-mark">HF</span>
              <div>
                <strong>设置</strong>
                <small>收藏室后台</small>
              </div>
            </div>
          )}
          <div className="settings-tabs">
            {TABS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={cx('settings-tab', tab === item.id && 'active')}
                onClick={() => setTab(item.id)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          {!narrow && (
            <div className="settings-nav-foot">
              v{appInfo?.version || '1.3.1'} · {isAndroid ? 'Android' : '本地运行'}
            </div>
          )}
        </aside>

        <div className="settings-main">
          <SheetHeader
            eyebrow={activeTabMeta.label.toUpperCase()}
            title={activeTabMeta.title}
            onClose={onClose}
          />

          <div className="settings-body">
            {tab === 'api' && (
              <>
                <div className="settings-section">
                  <div className="block-title">DeepSeek API Key</div>
                  <div className="field">
                    <div className="key-row">
                      <input
                        className="input"
                        type="password"
                        value={apiKey}
                        onChange={(e) => { setApiKey(e.target.value); setClearKey(false); setTestResult(null); }}
                        disabled={testing || saving}
                        placeholder={config.apiKeySet ? `已保存 ${config.apiKeyPreview}，留空则不改` : 'sk-…'}
                        autoComplete="off"
                      />
                      {config.apiKeySet && (
                        <button
                          type="button"
                          className={cx('btn btn-sm', clearKey ? 'btn-danger' : 'btn-ghost')}
                          onClick={() => { setClearKey((v) => !v); setTestResult(null); }}
                          disabled={testing || saving}
                        >
                          {clearKey ? '确定清除？' : '清除'}
                        </button>
                      )}
                    </div>
                    <p className="muted small">
                      Key 只保存在当前设备上，不会随备份导出到聊天内容里。
                    </p>
                  </div>

                  <div className="field-row">
                    <label className="field">
                      <span className="field-label">API 地址</span>
                      <input className="input" value={form.baseUrl} onChange={(e) => { set('baseUrl', e.target.value); setTestResult(null); }} disabled={testing || saving} placeholder="https://api.deepseek.com" />
                    </label>
                    <label className="field">
                      <span className="field-label">模型</span>
                      <input
                        className="input"
                        value={selectedModel}
                        onChange={(e) => { set('model', e.target.value); setTestResult(null); }}
                        readOnly={officialEndpoint}
                        disabled={testing || saving}
                        placeholder={DEFAULT_VISION_MODEL}
                      />
                    </label>
                  </div>
                  <p className="muted small">
                    {officialEndpoint
                      ? <>DeepSeek 官方接口使用支持看图的 <code>{DEFAULT_VISION_MODEL}</code>。</>
                      : '自定义接口需要识别测试图片，验证通过后才会保存模型。'}
                  </p>

                  <div className="test-row">
                    <button type="button" className="btn btn-soft" onClick={() => void test()} disabled={testing || saving || clearKey}>
                      {testing ? <Spinner size={15} /> : <IconSparkles size={15} />}
                      测试看图
                    </button>
                    {testResult && (
                      <span className={cx('test-result', testResult.ok ? 'ok' : 'error')}>
                        {testResult.ok ? <IconCircleCheck size={15} /> : <IconAlert size={15} />}
                        {testResult.text}
                      </span>
                    )}
                  </div>
                </div>

                <div className="settings-section">
                  <div className="block-title">看图与随机性</div>
                  <div className="field-row">
                    <label className="field">
                      <span className="field-label">
                        <span>温度</span>
                        <em>{form.temperature.toFixed(1)}</em>
                      </span>
                      <input
                        className="range"
                        type="range"
                        min={0}
                        max={2}
                        step={0.1}
                        value={form.temperature}
                        onChange={(e) => set('temperature', Number(e.target.value))}
                      />
                      <p className="muted small">越高越放得开。默认 1.3。</p>
                    </label>
                    <div className="field">
                      <span className="field-label">图片精度</span>
                      <div className="segmented">
                        <button type="button" className={form.imageDetail === 'high' ? 'active' : ''} onClick={() => set('imageDetail', 'high')}>高清</button>
                        <button type="button" className={form.imageDetail === 'low' ? 'active' : ''} onClick={() => set('imageDetail', 'low')}>省流</button>
                      </div>
                      <p className="muted small">使用 DeepSeek 时，省流会在模型处理前将图片缩到 512×512。</p>
                    </div>
                  </div>
                </div>
              </>
            )}

            {tab === 'persona' && (
              <>
                <div className="settings-section">
                  <div className="block-title">她怎么称呼你</div>
                  <div className="profile-row">
                    <div className="profile-avatar">
                      <ManagerAvatar src={avatar} className="avatar-xl" />
                      <div className="profile-avatar-actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void pickAvatar()} disabled={avatarBusy}>
                          {avatarBusy ? <Spinner size={13} /> : <IconUpload size={14} />}
                          {avatar ? '换头像' : '上传头像'}
                        </button>
                        {avatar && (
                          <button type="button" className="link danger" onClick={() => setAvatar('')}>移除</button>
                        )}
                      </div>
                    </div>
                    <div className="profile-fields">
                      <label className="field">
                        <span className="field-label">
                          <span>你的昵称</span>
                          <em>管理员会这样叫你</em>
                        </span>
                        <input
                          className="input"
                          value={form.userName}
                          onChange={(e) => set('userName', e.target.value)}
                          placeholder="杂鱼"
                          maxLength={24}
                        />
                        <p className="muted small">问候语、聊天里的称呼、记忆摘要都会用这个名字。</p>
                      </label>
                      <p className="muted small">
                        头像只保存在本地，会出现在首页、对话页和她说话的每一处。不传的话就是「管」字。
                      </p>
                    </div>
                  </div>
                </div>

                <div className="settings-section">
                  <div className="block-title">系统提示词</div>
                  <p className="muted small">
                    这是管理员每一次开口前的底色。阶段规则、周边资料和旧记忆会由应用自动接在后面。想改上贡流程、日常开场、记忆整理这些部分，进「进阶设置」。
                  </p>
                  <textarea
                    className="input textarea prompt-textarea"
                    value={form.systemPrompt}
                    onChange={(e) => set('systemPrompt', e.target.value)}
                    spellCheck={false}
                  />
                  <div className="prompt-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => void resetPrompt()}>恢复默认人格</button>
                    <button type="button" className="btn btn-soft" onClick={() => setTab('prompts')}>
                      <IconStack size={15} /> 进阶设置
                    </button>
                  </div>
                </div>

                <div className="settings-section">
                  <div className="block-title">每日主动话题</div>
                  <Row
                    title="到点让管理员主动来找你"
                    desc="管理员会自己挑话题并新开一段对话。改时间后从下一次到点开始，当天错过也可以在打开应用时补发。"
                  >
                    <Switch
                      on={form.dailyChatEnabled}
                      onChange={(next) => set('dailyChatEnabled', next)}
                      label="切换每日主动话题"
                    />
                  </Row>
                  <div className="field-row">
                    <label className="field">
                      <span className="field-label">每天的时间</span>
                      <input
                        className="input"
                        type="time"
                        value={form.dailyChatTime}
                        onChange={(e) => set('dailyChatTime', e.target.value)}
                        disabled={!form.dailyChatEnabled}
                      />
                    </label>
                    <div className="field">
                      <span className="field-label">现在试一下</span>
                      <button
                        type="button"
                        className="btn btn-soft"
                        onClick={() => void proactiveNow()}
                        disabled={proactiveBusy || !config.apiKeySet}
                      >
                        {proactiveBusy ? <Spinner size={15} /> : <IconChat size={15} />}
                        让她来一条
                      </button>
                      <p className="muted small">会立刻在后台生成一条消息，保存在「对话」里。</p>
                    </div>
                  </div>
                  <p className="muted small"><IconClock size={12} /> 主动话题也会显示系统通知。点通知会直接打开对话。</p>
                </div>
              </>
            )}

            {tab === 'prompts' && (
              <>
                <div className="settings-section">
                  <div className="block-title">提示词总览</div>
                  <p className="muted small">
                    各组内的模板按发给模型的顺序排列。修改后点「关闭」左边的「保存提示词」。
                  </p>
                  <div className="prompt-meta">
                    <span>{Object.keys(promptBundle?.defaults || {}).length} 条指令</span>
                    <span>·</span>
                    <span>{Object.keys(promptBundle?.overrides || {}).length} 条被你改过</span>
                    {promptBundle?.devPromptMode && (
                      <span className="pill pill-warn">开发人员模式</span>
                    )}
                  </div>

                  <Row
                    title="开发人员选项"
                    desc={
                      promptBundle?.devPromptMode
                        ? '保存时直接改写系统默认提示词，不写用户层。'
                        : '保存到用户层，只影响当前设备。'
                    }
                  >
                    <Switch
                      on={Boolean(promptBundle?.devPromptMode)}
                      onChange={(next) => void toggleDevPromptMode(next)}
                      disabled={devBusy || !promptBundle || (!promptBundle.devPromptMode && !promptBundle.defaultsEditable)}
                      label="切换开发人员选项"
                    />
                  </Row>

                  {promptBundle && (
                    <p className="muted small">
                      {promptBundle.devPromptMode
                        ? <>保存会写入 <code>{promptBundle.defaultsPath}</code>，同时清掉用户层的同名覆盖。打包版里这个文件是只读的，只在源码目录运行有效。</>
                        : <>默认值来自 <code>{promptBundle.defaultsPath}</code>，打包进应用；<code>保存提示词</code> 只写用户层。</>}
                      {!promptBundle.defaultsEditable && ' 当前版本不能写系统默认值。'}
                    </p>
                  )}
                </div>

                {PROMPT_SCHEMA.map((group) => (
                  <div className="settings-section" key={group.id}>
                    {group.label && <div className="block-title">{group.label}</div>}
                    {group.desc && <p className="muted small">{group.desc}</p>}
                    {group.fields.map((field) => {
                      const value = promptDrafts[field.key] ?? '';
                      const overridden = Boolean(promptBundle?.overrides[field.key]);
                      return (
                        <div className="prompt-field" key={field.key}>
                          <div className="prompt-field-head">
                            <span className="field-label">
                              <span>{field.label}</span>
                              {overridden && <em>已修改</em>}
                            </span>
                            <button
                              type="button"
                              className="link muted"
                              onClick={() => void resetPromptKey(field.key)}
                              disabled={promptBusy}
                            >
                              恢复默认
                            </button>
                          </div>
                          {field.hint && <p className="muted small">{field.hint}</p>}
                          <textarea
                            className="input textarea prompt-textarea sm"
                            value={value}
                            rows={field.rows || Math.min(16, Math.max(3, value.split('\n').length + 1))}
                            onChange={(e) => setPromptDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))}
                            spellCheck={false}
                          />
                          {field.vars && field.vars.length > 0 && (
                            <div className="prompt-vars">
                              {field.vars.map((v) => <code key={v}>{v}</code>)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}

                <div className="settings-section prompt-reset-section">
                  <button type="button" className="btn btn-ghost" onClick={() => void resetAllPrompts()} disabled={promptBusy}>
                    全部恢复默认
                  </button>
                </div>
              </>
            )}

            {tab === 'update' && (
              <>
                <div className="settings-section">
                  <div className="update-card">
                    <div className="update-version">
                      <div>
                        <span className="muted small">当前版本</span>
                        <strong>v{info?.currentVersion || appInfo?.version || '1.3.1'}</strong>
                      </div>
                      <span className={cx('update-arrow', info?.available && 'has')}>→</span>
                      <div>
                        <span className="muted small">最新版本</span>
                        <strong>v{info?.latestVersion || info?.currentVersion || appInfo?.version || '1.3.1'}</strong>
                      </div>
                      <span className={cx('pill', info?.available ? 'pill-gold' : info?.error ? 'pill-danger' : info?.configured ? 'pill-ok' : '')}>
                        {info?.available ? '有新版本' : info?.error ? '检查失败' : info?.configured ? '已是最新' : '点击检查'}
                      </span>
                    </div>

                    {info?.notes && <p className="update-notes">{info.notes}</p>}
                    {info?.error && <p className="update-error"><IconAlert size={14} /> {info.error}</p>}
                    {!info?.configured && !info?.error && (
                      <p className="muted small">更新源已固定，点「检查更新」会读取 GitHub 上的最新发布。</p>
                    )}

                    {applying && (
                      <div className="update-progress">
                        <Spinner size={16} />
                        <span>{updateMessage || '正在更新…'}</span>
                      </div>
                    )}

                    {isAndroid ? (
                      <p className="muted small">
                        <IconAlert size={13} /> 手机版不支持应用内更新。请到发布页下载新的 APK 覆盖安装；本地收藏和记忆会保留。
                      </p>
                    ) : appInfo?.isPackaged ? (
                      <p className="muted small">
                        <IconAlert size={13} /> 便携版不支持应用内自动更新。请到发布页下载新版本，直接替换 exe；本地数据不受影响。
                      </p>
                    ) : null}

                    <div className="update-actions">
                      <button type="button" className="btn btn-soft" onClick={() => void checkUpdate()} disabled={checking || applying}>
                        {checking ? <Spinner size={15} /> : <IconRefresh size={15} />}
                        检查更新
                      </button>
                      {info?.available && !isAndroid && !appInfo?.isPackaged && (
                        <button type="button" className="btn btn-primary" onClick={() => void applyUpdate()} disabled={applying}>
                          <IconDownload size={15} /> 更新并重启
                        </button>
                      )}
                      <button type="button" className="btn btn-ghost" onClick={() => void openRelease()}>
                        打开发布页
                      </button>
                    </div>

                    <p className="muted small update-safety">
                      <IconCheck size={13} />
                      <span>更新只替换程序文件。收藏、照片和记忆在 <code>{appInfo?.dataDir || '…'}</code>，并且更新前会自动备份。</span>
                    </p>
                  </div>
                </div>

                <div className="settings-section">
                  <div className="block-title">更新源</div>
                  <div className="data-path">
                    <IconDownload size={16} />
                    <code>{appConfig.repoUrl.replace(/^https?:\/\//, '')}</code>
                    <button type="button" className="link" onClick={() => void openExternal(appConfig.repoUrl)}>打开</button>
                  </div>
                  <Row
                    title="启动时自动检查更新"
                    desc="发现新版本时在首页提示，不会自动安装。"
                  >
                    <Switch
                      on={form.autoUpdate}
                      onChange={(next) => set('autoUpdate', next)}
                      label="切换自动更新"
                    />
                  </Row>
                </div>
              </>
            )}

            {tab === 'data' && (
              <>
                <div className="settings-section">
                  <div className="block-title">本地数据</div>
                  <div className="data-path">
                    <IconFolder size={16} />
                    <code>{appInfo?.dataDir || '加载中…'}</code>
                  </div>
                  <p className="muted small">
                    所有收藏、照片和记忆都保存在本地。更新程序不会碰它。
                  </p>
                  <div className="data-grid">
                    {!isAndroid && (
                      <button type="button" className="data-action" onClick={() => void openDir()}>
                        <IconFolder size={19} />
                        <span><strong>打开数据目录</strong><small>看看文件和照片</small></span>
                      </button>
                    )}
                    <button type="button" className="data-action" onClick={() => void backup()} disabled={Boolean(dataBusy)}>
                      <IconRefresh size={19} />
                      <span><strong>立即备份</strong><small>{isAndroid ? '生成并分享备份包' : '存一份到 backups/'}</small></span>
                    </button>
                    <button type="button" className="data-action" onClick={() => void exportZip()} disabled={Boolean(dataBusy)}>
                      <IconDownload size={19} />
                      <span><strong>导出备份 ZIP</strong><small>收藏 + 照片 + 记忆</small></span>
                    </button>
                    <button type="button" className="data-action" onClick={() => void importZip()} disabled={Boolean(dataBusy)}>
                      <IconWallet size={19} />
                      <span><strong>导入备份</strong><small>覆盖当前数据并重启</small></span>
                    </button>
                  </div>
                  {dataBusy && (
                    <div className="update-progress">
                      <Spinner size={16} />
                      <span>{dataBusy === 'backup' ? '正在备份…' : dataBusy === 'export' ? '正在打包…' : '正在导入…'}</span>
                    </div>
                  )}
                </div>

                <div className="settings-section">
                  <div className="block-title">自动备份</div>
                  <p className="muted small">
                    每次更新、导入前都会自动备份；最多保留 12 份。照片和记忆也会一起备份。
                  </p>
                </div>
              </>
            )}

            {tab === 'about' && (
              <>
                <div className="settings-section about-hero">
                  <span className="brand-mark lg">HF</span>
                  <div>
                    <h3>HentaiFigure</h3>
                    <p className="muted">一个只属于你的手办收藏室。<br />每天一次上贡，擦拭、意淫、教唆。</p>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="about-rows">
                    <div><span>版本</span><b>v{appInfo?.version || '1.3.1'}</b></div>
                    <div><span>运行环境</span><b>{isAndroid ? 'Android · Capacitor' : `Electron ${appInfo?.versions.electron || ''}`}</b></div>
                    {!isAndroid && <div><span>Chrome</span><b>{appInfo?.versions.chrome || '—'}</b></div>}
                    {!isAndroid && <div><span>Node</span><b>{appInfo?.versions.node || '—'}</b></div>}
                    <div><span>数据存储</span><b className="mono">{appInfo?.dataDir || '—'}</b></div>
                  </div>
                  {!isAndroid && (
                    <p className="muted small">
                      快捷键：<code>F11</code> 全屏 · <code>F12</code> 开发者工具。所有对话内容由你配置的 DeepSeek API 生成，只保存在本地。
                    </p>
                  )}
                  <div className="about-links">
                    <button type="button" className="link" onClick={() => void openExternal('https://api-docs.deepseek.com/')}>DeepSeek API 文档</button>
                    <button type="button" className="link" onClick={() => void openExternal('https://github.com/deepseek-ai/chat-demo')}>参考的 chat-demo 项目</button>
                  </div>
                </div>
                <div className="settings-section">
                  <p className="muted small">
                    {isAndroid
                      ? '照片、记忆与 API Key 都只留在这台手机上，不会上传到除你配置的 API 之外的任何地方。'
                      : '照片、记忆与 API Key 都只留在这台电脑的数据目录里，不会上传到除你配置的 API 之外的任何地方。'}
                  </p>
                </div>
              </>
            )}
          </div>

          <footer className="sheet-foot">
            <div className="sheet-error">
              {err || (tab === 'prompts' && dirtyPromptKeys.length > 0 && <span className="muted small">有未保存的改动</span>)}
            </div>
            <div className="sheet-actions">
              {showSaveFooter && (
                <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || testing}>
                  {saving ? <Spinner size={15} /> : <IconCheck size={16} />}
                  保存设置
                </button>
              )}
              {tab === 'prompts' && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void savePrompts()}
                  disabled={promptBusy || !dirtyPromptKeys.length}
                >
                  {promptBusy ? <Spinner size={15} /> : <IconCheck size={16} />}
                  保存提示词{dirtyPromptKeys.length ? `（${dirtyPromptKeys.length}）` : ''}
                </button>
              )}
              <button type="button" className="btn btn-ghost" onClick={onClose}>关闭</button>
            </div>
          </footer>
        </div>
      </div>
    </Modal>
  );
}
