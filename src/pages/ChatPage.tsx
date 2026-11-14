import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Character, ChatMessage, ChatThreadSummary, Config, FreeChatState, Item } from '../types';
import {
  STATUS_META, formatDateCN, formatMoney, itemCover, photoUrl,
} from '../constants';
import { cleanError, cx, formatTime, groupThreads } from '../utils';
import { ManagerAvatar, Spinner } from '../components/ui';
import {
  IconAlert, IconBook, IconChat, IconChevronRight, IconClock, IconHeart, IconMore,
  IconPencil, IconPlus, IconSend, IconSettings, IconSparkles, IconStop, IconTrash, IconX,
} from '../icons';

function TypingDots() {
  return (
    <div className="typing"><span /><span /><span /></div>
  );
}

type ThreadListProps = {
  threads: ChatThreadSummary[];
  activeId: string;
  onSelect: (id: string) => void;
  onRename: (thread: ChatThreadSummary) => void;
  onDelete: (thread: ChatThreadSummary) => void;
};

function ThreadList({ threads, activeId, onSelect, onRename, onDelete }: ThreadListProps) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const groups = useMemo(() => groupThreads(threads), [threads]);
  const menuThread = menuId ? threads.find((t) => t.id === menuId) || null : null;

  useEffect(() => {
    if (!menuId) return;
    const timer = window.setTimeout(() => setMenuId(null), 20000);
    return () => window.clearTimeout(timer);
  }, [menuId]);

  if (!threads.length) {
    return <div className="thread-empty">还没有对话。点上面的「新建」开一段。</div>;
  }

  return (
    <div className="thread-list-wrap">
      {menuThread && (
        <div className="thread-actions">
          <span className="thread-actions-title" title={menuThread.title}>{menuThread.title}</span>
          <button type="button" onClick={() => { setMenuId(null); onRename(menuThread); }}>
            <IconPencil size={13} /> 重命名
          </button>
          <button type="button" className="danger" onClick={() => { setMenuId(null); onDelete(menuThread); }}>
            <IconTrash size={13} /> 删除
          </button>
          <button type="button" className="thread-actions-close" onClick={() => setMenuId(null)} aria-label="收起">
            <IconX size={13} />
          </button>
        </div>
      )}
      <div className="thread-list">
        {groups.map((group) => (
          <div className="thread-group" key={group.key}>
            <div className="thread-group-label">{group.label}</div>
            {group.threads.map((thread) => (
              <div
                key={thread.id}
                className={cx('thread-item', thread.id === activeId && 'active')}
                onClick={() => onSelect(thread.id)}
              >
                <div className="thread-item-body">
                  <span className="thread-title">{thread.title}</span>
                  <span className="thread-preview">{thread.preview}</span>
                </div>
                <button
                  type="button"
                  className="thread-more"
                  title="更多"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuId((prev) => (prev === thread.id ? null : thread.id));
                  }}
                >
                  <IconMore size={14} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChatPage({
  config,
  items,
  characters,
  requestedThreadId,
  apiKeySet,
  onOpenSettings,
  onOpenMemory,
  onStateChanged,
  onThreadSelected,
  toast,
}: {
  config: Config | null;
  items: Item[];
  characters: Character[];
  requestedThreadId: string | null;
  apiKeySet: boolean;
  onOpenSettings: () => void;
  onOpenMemory: () => void;
  onStateChanged: () => void | Promise<void>;
  onThreadSelected: () => void;
  toast: (text: string, kind?: 'ok' | 'error' | 'info') => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [activeId, setActiveId] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [toolStatus, setToolStatus] = useState('');
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [lastProactiveAt, setLastProactiveAt] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);
  const startedRef = useRef(false);
  const activeIdRef = useRef('');
  const switchTokenRef = useRef(0);

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const userName = (config?.userName || '').trim() || '杂鱼';
  const avatar = config?.managerAvatar || '';

  const markRead = () => {
    try { localStorage.setItem('hf.freechatReadAt', String(Date.now())); } catch {}
  };

  const applyState = (state: FreeChatState) => {
    setThreads(state.threads || []);
    setActiveId(state.activeId || '');
    activeIdRef.current = state.activeId || '';
    setMessages(state.messages || []);
    setBusy(state.busy);
    setLastProactiveAt(state.lastProactiveAt || null);
    setStreaming('');
    setToolStatus('');
    setError('');
    startedRef.current = false;
  };

  const startGeneration = async (threadId?: string) => {
    if (!apiKeySet || startedRef.current) return;
    startedRef.current = true;
    setError('');
    try {
      const result = await window.hf.chat.freeGenerate(false, threadId || activeIdRef.current);
      if (!result.started) startedRef.current = false;
    } catch (err) {
      startedRef.current = false;
      setError(cleanError(err));
    }
  };

  const load = async () => {
    try {
      const state = await window.hf.chat.freeState();
      setLoaded(true);
      if (requestedThreadId && requestedThreadId !== state.activeId) {
        const selected = await window.hf.chat.freeSelect(requestedThreadId);
        applyState(selected);
        onThreadSelected();
        markRead();
        await onStateChanged();
        return;
      }
      applyState(state);
      markRead();
      await onStateChanged();
      if (!state.threads.length && apiKeySet) {
        const created = await window.hf.chat.freeNew();
        applyState(created.state);
        setBusy(true);
        void startGeneration(created.id);
        return;
      }
      const last = state.messages[state.messages.length - 1];
      if (!state.busy && apiKeySet && state.activeId && (!state.messages.length || last?.role === 'user')) {
        void startGeneration(state.activeId);
      }
    } catch (err) {
      setLoaded(true);
      setError(cleanError(err));
    }
  };

  useEffect(() => {
    const off = window.hf.onEvent((event) => {
      if (event.channel !== 'freechat') return;
      const isActive = !event.sessionId || event.sessionId === activeIdRef.current;
      if (event.type === 'free:threads' && Array.isArray(event.threads)) {
        setThreads(event.threads as ChatThreadSummary[]);
        return;
      }
      switch (event.type) {
        case 'chat:start':
          if (!isActive) return;
          setBusy(true);
          setStreaming('');
          setError('');
          setToolStatus('');
          break;
        case 'chat:delta':
          if (!isActive) return;
          setStreaming((prev) => prev + String(event.text || ''));
          break;
        case 'chat:reset':
          if (!isActive) return;
          setStreaming(String(event.text || ''));
          break;
        case 'chat:tool':
          if (!isActive) return;
          if (event.status === 'running') setToolStatus('正在翻阅记忆与仓库…');
          else setToolStatus('');
          break;
        case 'chat:done': {
          const message = event.message as ChatMessage;
          if (isActive) {
            setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
            setStreaming('');
            setBusy(false);
            setToolStatus('');
            setError('');
            startedRef.current = false;
            markRead();
          }
          if (Array.isArray(event.threads)) setThreads(event.threads as ChatThreadSummary[]);
          onStateChanged();
          break;
        }
        case 'chat:error':
          if (!isActive) return;
          setError(String(event.message || '管理员卡住了。'));
          setBusy(false);
          setStreaming('');
          setToolStatus('');
          startedRef.current = false;
          break;
        case 'chat:stopped':
          if (!isActive) return;
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
    if (!requestedThreadId || requestedThreadId === activeIdRef.current) return;
    const token = switchTokenRef.current + 1;
    switchTokenRef.current = token;
    window.hf.chat.freeSelect(requestedThreadId)
      .then((state) => {
        if (switchTokenRef.current !== token) return;
        applyState(state);
        onThreadSelected();
        markRead();
        onStateChanged();
        const last = state.messages[state.messages.length - 1];
        if (!state.busy && apiKeySet && (!state.messages.length || last?.role === 'user')) {
          void startGeneration(state.activeId);
        }
      })
      .catch((err) => setError(cleanError(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedThreadId]);

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

  const selectThread = async (threadId: string) => {
    if (!threadId || threadId === activeIdRef.current) {
      setDrawerOpen(false);
      return;
    }
    const token = switchTokenRef.current + 1;
    switchTokenRef.current = token;
    setDrawerOpen(false);
    try {
      const state = await window.hf.chat.freeSelect(threadId);
      if (switchTokenRef.current !== token) return;
      applyState(state);
      markRead();
      await onStateChanged();
      const last = state.messages[state.messages.length - 1];
      if (!state.busy && apiKeySet && (!state.messages.length || last?.role === 'user')) {
        void startGeneration(state.activeId);
      }
    } catch (err) {
      setError(cleanError(err));
    }
  };

  const newThread = async () => {
    setDrawerOpen(false);
    try {
      const result = await window.hf.chat.freeNew();
      applyState(result.state);
      markRead();
      await onStateChanged();
      if (apiKeySet) {
        setBusy(true);
        void startGeneration(result.id);
      }
      inputRef.current?.focus();
    } catch (err) {
      setError(cleanError(err));
    }
  };

  const beginRename = (thread: ChatThreadSummary) => {
    setRenamingId(thread.id);
    setRenameValue(thread.title);
  };

  const commitRename = async () => {
    const id = renamingId;
    const title = renameValue.trim();
    setRenamingId(null);
    if (!id || !title) return;
    try {
      const next = await window.hf.chat.freeRename(id, title);
      setThreads(next);
      await onStateChanged();
    } catch (err) {
      setError(cleanError(err));
    }
  };

  const deleteThread = async (thread: ChatThreadSummary) => {
    if (!window.confirm(`删掉「${thread.title}」这段对话吗？聊天内容不会进记忆库，管理员也不会再记得它。`)) return;
    try {
      const result = await window.hf.chat.freeDelete(thread.id);
      applyState(result.state);
      await onStateChanged();
      toast('对话已删除。', 'info');
    } catch (err) {
      setError(cleanError(err));
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError('');
    try {
      const result = await window.hf.chat.freeSend(text, activeId || undefined);
      if (result.threadId && result.threadId !== activeIdRef.current) {
        activeIdRef.current = result.threadId;
        setActiveId(result.threadId);
      }
      setMessages((prev) => [...prev, result.message]);
      setInput('');
      setBusy(true);
      setStreaming('');
      startedRef.current = false;
      const started = await window.hf.chat.freeGenerate(false, result.threadId || activeId);
      if (!started.started) setBusy(false);
      const state = await window.hf.chat.freeState();
      setThreads(state.threads || []);
    } catch (err) {
      setError(cleanError(err));
      setBusy(false);
    }
  };

  const stop = () => {
    void window.hf.chat.freeStop(activeId);
    setBusy(false);
    setStreaming('');
    setToolStatus('');
  };

  const proactive = async () => {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const result = await window.hf.chat.freeProactive(activeId);
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
      if (result?.threadId) {
        const state = await window.hf.chat.freeState();
        setThreads(state.threads || []);
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
  const activeThread = threads.find((t) => t.id === activeId) || null;
  const activeItem = activeThread?.itemId ? items.find((i) => i.id === activeThread.itemId) || null : null;
  const activeCharacter = activeItem ? characters.find((c) => c.id === activeItem.characterId) || null : null;
  const scheduleText = config?.dailyChatEnabled !== false
    ? `每天 ${config?.dailyChatTime || '22:00'} 主动来找你`
    : '主动话题已关闭';

  const threadPanel = (withClose: boolean) => (
    <>
      <div className="thread-head">
        <div className="block-title">对话记录</div>
        <div className="thread-head-actions">
          <button type="button" className="thread-new" onClick={() => void newThread()}>
            <IconPlus size={13} /> 新建
          </button>
          {withClose && (
            <button type="button" className="icon-button" onClick={() => setDrawerOpen(false)} aria-label="关闭">
              <IconX size={18} />
            </button>
          )}
        </div>
      </div>

      {renamingId ? (
        <div className="thread-rename">
          <input
            className="input"
            value={renameValue}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commitRename();
              if (e.key === 'Escape') setRenamingId(null);
            }}
            onBlur={() => void commitRename()}
            maxLength={60}
          />
        </div>
      ) : null}

      <ThreadList
        threads={threads}
        activeId={activeId}
        onSelect={(id) => void selectThread(id)}
        onRename={beginRename}
        onDelete={(thread) => void deleteThread(thread)}
      />
    </>
  );

  const sidebar = (
    <>
      {threadPanel(false)}

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
        <div className="block-title">她的记忆</div>
        <p className="muted small">管理员可以在聊天里翻阅全部上贡记录，也可以由你主动打开记忆库。</p>
        <button className="text-button" onClick={onOpenMemory}>
          <IconBook size={14} /> 打开记忆库 <IconChevronRight size={12} />
        </button>
      </div>

      {recent.length > 0 && (
        <div className="freechat-side-block">
          <div className="block-title">最近摆弄的</div>
          {recent.map((item) => (
            <div className="freechat-recent" key={item.id}>
              <span className="freechat-recent-cover">
                <img src={photoUrl(itemCover(item), true)} alt="" loading="lazy" />
              </span>
              <span>
                <strong>{item.name}</strong>
                <small>{formatMoney(item.purchasePrice ?? item.originalPrice)}</small>
              </span>
            </div>
          ))}
        </div>
      )}

      {lastProactiveAt && (
        <div className="freechat-side-note">
          <IconHeart size={12} /> 上次主动：{formatDateCN(formatTime(lastProactiveAt).slice(0, 10))} {formatTime(lastProactiveAt).slice(11)}
        </div>
      )}
    </>
  );

  return (
    <div className="page freechat-page">
      <header className="freechat-head">
        <div className="freechat-identity">
          <ManagerAvatar src={avatar} className="freechat-avatar" />
          <div>
            <div className="eyebrow">THE MANAGER</div>
            <h1>收藏室管理员</h1>
            <p>替你打理仓库、记旧账，也陪你聊那些不好意思跟别人说的话。</p>
          </div>
        </div>
        <div className="freechat-head-actions">
          <span className="freechat-schedule"><IconClock size={13} /> {scheduleText}</span>
          <button className="btn btn-soft thread-drawer-trigger" onClick={() => setDrawerOpen(true)}>
            <IconChat size={15} /> 历史
          </button>
          <button className="btn btn-soft" onClick={() => void proactive()} disabled={busy || !apiKeySet}>
            <IconSparkles size={15} /> 让她挑个话题
          </button>
          <button className="icon-button" onClick={onOpenSettings} title="设置"><IconSettings size={17} /></button>
        </div>
      </header>

      <div className="freechat-layout">
        <aside className="freechat-side">
          {sidebar}
        </aside>

        {drawerOpen && createPortal(
          <div className="thread-drawer-mask" onClick={() => setDrawerOpen(false)}>
            <div className="thread-drawer" onClick={(event) => event.stopPropagation()}>
              {threadPanel(true)}
            </div>
          </div>,
          document.body
        )}

        <section className="freechat-panel">
          <header className="chat-head">
            <ManagerAvatar src={avatar} className="chat-avatar" />
            <div className="chat-head-text">
              <strong>收藏室管理员</strong>
              <span><span className="online-dot" /> {busy ? '正在说话…' : '在线'}</span>
            </div>
            {activeThread && (
              <span className="chat-thread-title" title={activeThread.title}>{activeThread.title}</span>
            )}
            <span className="phase-chip freechat-chip"><IconChat size={12} /> 日常</span>
          </header>

          {activeItem && (
            <div className="chat-item-banner">
              <span className="chat-item-cover">
                <img src={photoUrl(itemCover(activeItem), true)} alt="" />
              </span>
              <div>
                <strong>{activeItem.name}</strong>
                <small>
                  {activeCharacter
                    ? `${activeCharacter.name}${activeCharacter.source ? ` · 《${activeCharacter.source}》` : ''}`
                    : '未关联角色'}
                </small>
              </div>
            </div>
          )}

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
                <ManagerAvatar src={avatar} className="freechat-welcome-mark" />
                <h2>收藏室的日常</h2>
                <p>不是上贡流程。聊聊收藏、尾款、旧事，或者今天的心情。<br />管理员记得你们之间发生过的事。</p>
              </div>
            ) : null}

            {messages.map((message) => (
              <div key={message.id} className={`message-row ${message.role}`}>
                {message.role === 'assistant' && <ManagerAvatar src={avatar} className="message-avatar" glyph="管" />}
                <div className="message-body">
                  <div className="message-name">{message.role === 'assistant' ? '管理员' : userName}</div>
                  <div className="message-bubble">{message.content}</div>
                </div>
              </div>
            ))}

            {streaming && (
              <div className="message-row assistant">
                <ManagerAvatar src={avatar} className="message-avatar" />
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
                <ManagerAvatar src={avatar} className="message-avatar" />
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
                  <button className="text-button" onClick={() => void startGeneration(activeId)}>重试</button>
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
