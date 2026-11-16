import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Character, ChatMessage, ChatThreadSummary, Config, FreeChatState, Item } from '../types';
import { itemCover, photoUrl } from '../constants';
import { loadImage, readFileAsDataUrl, resizeDataUrl } from '../image';
import { cleanError, cx, groupThreads } from '../utils';
import { ImageLightbox, ManagerAvatar, Modal, Spinner, TypingDots, confirmDialog } from '../components/ui';
import { ChatLogModal } from '../components/ChatLogModal';
import {
  IconAlert, IconArrowLeft, IconBook, IconChat, IconChevronRight, IconClock, IconImage, IconMore,
  IconPencil, IconPlus, IconSend, IconSparkles, IconStop, IconTrash, IconX,
} from '../icons';

type ThreadListProps = {
  threads: ChatThreadSummary[];
  activeId: string;
  onSelect: (id: string) => void;
  onRename: (thread: ChatThreadSummary) => void;
  onDelete: (thread: ChatThreadSummary) => void;
};

function ThreadList({ threads, activeId, onSelect, onRename, onDelete }: ThreadListProps) {
  const [menu, setMenu] = useState<{ threadId: string; anchor: HTMLButtonElement } | null>(null);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupThreads(threads), [threads]);
  const menuThread = menu && threads.find((thread) => thread.id === menu.threadId);
  const menuOpen = Boolean(menuThread);

  useLayoutEffect(() => {
    const popup = menuRef.current;
    if (!menu || !popup) return;
    const { anchor } = menu;
    const rect = anchor.getBoundingClientRect();
    const padding = 8;
    const gap = 4;
    const left = Math.max(padding, Math.min(rect.right, window.innerWidth - padding) - popup.offsetWidth);
    const top = rect.bottom + gap + popup.offsetHeight <= window.innerHeight - padding
      ? rect.bottom + gap
      : Math.max(padding, rect.top - gap - popup.offsetHeight);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.querySelector('button')?.focus({ preventScroll: true });

    const close = () => setMenu(null);
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!popup.contains(event.target) && !anchor.contains(event.target)) close();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !popup.contains(event.target) && !anchor.contains(event.target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      anchor.focus({ preventScroll: true });
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu, menuOpen]);

  if (!threads.length) {
    return <div className="thread-empty">还没有对话。点上面的「新建」开一段。</div>;
  }

  return (
    <div className="thread-list">
      {groups.map((group) => (
        <div className="thread-group" key={group.key}>
          <div className="thread-group-label">{group.label}</div>
          {group.threads.map((thread) => {
            const isOpen = menuThread?.id === thread.id;
            return (
              <div key={thread.id} className={cx('thread-item', thread.id === activeId && 'active')}>
                <button
                  type="button"
                  className="thread-item-body"
                  aria-current={thread.id === activeId || undefined}
                  onClick={() => onSelect(thread.id)}
                >
                  <span className="thread-title">{thread.title}</span>
                  <span className="thread-preview">{thread.preview}</span>
                </button>
                <button
                  type="button"
                  className="thread-more"
                  aria-label={`「${thread.title}」的更多操作`}
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? menuId : undefined}
                  onClick={(event) => {
                    const anchor = event.currentTarget;
                    setMenu(isOpen ? null : { threadId: thread.id, anchor });
                  }}
                >
                  <IconMore size={14} />
                </button>
              </div>
            );
          })}
        </div>
      ))}
      {menuThread && createPortal(
        <div id={menuId} ref={menuRef} className="thread-menu">
          <button type="button" onClick={() => { setMenu(null); onRename(menuThread); }}>
            <IconPencil size={14} /> 重命名
          </button>
          <button type="button" className="danger" onClick={() => { setMenu(null); onDelete(menuThread); }}>
            <IconTrash size={14} /> 删除
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function ChatPage({
  config,
  items,
  characters,
  requestedThreadId,
  apiKeySet,
  narrow,
  onOpenSettings,
  onOpenItem,
  onBack,
  onStateChanged,
  onThreadSelected,
  toast,
}: {
  config: Config | null;
  items: Item[];
  characters: Character[];
  requestedThreadId: string | null;
  apiKeySet: boolean;
  narrow: boolean;
  onOpenSettings: () => void;
  onOpenItem: (item: Item) => void;
  onBack: () => void;
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
  const [renaming, setRenaming] = useState<ChatThreadSummary | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [attachments, setAttachments] = useState<{ id: number; name: string; src: string }[]>([]);
  const [readingImages, setReadingImages] = useState(0);
  const [sending, setSending] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachmentIdRef = useRef(0);
  const pendingImagesRef = useRef(0);
  const sendingRef = useRef(false);
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
      if (!result.started) {
        startedRef.current = false;
        setBusy(false);
      }
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
          if (event.status === 'running') {
            setToolStatus(event.name === 'view_item_photos' ? '正在查看藏品照片…' : '正在翻阅记忆与仓库…');
          }
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
    if (sending || !requestedThreadId || requestedThreadId === activeIdRef.current) return;
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
  }, [requestedThreadId, sending]);

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
    el.style.height = `${Math.min(150, Math.max(40, el.scrollHeight))}px`;
  }, [input]);

  const selectThread = async (threadId: string) => {
    if (sendingRef.current) return;
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
    if (sendingRef.current) return;
    switchTokenRef.current += 1;
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
    setRenaming(thread);
    setRenameValue(thread.title);
    setRenameError('');
  };

  const commitRename = async () => {
    const title = renameValue.trim();
    if (!renaming || !title || savingTitle) return;
    setSavingTitle(true);
    setRenameError('');
    try {
      setThreads(await window.hf.chat.freeRename(renaming.id, title));
      setRenaming(null);
      await onStateChanged();
    } catch (err) {
      setRenameError(cleanError(err));
    } finally {
      setSavingTitle(false);
    }
  };

  const deleteThread = async (thread: ChatThreadSummary) => {
    const ok = await confirmDialog({
      title: `删掉「${thread.title}」这段对话？`,
      message: '聊天内容不会进记忆库，管理员也不会再记得它。',
      confirmText: '删除',
      danger: true,
    });
    if (!ok || sendingRef.current) return;
    try {
      const result = await window.hf.chat.freeDelete(thread.id);
      applyState(result.state);
      await onStateChanged();
      toast('对话已删除。', 'info');
    } catch (err) {
      setError(cleanError(err));
    }
  };

  const addImages = async (files: File[]) => {
    if (!files.length || sendingRef.current) return;
    pendingImagesRef.current += 1;
    setReadingImages(pendingImagesRef.current);
    const images: typeof attachments = [];
    try {
      for (const file of files) {
        const name = file.name || '剪贴板图片';
        try {
          if (file.size > 60 * 1024 * 1024) throw new Error('单张图片不能超过 60MB。');
          const image = await loadImage(await readFileAsDataUrl(file));
          images.push({ id: ++attachmentIdRef.current, name, src: resizeDataUrl(image, 1400, 0.84) });
        } catch (err) {
          toast(`${name}：${cleanError(err)}`, 'error');
        }
      }
      setAttachments((current) => [...current, ...images]);
    } finally {
      pendingImagesRef.current -= 1;
      setReadingImages(pendingImagesRef.current);
    }
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && !attachments.length) || busy || !loaded || pendingImagesRef.current || sendingRef.current) return;
    const threadAtSend = activeIdRef.current;
    sendingRef.current = true;
    setSending(true);
    setError('');
    try {
      const result = await window.hf.chat.freeSend(text, threadAtSend || undefined, attachments.map((image) => image.src));
      setInput('');
      setAttachments([]);
      if (activeIdRef.current === threadAtSend) {
        activeIdRef.current = result.threadId;
        setActiveId(result.threadId);
        setMessages((current) => current.some((message) => message.id === result.message.id)
          ? current
          : [...current, result.message]);
        stickRef.current = true;
        setStreaming('');
        startedRef.current = false;
      }
      const started = await window.hf.chat.freeGenerate(false, result.threadId);
      if (!started.started && activeIdRef.current === result.threadId) setBusy(false);
    } catch (err) {
      setError(cleanError(err));
      setBusy(false);
    } finally {
      sendingRef.current = false;
      setSending(false);
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
          <button type="button" className="btn btn-soft btn-sm" onClick={() => void newThread()}>
            <IconPlus size={13} /> 新建
          </button>
          {withClose && (
            <button type="button" className="icon-btn sm" onClick={() => setDrawerOpen(false)} aria-label="关闭">
              <IconX size={17} />
            </button>
          )}
        </div>
      </div>

      <ThreadList
        threads={threads}
        activeId={activeId}
        onSelect={(id) => void selectThread(id)}
        onRename={beginRename}
        onDelete={(thread) => void deleteThread(thread)}
      />
    </>
  );

  return (
    <div className="chat-shell">
      {!narrow && (
        <aside className="chat-side">{threadPanel(false)}</aside>
      )}

      {narrow && drawerOpen && createPortal(
        <div className="drawer-mask" onPointerDown={(e) => { if (e.target === e.currentTarget) setDrawerOpen(false); }}>
          <div className="drawer">
            {threadPanel(true)}
          </div>
        </div>,
        document.body
      )}

      <section className="chat-main">
        <header className="chat-head">
          {narrow && (
            <button type="button" className="icon-btn" onClick={onBack} aria-label="返回">
              <IconArrowLeft size={19} />
            </button>
          )}
          <ManagerAvatar src={avatar} />
          <div className="chat-head-text">
            <strong>收藏室管理员</strong>
            <span><span className="online-dot" /> {busy ? '正在说话…' : '在线'}</span>
          </div>
          <div className="chat-head-actions">
            {narrow && (
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setDrawerOpen(true)}>
                <IconChat size={14} /> 历史
              </button>
            )}
            <button type="button" className="btn btn-soft btn-sm" onClick={() => void proactive()} disabled={busy || !apiKeySet}>
              <IconSparkles size={14} /> {narrow ? '挑话题' : '让她挑个话题'}
            </button>
            <button type="button" className="btn btn-soft btn-sm" onClick={() => setLogOpen(true)} disabled={!loaded}>
              <IconBook size={14} /> 日志
            </button>
          </div>
        </header>

        {activeItem && (
          <button type="button" className="chat-item-banner" onClick={() => onOpenItem(activeItem)}>
            <img src={photoUrl(itemCover(activeItem), true)} alt="" />
            <span>
              <strong>{activeItem.name}</strong>
              <small>
                {activeCharacter
                  ? `${activeCharacter.name}${activeCharacter.source ? ` · 《${activeCharacter.source}》` : ''}`
                  : '点击查看周边详情'}
              </small>
            </span>
            <IconChevronRight size={15} />
          </button>
        )}

        {!apiKeySet && (
          <button type="button" className="banner banner-rose" onClick={onOpenSettings}>
            <IconAlert size={15} />
            <span>还没有配置 DeepSeek API Key，管理员现在说不了话。</span>
            <span className="banner-cta">去设置 <IconChevronRight size={13} /></span>
          </button>
        )}

        <div
          className="chat-scroll"
          ref={scrollRef}
          onScroll={() => {
            const el = scrollRef.current;
            if (!el) return;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
          }}
        >
          {!loaded ? (
            <div className="sheet-loading"><Spinner /> 正在打开管理员的记录…</div>
          ) : !messages.length && !busy ? (
            <div className="chat-welcome">
              <ManagerAvatar src={avatar} className="avatar-xl" />
              <h2>收藏室的日常</h2>
              <p>不是上贡流程。聊聊收藏、尾款、旧事，或者今天的心情。<br />管理员记得你们之间发生过的事。</p>
            </div>
          ) : null}

          {messages.map((message) => {
            const images = Array.isArray(message.images)
              ? message.images.filter((src) => typeof src === 'string' && src.startsWith('data:image/jpeg;base64,'))
              : [];
            return (
              <div key={message.id} className={cx('msg', message.role)}>
                {message.role === 'assistant' && <ManagerAvatar src={avatar} className="msg-avatar" />}
                <div className="msg-body">
                  <div className="msg-who">{message.role === 'assistant' ? '管理员' : userName}</div>
                  {images.length > 0 && (
                    <div className="message-images">
                      {images.map((src, index) => (
                        <button
                          type="button"
                          key={index}
                          onClick={() => setLightbox({ images, index })}
                          aria-label={`查看图片 ${index + 1}`}
                        >
                          <img src={src} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                  {message.content && <div className="msg-bubble">{message.content}</div>}
                </div>
              </div>
            );
          })}

          {streaming && (
            <div className="msg assistant">
              <ManagerAvatar src={avatar} className="msg-avatar" />
              <div className="msg-body">
                <div className="msg-who">管理员</div>
                <div className="msg-bubble streaming">
                  {streaming}
                  <span className="stream-caret" />
                </div>
              </div>
            </div>
          )}

          {busy && !streaming && (
            <div className="msg assistant is-typing">
              <ManagerAvatar src={avatar} className="msg-avatar" />
              <div className="msg-body">
                <div className="msg-bubble typing-bubble"><TypingDots /></div>
              </div>
            </div>
          )}

          {toolStatus && <div className="tool-chip"><Spinner size={12} /> {toolStatus}</div>}

          {error && (
            <div className="chat-error">
              <IconAlert size={16} />
              <span>{error}</span>
              {last?.role === 'user' && !busy && (
                <button type="button" className="link" onClick={() => void startGeneration(activeId)}>重试</button>
              )}
            </div>
          )}
        </div>

        <div className="composer-wrap">
          <div className="composer chat-composer">
            {attachments.length > 0 && (
              <div className="composer-images">
                {attachments.map((image) => (
                  <div key={image.id} className="composer-image" title={image.name}>
                    <img src={image.src} alt={image.name} />
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => setAttachments((current) => current.filter((item) => item.id !== image.id))}
                      aria-label={`移除 ${image.name}`}
                    >
                      <IconX size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
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
              onPaste={(e) => {
                const images = Array.from(e.clipboardData.files).filter((file) => file.type.startsWith('image/'));
                if (!images.length) return;
                e.preventDefault();
                void addImages(images);
              }}
              placeholder={busy ? '等管理员说完…' : '和管理员说点什么…'}
              disabled={busy || sending}
              rows={1}
            />
            <div className="composer-tools">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.currentTarget.files || []);
                  e.currentTarget.value = '';
                  void addImages(files);
                }}
              />
              <button
                type="button"
                className="icon-btn composer-upload"
                onClick={() => fileRef.current?.click()}
                disabled={busy || sending}
                title="上传图片"
                aria-label="上传图片"
              >
                <IconImage size={18} />
              </button>
              {readingImages > 0 && <span className="composer-reading" role="status"><Spinner size={13} /> 正在读取图片</span>}
              {busy ? (
                <button type="button" className="send-btn stop" onClick={stop} title="让她停下" aria-label="停下">
                  <IconStop size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  className="send-btn"
                  onClick={() => void send()}
                  disabled={!loaded || sending || readingImages > 0 || (!input.trim() && !attachments.length)}
                  title="发送"
                  aria-label="发送"
                >
                  <IconSend size={16} />
                </button>
              )}
            </div>
          </div>
          <div className="composer-foot">
            <span><IconClock size={12} /> {scheduleText}</span>
            <span>管理员可以翻阅全部上贡记忆</span>
          </div>
        </div>
      </section>

      {logOpen && <ChatLogModal key={activeId} threadId={activeId} onClose={() => setLogOpen(false)} />}

      {renaming && (
        <Modal
          size="sm"
          titleId="thread-rename-title"
          onClose={() => { if (!savingTitle) setRenaming(null); }}
        >
          <form className="confirm thread-rename" onSubmit={(event) => { event.preventDefault(); void commitRename(); }}>
            <h3 id="thread-rename-title">重命名对话</h3>
            <input
              className="input"
              aria-label="对话名称"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onFocus={(event) => event.target.select()}
              maxLength={60}
              disabled={savingTitle}
              autoFocus
            />
            {renameError && <p className="chat-error" role="alert">{renameError}</p>}
            <div className="confirm-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setRenaming(null)} disabled={savingTitle}>取消</button>
              <button type="submit" className="btn btn-primary" disabled={savingTitle || !renameValue.trim()}>保存</button>
            </div>
          </form>
        </Modal>
      )}

      {lightbox && (
        <ImageLightbox
          images={lightbox.images.map((src, index) => ({ src, caption: `聊天图片 ${index + 1}` }))}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
