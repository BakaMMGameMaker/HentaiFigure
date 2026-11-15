import { useEffect, useState, type ReactNode } from 'react';
import type { AppInfo, Config, PromptBundle, UpdateInfo } from '../types';
import { PROMPT_SCHEMA } from '../prompts';
import { Modal, ManagerAvatar, Spinner } from './ui';
import {
  IconAlert, IconCheck, IconCircleCheck, IconClock, IconDownload, IconFolder, IconInfo, IconChat,
  IconRefresh, IconSettings, IconSparkles, IconStack, IconUpload, IconWallet, IconX,
} from '../icons';
import { cleanError } from '../utils';
import appConfig from '../../app-config.json';

type Tab = 'api' | 'persona' | 'prompts' | 'update' | 'data' | 'about';

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'api', label: 'API', icon: <IconSettings size={17} /> },
  { id: 'persona', label: '管理员', icon: <IconSparkles size={17} /> },
  { id: 'prompts', label: '进阶', icon: <IconStack size={17} /> },
  { id: 'update', label: '更新', icon: <IconRefresh size={17} /> },
  { id: 'data', label: '数据', icon: <IconFolder size={17} /> },
  { id: 'about', label: '关于', icon: <IconInfo size={17} /> },
];

export function SettingsModal({
  config,
  appInfo,
  updateInfo,
  initialTab,
  onClose,
  onSaved,
  toast,
}: {
  config: Config;
  appInfo: AppInfo | null;
  updateInfo: UpdateInfo | null;
  initialTab?: string;
  onClose: () => void;
  onSaved: (config: Config) => void;
  toast: (text: string, kind?: 'ok' | 'error' | 'info') => void;
}) {
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || 'api');
  const [form, setForm] = useState({
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    maxPhotosPerRequest: config.maxPhotosPerRequest,
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
      if (event.type === 'update:progress') {
        setUpdateMessage(String(event.message || ''));
      }
    });
    return off;
  }, []);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setErr('');
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        ...form,
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        userName: form.userName.trim() || '杂鱼',
        managerAvatar: avatar,
      };
      if (clearKey) patch.clearApiKey = true;
      else if (apiKey.trim()) patch.apiKey = apiKey.trim();
      const saved = await window.hf.config.save(patch);
      onSaved(saved);
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
        model: form.model.trim(),
      });
      setTestResult(
        result.ok
          ? { ok: true, text: `连接成功 · ${result.model} 回复「${result.reply || '…'}」` }
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
    if (!window.confirm('把全部提示词恢复成默认值？你改过的内容会丢失。')) return;
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

  const toggleDevPromptMode = async () => {
    if (!promptBundle) return;
    const next = !promptBundle.devPromptMode;
    if (next && !promptBundle.defaultsEditable) {
      toast('当前版本不能写入系统默认提示词。请在源码目录里运行开发模式。', 'error');
      return;
    }
    if (next && !window.confirm('开发人员选项：保存提示词时会直接改写系统默认值，不再写用户层。确定打开吗？')) return;
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
    const okay = window.confirm('更新前会自动备份本地收藏和记忆。更新完成后应用会自动重启，确定继续吗？');
    if (!okay) return;
    setApplying(true);
    setUpdateMessage('准备更新…');
    try {
      const result = await window.hf.update.apply();
      if (result.updated) {
        setUpdateMessage('更新完成，正在重启…');
      }
    } catch (e) {
      setApplying(false);
      setUpdateMessage('');
      toast(cleanError(e), 'error');
    }
  };

  const openDir = async () => {
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

  return (
    <Modal className="modal-settings" onClose={onClose}>
      <div className="settings">
        <aside className="settings-nav">
          <div className="settings-brand">
            <span className="brand-mark small">HF</span>
            <div>
              <strong>设置</strong>
              <small>收藏室后台</small>
            </div>
          </div>
          {TABS.map((item) => (
            <button
              key={item.id}
              className={`settings-tab ${tab === item.id ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
          <div className="settings-nav-foot">
            <span>v{appInfo?.version || '1.2.0'}</span>
            <span className="settings-nav-dot" />
            <span>本地运行</span>
          </div>
        </aside>

        <div className="settings-main">
          <header className="settings-head">
            <div>
              <div className="eyebrow">{TABS.find((t) => t.id === tab)?.label.toUpperCase()}</div>
              <h2>
                {tab === 'api' && '连接 DeepSeek'}
                {tab === 'persona' && '管理员的性格'}
                {tab === 'prompts' && '进阶设置'}
                {tab === 'update' && '检查更新'}
                {tab === 'data' && '数据与备份'}
                {tab === 'about' && '关于 HentaiFigure'}
              </h2>
            </div>
            <button className="icon-button" onClick={onClose} aria-label="关闭"><IconX size={20} /></button>
          </header>

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
                        onChange={(e) => { setApiKey(e.target.value); setClearKey(false); }}
                        placeholder={config.apiKeySet ? `已保存 ${config.apiKeyPreview}，留空则不改` : 'sk-…'}
                        autoComplete="off"
                      />
                      {config.apiKeySet && (
                        <button
                          className={`btn btn-small ${clearKey ? 'btn-danger' : 'btn-ghost'}`}
                          onClick={() => setClearKey((v) => !v)}
                        >
                          {clearKey ? '确定清除？' : '清除'}
                        </button>
                      )}
                    </div>
                    <p className="muted small">
                      Key 只保存在这台电脑上，并使用系统安全存储加密。它不会随备份导出到聊天内容里。
                    </p>
                  </div>

                  <div className="field-row">
                    <label className="field">
                      <span className="field-label">API 地址</span>
                      <input className="input" value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder="https://api.deepseek.com" />
                    </label>
                    <label className="field">
                      <span className="field-label">模型</span>
                      <input className="input" value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="deepseek-flash" />
                    </label>
                  </div>
                  <p className="muted small">
                    默认 <code>deepseek-flash</code>，支持看图。换用纯文本模型时，管理员只会根据照片标签和商品详情说话。
                  </p>

                  <div className="test-row">
                    <button className="btn btn-soft" onClick={test} disabled={testing}>
                      {testing ? <Spinner size={15} /> : <IconSparkles size={15} />}
                      测试连接
                    </button>
                    {testResult && (
                      <span className={`test-result ${testResult.ok ? 'ok' : 'error'}`}>
                        {testResult.ok ? <IconCircleCheck size={15} /> : <IconAlert size={15} />}
                        {testResult.text}
                      </span>
                    )}
                  </div>
                </div>

                <div className="settings-section">
                  <div className="block-title">看图与随机性</div>
                  <label className="field">
                    <span className="field-label">
                      每轮附送照片
                      <em>{form.maxPhotosPerRequest} 张</em>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      step={1}
                      value={form.maxPhotosPerRequest}
                      onChange={(e) => set('maxPhotosPerRequest', Number(e.target.value))}
                    />
                    <p className="muted small">每次回复时附上她几张照片给模型。越多越贵，但细节也更足。</p>
                  </label>
                  <div className="field-row">
                    <label className="field">
                      <span className="field-label">温度 <em>{form.temperature.toFixed(1)}</em></span>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.1}
                        value={form.temperature}
                        onChange={(e) => set('temperature', Number(e.target.value))}
                      />
                      <p className="muted small">越高越放得开。默认 1.3。</p>
                    </label>
                    <label className="field">
                      <span className="field-label">图片精度</span>
                      <div className="segmented">
                        <button className={form.imageDetail === 'high' ? 'active' : ''} onClick={() => set('imageDetail', 'high')}>高清</button>
                        <button className={form.imageDetail === 'low' ? 'active' : ''} onClick={() => set('imageDetail', 'low')}>省流</button>
                      </div>
                      <p className="muted small">省流会先缩到 512×512，更便宜更快。</p>
                    </label>
                  </div>
                </div>
              </>
            )}

            {tab === 'persona' && (
              <>
              <div className="settings-section">
                <div className="block-title">她怎么称呼你</div>
                <div className="manager-profile">
                  <div className="manager-profile-avatar">
                    <ManagerAvatar src={avatar} className="settings-avatar" />
                    <div className="manager-profile-avatar-actions">
                      <button className="btn btn-ghost btn-small" onClick={() => void pickAvatar()} disabled={avatarBusy}>
                        {avatarBusy ? <Spinner size={13} /> : <IconUpload size={14} />}
                        {avatar ? '换头像' : '上传头像'}
                      </button>
                      {avatar && (
                        <button className="text-button danger" onClick={() => setAvatar('')}>移除</button>
                      )}
                    </div>
                  </div>
                  <div className="manager-profile-fields">
                    <label className="field">
                      <span className="field-label">
                        你的昵称
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
                      头像只保存在本地，会出现在首页、对话页和她说话的每一处。不传的话就是那个「管」字。
                    </p>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <div className="block-title">系统提示词</div>
                <p className="muted small">
                  这是管理员每一次开口前的底色。阶段规则、周边资料和旧记忆会由应用自动接在后面，不需要写在这里。
                  想改上贡流程、日常开场、记忆整理这些部分，进「进阶设置」。
                </p>
                <textarea
                  className="input textarea prompt-textarea"
                  value={form.systemPrompt}
                  onChange={(e) => set('systemPrompt', e.target.value)}
                  spellCheck={false}
                />
                <div className="prompt-actions">
                  <button className="btn btn-ghost" onClick={resetPrompt}>恢复默认人格</button>
                  <div className="prompt-actions-right">
                    <span className="muted small">越具体，她越像你的管理员。</span>
                    <button className="btn btn-soft" onClick={() => setTab('prompts')}>
                      <IconStack size={15} /> 进阶设置
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <div className="block-title">每日主动话题</div>
                <label className="switch-row">
                  <span>
                    <strong>到点让管理员主动来找你</strong>
                    <small>管理员会读取收藏室和全部记忆，自己挑一个话题开头。应用没开的话，下次启动会补上。</small>
                  </span>
                  <button
                    type="button"
                    className={`switch ${form.dailyChatEnabled ? 'on' : ''}`}
                    onClick={() => set('dailyChatEnabled', !form.dailyChatEnabled)}
                    aria-label="切换每日主动话题"
                  >
                    <span />
                  </button>
                </label>
                <div className="field-row">
                  <label className="field">
                    <span className="field-label">每天的时间</span>
                    <input
                      className="input input-date"
                      type="time"
                      value={form.dailyChatTime}
                      onChange={(e) => set('dailyChatTime', e.target.value)}
                      disabled={!form.dailyChatEnabled}
                    />
                  </label>
                  <div className="field">
                    <span className="field-label">现在试一下</span>
                    <button
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
                <p className="muted small">
                  <IconClock size={13} /> 主动话题也会显示系统通知。点通知会直接打开对话。
                </p>
              </div>
              </>
            )}

            {tab === 'prompts' && (
              <>
                <div className="settings-section">
                  <div className="block-title">提示词总览</div>
                  <p className="muted small">
                    这里包括管理员每一次请求真正发出去的每一条指令，除了 API 连接测试以外都可以改。
                    改完点最下面的「保存提示词」，只影响这台设备。
                  </p>
                  <div className="prompt-meta">
                    <span>{Object.keys(promptBundle?.defaults || {}).length} 条指令</span>
                    <span className="home-foot-dot" />
                    <span>{Object.keys(promptBundle?.overrides || {}).length} 条被你改过</span>
                    {promptBundle?.devPromptMode && (
                      <>
                        <span className="home-foot-dot" />
                        <span className="prompt-dev-badge">开发人员模式</span>
                      </>
                    )}
                  </div>
                  <label className="switch-row">
                    <span>
                      <strong>开发人员选项</strong>
                      <small>
                        {promptBundle?.devPromptMode
                          ? '保存时直接改写系统默认提示词，不写用户层。'
                          : '保存到用户层，只影响这台设备。'}
                      </small>
                    </span>
                    <button
                      type="button"
                      className={`switch ${promptBundle?.devPromptMode ? 'on' : ''}`}
                      onClick={() => void toggleDevPromptMode()}
                      disabled={devBusy || !promptBundle || (!promptBundle.devPromptMode && !promptBundle.defaultsEditable)}
                      aria-label="切换开发人员选项"
                    >
                      <span />
                    </button>
                  </label>
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
                    <div className="block-title">{group.label}</div>
                    <p className="muted small">{group.desc}</p>
                    {group.fields.map((field) => {
                      const value = promptDrafts[field.key] ?? '';
                      const overridden = Boolean(promptBundle?.overrides[field.key]);
                      return (
                        <div className="prompt-field" key={field.key}>
                          <div className="prompt-field-head">
                            <span className="field-label">
                              {field.label}
                              {overridden && <em>已修改</em>}
                            </span>
                            <button
                              className="text-button subtle"
                              onClick={() => void resetPromptKey(field.key)}
                              disabled={promptBusy}
                            >
                              恢复默认
                            </button>
                          </div>
                          {field.hint && <p className="muted small prompt-field-hint">{field.hint}</p>}
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

                <div className="settings-section prompt-actions-bar">
                  <button className="btn btn-primary" onClick={() => void savePrompts()} disabled={promptBusy || !dirtyPromptKeys.length}>
                    {promptBusy ? <Spinner size={15} /> : <IconCheck size={16} />}
                    保存提示词{dirtyPromptKeys.length ? `（${dirtyPromptKeys.length}）` : ''}
                  </button>
                  <button className="btn btn-ghost" onClick={() => void resetAllPrompts()} disabled={promptBusy}>
                    全部恢复默认
                  </button>
                  {dirtyPromptKeys.length > 0 && <span className="muted small">有未保存的改动</span>}
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
                        <strong>v{info?.currentVersion || appInfo?.version || '1.2.0'}</strong>
                      </div>
                      <span className={`update-arrow ${info?.available ? 'has' : ''}`}>→</span>
                      <div>
                        <span className="muted small">最新版本</span>
                        <strong>v{info?.latestVersion || info?.currentVersion || appInfo?.version || '1.2.0'}</strong>
                      </div>
                      <span className={`update-badge ${info?.available ? 'available' : info?.error ? 'error' : info?.configured ? 'ok' : ''}`}>
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
                    {appInfo?.platform === 'android' ? (
                      <p className="muted small"><IconAlert size={13} /> 手机版不支持应用内更新。请到发布页下载新的 APK 覆盖安装；本地收藏和记忆会保留。</p>
                    ) : appInfo?.isPackaged ? (
                      <p className="muted small"><IconAlert size={13} /> 便携版不支持应用内自动更新。请到发布页下载新版本，直接替换 exe；本地数据不受影响。</p>
                    ) : null}
                    <div className="update-actions">
                      <button className="btn btn-soft" onClick={checkUpdate} disabled={checking || applying}>
                        {checking ? <Spinner size={15} /> : <IconRefresh size={15} />}
                        检查更新
                      </button>
                      {info?.available && (
                        <button className="btn btn-primary" onClick={applyUpdate} disabled={applying || Boolean(appInfo?.isPackaged) || appInfo?.platform === 'android'}>
                          <IconDownload size={15} /> 更新并重启
                        </button>
                      )}
                      {info?.htmlUrl && (
                        <button className="btn btn-ghost" onClick={() => window.hf.update.openRelease()}>打开发布页</button>
                      )}
                    </div>
                    <p className="muted small update-safety">
                      <IconCheck size={13} /> 更新只替换程序文件。收藏、照片和记忆在 <code>{appInfo?.dataDir || '…'}</code>，并且更新前会自动备份。
                    </p>
                  </div>
                </div>

                <div className="settings-section">
                  <div className="block-title">更新源</div>
                  <div className="data-path-box">
                    <IconDownload size={18} />
                    <code>{appConfig.repoUrl.replace(/^https?:\/\//, '')}</code>
                  </div>
                  <p className="muted small">
                    更新源已固定在官方仓库。发现新版本时，这里会显示版本差异和发布说明。
                  </p>
                  <div className="update-source-actions">
                    <button className="text-button" onClick={() => window.hf.openExternal(appConfig.repoUrl)}>
                      打开 GitHub 仓库
                    </button>
                  </div>
                  <label className="switch-row">
                    <span>
                      <strong>启动时自动检查更新</strong>
                      <small>发现新版本时在首页提示，不会自动安装。</small>
                    </span>
                    <button
                      type="button"
                      className={`switch ${form.autoUpdate ? 'on' : ''}`}
                      onClick={() => set('autoUpdate', !form.autoUpdate)}
                      aria-label="切换自动更新"
                    >
                      <span />
                    </button>
                  </label>
                </div>
              </>
            )}

            {tab === 'data' && (
              <>
                <div className="settings-section">
                  <div className="block-title">本地数据</div>
                  <div className="data-path-box">
                    <IconFolder size={18} />
                    <code>{appInfo?.dataDir || '加载中…'}</code>
                  </div>
                  <p className="muted small">
                    所有收藏、照片和记忆都在这个文件夹里。更新程序不会碰它。删掉这个文件夹等于清空整个收藏室。
                  </p>
                  <div className="data-grid">
                    <button className="data-action" onClick={openDir}>
                      <IconFolder size={20} />
                      <span><strong>打开数据目录</strong><small>看看文件和照片</small></span>
                    </button>
                    <button className="data-action" onClick={backup} disabled={Boolean(dataBusy)}>
                      <IconRefresh size={20} />
                      <span><strong>立即备份</strong><small>存一份到 backups/</small></span>
                    </button>
                    <button className="data-action" onClick={exportZip} disabled={Boolean(dataBusy)}>
                      <IconDownload size={20} />
                      <span><strong>导出备份 ZIP</strong><small>收藏 + 照片 + 记忆</small></span>
                    </button>
                    <button className="data-action" onClick={importZip} disabled={Boolean(dataBusy)}>
                      <IconWallet size={20} />
                      <span><strong>导入备份</strong><small>覆盖当前数据并重启</small></span>
                    </button>
                  </div>
                  {dataBusy && (
                    <div className="update-progress"><Spinner size={16} /><span>{dataBusy === 'backup' ? '正在备份…' : dataBusy === 'export' ? '正在打包…' : '正在导入…'}</span></div>
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
                  <span className="brand-mark">HF</span>
                  <div>
                    <h3>HentaiFigure</h3>
                    <p>一个只属于你的手办收藏室。<br />每天一次上贡，擦拭、意淫、教唆。</p>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="about-rows">
                    <div><span>版本</span><b>v{appInfo?.version || '1.2.0'}</b></div>
                    <div><span>Electron</span><b>{appInfo?.versions.electron || '—'}</b></div>
                    <div><span>Chrome</span><b>{appInfo?.versions.chrome || '—'}</b></div>
                    <div><span>Node</span><b>{appInfo?.versions.node || '—'}</b></div>
                    <div><span>数据目录</span><b className="mono">{appInfo?.dataDir || '—'}</b></div>
                  </div>
                  <p className="muted small">
                    快捷键：<code>F11</code> 全屏 · <code>F12</code> 开发者工具。所有对话内容由你配置的 DeepSeek API 生成，只保存在本地。
                  </p>
                  <div className="about-links">
                    <button className="text-button" onClick={() => window.hf.openExternal('https://api-docs.deepseek.com/')}>DeepSeek API 文档</button>
                    <button className="text-button" onClick={() => window.hf.openExternal('https://github.com/deepseek-ai/chat-demo')}>参考的 chat-demo 项目</button>
                  </div>
                </div>
                <div className="settings-section about-foot">
                  <div className="about-foot-line">
                    <span>{appInfo?.name || 'HentaiFigure'} · 私人的收藏室</span>
                    <span className="home-foot-dot" />
                    <span>
                      {appInfo?.platform === 'android'
                        ? '照片、记忆与 API Key 都只留在这台手机上'
                        : '照片、记忆与 API Key 都只留在这台电脑上'}
                    </span>
                  </div>
                  <p className="muted small">
                    {appInfo?.platform === 'android'
                      ? '数据保存在应用自己的本地存储里，不会上传到除你配置的 API 之外的任何地方。'
                      : '数据保存在上面的数据目录里，不会上传到除你配置的 API 之外的任何地方。'}
                  </p>
                </div>
              </>
            )}
          </div>

          <footer className="settings-foot">
            <div className="settings-error">{err}</div>
            <div className="settings-actions">
              {tab !== 'data' && tab !== 'about' && tab !== 'prompts' && (
                <button className="btn btn-primary" onClick={save} disabled={saving}>
                  {saving ? <Spinner size={15} /> : <IconCheck size={16} />}
                  保存设置
                </button>
              )}
              <button className="btn btn-ghost" onClick={onClose}>关闭</button>
            </div>
          </footer>
        </div>
      </div>
    </Modal>
  );
}








