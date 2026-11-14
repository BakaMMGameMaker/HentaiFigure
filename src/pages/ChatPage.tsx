import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, Config, Item } from '../types';
import {
  PHASE_META, STATUS_META, formatDateCN, formatMoney, itemCover, photoUrl, statusLabel,
} from '../constants';
import { cleanError, formatTime } from '../utils';
import { Spinner } from '../components/ui';
import {
  IconAlert, IconChevronRight, IconClock, IconHeart, IconSend, IconSettings,
  IconSparkles, IconStop, IconBook, IconChat,
} from '../icons';

function TypingDots() {
  return (
    <div className="typing"><span /><span /><span /></div>
  );
}

export function ChatPage({
  config,
  items,
  apiKeySet,
  onOpenSettings,
  onOpenMemory,
  onStateChanged,
  toast,
}: {
  config: Config | null;
  items: Item[];
  apiKeySet: boolean;
  onOpenSettings: () => void;
  onOpenMemory: () => void;
  onStateChanged: () => void | Promise<void>;
  toast: (text: string, kind?: 'ok' | 'error' | 'info') => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [toolStatus, setToolStatus] = useState('');
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [lastProactiveAt, setLastProactiveAt] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);
  const startedRef = useRef(false);

  const markRead = () => {
    try { localStorage.setItem('hf.freechatReadAt', String(Date.now())); } catch {}
  };

  const startGeneration = async () => {
    if (!apiKeySet || startedRef.current) return;
    startedRef.current = true;
    setError('');
    try {
      const result = await window.hf.chat.freeGenerate(false);
      if (!result.started) startedRef.current = false;
    } catch (err) {
      startedRef.current = false;
      setError(cleanError(err));
    }
  };

  const load = async () => {
    try {
      const state = await window.hf.chat.freeState();
      setMessages(state.messages || []);
      setBusy(state.busy);
      setLastProactiveAt(state.lastProactiveAt || null);
      setLoaded(true);
      markRead();
      await onStateChanged();
      const last = state.messages[state.messages.length - 1];
      if (!state.busy && apiKeySet && (!state.messages.length || last?.role === 'user')) {
        void startGeneration();
      }
    } catch (err) {
      setLoaded(true);
      setError(cleanError(err));
    }
  };

  useEffect(() => {
    const off = window.hf.onEvent((event) => {
      if (event.sessionId !== 'freechat') return;
      switch (event.type) {
        case 'chat:start':
          setBusy(true);
          setStreaming('');
          setError('');
          setToolStatus('');
          break;
        case 'chat:delta':
          setStreaming((prev) => prev + String(event.text || ''));
          break;
        case 'chat:reset':
          setStreaming(String(event.text || ''));
          break;
        case 'chat:tool':
          if (event.status === 'running') setToolStatus('正在翻阅记忆与仓库…');
          else setToolStatus('');
          break;
        case 'chat:done': {
          const message = event.message as ChatMessage;
          setMessages((prev) => [...prev, message]);
          setStreaming('');
          setBusy(false);
          setToolStatus('');
          setError('');
          startedRef.current = false;
          markRead();
          onStateChanged();
          break;
        }
        case 'chat:error':
          setError(String(event.message || '管理员卡住了。'));
          setBusy(false);
          setStreaming('');
          setToolStatus('');
          startedRef.current = false;
          break;
        case 'chat:stopped':
          setBusy(false);
          setStreaming('');
          setToolStatus('');
          startedRef.current = false;
          break;
        default:
          break;
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!stickRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages, streaming, busy, toolStatus, error]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(150, Math.max(44, el.scrollHeight))}px`;
  }, [input]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError('');
    try {
      const message = await window.hf.chat.freeSend(text);
      setMessages((prev) => [...prev, message]);
      setInput('');
      setBusy(true);
      setStreaming('');
      startedRef.current = false;
      const result = await window.hf.chat.freeGenerate(false);
      if (!result.started) {
        setBusy(false);
      }
    } catch (err) {
      setError(cleanError(err));
      setBusy(false);
    }
  };

  const stop = () => {
    window.hf.chat.freeStop();
    setBusy(false);
    setStreaming('');
    setToolStatus('');
  };

  const proactive = async () => {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const result = await window.hf.chat.freeProactive();
      if (result?.skipped) {
        setBusy(false);
        const reasons: Record<string, string> = {
          'no-key': '还没有配置 API Key。',
          busy: '管理员正在说话，等一句。',
        };
        toast(reasons[result.reason || ''] || '她没有找到合适的话题。', 'info');
        return;
      }
      if (result?.message) {
        setLastProactiveAt(result.message.ts);
        toast('管理员挑了个新话题。', 'ok');
      }
    } catch (err) {
      setError(cleanError(err));
      setBusy(false);
    }
  };

  const counts = {
    owned: items.filter((i) => i.status === 'owned').length,
    pending: items.filter((i) => i.status === 'pending').length,
    watching: items.filter((i) => i.status === 'watching').length,
  };
  const recent = items.slice(0, 3);
  const last = messages[messages.length - 1];
  const scheduleText = config?.dailyChatEnabled !== false
    ? `每天 ${config?.dailyChatTime || '22:00'} 主动来找你`
    : '主动话题已关闭';

  return (
    <div className="page freechat-page">
      <header className="freechat-head">
        <div className="freechat-identity">
          <div className="freechat-avatar">管</div>
          <div>
            <div className="eyebrow">THE MANAGER</div>
            <h1>收藏室管理员</h1>
            <p>替你打理仓库、记旧账，也陪你聊那些不好意思跟别人说的话。</p>
          </div>
        </div>
        <div className="freechat-head-actions">
          <span className="freechat-schedule"><IconClock size={13} /> {scheduleText}</span>
          <button className="btn btn-soft" onClick={() => void proactive()} disabled={busy || !apiKeySet}>
            <IconSparkles size={15} /> 让她挑个话题
          </button>
          <button className="icon-button" onClick={onOpenSettings} title="设置"><IconSettings size={17} /></button>
        </div>
      </header>

      <div className="freechat-layout">
        <aside className="freechat-side">
          <div className="freechat-side-block">
            <div className="block-title">仓库现状</div>
            <div className="freechat-counts">
              {(['owned', 'pending', 'watching'] as const).map((status) => (
                <div key={status} className={`freechat-count status-${status}`}>
                  <span>{STATUS_META[status].glyph}</span>
                  <strong>{counts[status]}</strong>
                  <small>{STATUS_META[status].label}</small>
                </div>
              ))}
            </div>
          </div>

          <div className="freechat-side-block">
            <div className="block-title">最近摆弄的</div>
            {recent.length ? recent.map((item) => (
              <div className="freechat-recent" key={item.id}>
                <span className="freechat-recent-cover">
                  <img src={photoUrl(itemCover(item), true)} alt="" loading="lazy" />
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{statusLabel(item.status)} · {formatMoney(item.purchasePrice ?? item.originalPrice)}</small>
                </span>
              </div>
            )) : <p className="muted small">柜子还是空的。</p>}
          </div>

          <div className="freechat-side-block">
            <div className="block-title">她的记忆</div>
            <p className="muted small">管理员可以在聊天里翻阅全部上贡记录，也可以由你主动打开记忆库。</p>
            <button className="text-button" onClick={onOpenMemory}>
              <IconBook size={14} /> 打开记忆库 <IconChevronRight size={12} />
            </button>
          </div>

          {lastProactiveAt && (
            <div className="freechat-side-note">
              <IconHeart size={12} /> 上次主动：{formatDateCN(formatTime(lastProactiveAt).slice(0, 10))} {formatTime(lastProactiveAt).slice(11)}
            </div>
          )}
        </aside>

        <section className="freechat-panel">
          <header className="chat-head">
            <div className="chat-avatar">管</div>
            <div className="chat-head-text">
              <strong>收藏室管理员</strong>
              <span><span className="online-dot" /> {busy ? '正在说话…' : '在线'}</span>
            </div>
            <span className="phase-chip freechat-chip"><IconChat size={12} /> 日常</span>
          </header>

          {!apiKeySet && (
            <button className="chat-banner" onClick={onOpenSettings}>
              <IconAlert size={15} />
              还没有配置 DeepSeek API Key，管理员现在说不了话。
              <span>去设置 <IconChevronRight size={13} /></span>
            </button>
          )}

          <div
            className="chat-scroll freechat-scroll"
            ref={scrollRef}
            onScroll={() => {
              const el = scrollRef.current;
              if (!el) return;
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
            }}
          >
            {!loaded ? (
              <div className="freechat-loading"><Spinner /> 正在打开管理员的记录…</div>
            ) : !messages.length && !busy ? (
              <div className="freechat-welcome">
                <div className="freechat-welcome-mark">管</div>
                <h2>收藏室的日常</h2>
                <p>不是上贡流程。聊聊收藏、尾款、旧事，或者今天的心情。<br />管理员记得你们之间发生过的事。</p>
              </div>
            ) : null}

            {messages.map((message) => (
              <div key={message.id} className={`message-row ${message.role}`}>
                {message.role === 'assistant' && <span className="message-avatar">管</span>}
                <div className="message-body">
                  <div className="message-name">{message.role === 'assistant' ? '管理员' : '杂鱼'}</div>
                  <div className="message-bubble">{message.content}</div>
                </div>
              </div>
            ))}

            {streaming && (
              <div className="message-row assistant">
                <span className="message-avatar">管</span>
                <div className="message-body">
                  <div className="message-name">管理员</div>
                  <div className="message-bubble streaming">
                    {streaming}
                    <span className="stream-caret" />
                  </div>
                </div>
              </div>
            )}

            {busy && !streaming && (
              <div className="message-row assistant">
                <span className="message-avatar">管</span>
                <div className="message-body">
                  <div className="message-bubble typing-bubble"><TypingDots /></div>
                </div>
              </div>
            )}

            {toolStatus && <div className="tool-chip"><Spinner size={12} /> {toolStatus}</div>}

            {error && (
              <div className="chat-error">
                <IconAlert size={16} />
                <span>{error}</span>
                {last?.role === 'user' && !busy && (
                  <button className="text-button" onClick={() => void startGeneration()}>重试</button>
                )}
              </div>
            )}
          </div>

          <div className="chat-input-area">
            <div className="chat-input-box">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={busy ? '等管理员说完…' : '和管理员说点什么…（Enter 发送）'}
                disabled={busy}
                rows={1}
              />
              <div className="chat-input-actions">
                {busy ? (
                  <button className="send-button stop" onClick={stop} title="让她停下"><IconStop size={16} /></button>
                ) : (
                  <button className="send-button" onClick={() => void send()} disabled={!input.trim()} title="发送">
                    <IconSend size={17} />
                  </button>
                )}
              </div>
            </div>
            <div className="chat-actions">
              <span className="muted small">{scheduleText}</span>
              <span className="muted small">管理员可以翻阅全部上贡记忆</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}


