import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, Config, Phase, RitualState } from '../types';
import {
  PHASES, PHASE_META, formatDateCN, formatMoney, photoUrl, shotLabel, statusLabel, typeLabel,
} from '../constants';
import { cleanError, cx } from '../utils';
import { ManagerAvatar, Modal, PhotoLightbox, Spinner, TypingDots, confirmDialog } from '../components/ui';
import {
  IconAlert, IconArrowLeft, IconCalendar, IconCheck, IconChevronRight, IconCircleCheck,
  IconClock, IconHeart, IconImage, IconSend, IconSparkles, IconStop, IconX,
} from '../icons';

const TOOL_LABELS: Record<string, string> = {
  view_item_photos: '查看藏品照片',
  search_memory: '翻找旧记忆',
  read_memory: '重读某段对话',
  list_events: '翻阅上贡日历',
  read_item: '查看周边资料',
  list_collection: '清点收藏室',
};

function typingLabel(name: string | undefined): string {
  return TOOL_LABELS[name || ''] || '翻找记忆';
}

function Stepper({ state }: { state: RitualState }) {
  return (
    <div className="stepper">
      {PHASES.map((phase, index) => {
        const record = state.phases?.[phase];
        const status = record?.status || 'pending';
        const active = state.phase === phase && state.status !== 'complete';
        return (
          <div
            key={phase}
            className={cx('step', `phase-${phase}`, active && 'active', status === 'done' && 'done', status === 'skipped' && 'skipped')}
          >
            <span className={cx('step-dot', active && 'pulse')}>
              {status === 'done' ? <IconCheck size={11} /> : index + 1}
            </span>
            <span className="step-label">{PHASE_META[phase].label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function RitualPage({
  initialState,
  autoOpen,
  config,
  apiKeySet,
  narrow,
  onExit,
  onRefreshData,
  onOpenSettings,
  onViewToday,
  toast,
}: {
  initialState: RitualState;
  autoOpen: boolean;
  config: Config | null;
  apiKeySet: boolean;
  narrow: boolean;
  onExit: () => void;
  onRefreshData: () => Promise<void> | void;
  onOpenSettings: () => void;
  onViewToday: () => void;
  toast: (text: string, kind?: 'ok' | 'error' | 'info') => void;
}) {
  const [state, setState] = useState<RitualState>(initialState);
  const [messages, setMessages] = useState<ChatMessage[]>(initialState.session?.messages || []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [error, setError] = useState('');
  const [toolStatus, setToolStatus] = useState('');
  const [opening, setOpening] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [instigateOpen, setInstigateOpen] = useState(false);
  const [lastSummary, setLastSummary] = useState('');
  const [photoIndex, setPhotoIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [showIntro, setShowIntro] = useState(!initialState.session);

  const activeSessionRef = useRef<string | null>(initialState.session?.id || null);
  const stickRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeSessionId = state.session?.id || null;
  const day = state.day;
  const photos = state.item?.photos || [];
  const mainPhoto = photos[photoIndex] || photos[0];
  const isComplete = state.status === 'complete';
  const lastMessage = messages[messages.length - 1];
  const canRetry = !busy && (messages.length === 0 || lastMessage?.role === 'user');

  const userName = (config?.userName || '').trim() || '杂鱼';
  const phaseMeta = state.phase ? PHASE_META[state.phase] : null;
  const currentStepIndex = state.phase ? PHASES.indexOf(state.phase) : -1;

  const applyState = (next: RitualState) => {
    setState(next);
    setMessages(next.session?.messages ? [...next.session.messages] : []);
    setStreaming('');
    setBusy(false);
    setError('');
    setToolStatus('');
    setPhotoIndex(0);
    activeSessionRef.current = next.session?.id || null;
    setShowIntro(!next.session);
  };

  const startGeneration = (sessionId: string) => {
    activeSessionRef.current = sessionId;
    setBusy(true);
    setStreaming('');
    setError('');
    setToolStatus('');
    window.hf.chat.generate(sessionId).catch((err) => {
      setBusy(false);
      setError(cleanError(err));
    });
  };

  const considerGenerate = (session: NonNullable<RitualState['session']>) => {
    const last = session.messages[session.messages.length - 1];
    if (!session.messages.length || last?.role === 'user') {
      startGeneration(session.id);
    }
  };

  useEffect(() => {
    const off = window.hf.onEvent((event) => {
      if (event.sessionId !== activeSessionRef.current) return;
      switch (event.type) {
        case 'chat:start':
          setBusy(true);
          setError('');
          setStreaming('');
          break;
        case 'chat:delta':
          setStreaming((prev) => prev + String(event.text || ''));
          break;
        case 'chat:reset':
          setStreaming(String(event.text || ''));
          break;
        case 'chat:tool':
          if (event.status === 'running') setToolStatus(`正在${typingLabel(String(event.name))}…`);
          else setToolStatus('');
          break;
        case 'chat:done': {
          const message = event.message as ChatMessage;
          setMessages((prev) => [...prev, message]);
          setStreaming('');
          setBusy(false);
          setToolStatus('');
          break;
        }
        case 'chat:error':
          setError(String(event.message || '管理员卡住了。'));
          setBusy(false);
          setStreaming('');
          setToolStatus('');
          break;
        case 'chat:stopped':
          setBusy(false);
          setStreaming('');
          setToolStatus('');
          toast('已经让她停下了。', 'info');
          break;
        default:
          break;
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyState(initialState);
    if (initialState.session) {
      considerGenerate(initialState.session);
    } else if (autoOpen && apiKeySet && initialState.status === 'in_progress' && initialState.phase) {
      void openPhase();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!stickRef.current) return;
    const el = scrollRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages, streaming, busy, toolStatus, error]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(160, Math.max(40, el.scrollHeight))}px`;
  }, [input]);

  const openPhase = async () => {
    if (opening) return;
    setOpening(true);
    setError('');
    try {
      const result = await window.hf.ritual.open(day);
      if (result.empty) {
        toast(result.message || '今天没有可以上贡的周边。', 'info');
        onExit();
        return;
      }
      applyState(result.state);
      if (result.state.session) {
        considerGenerate(result.state.session);
      }
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setOpening(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy || !activeSessionId || finishing) return;
    setInput('');
    setError('');
    try {
      const message = await window.hf.chat.send(activeSessionId, text);
      setMessages((prev) => [...prev, message]);
      startGeneration(activeSessionId);
    } catch (err) {
      setError(cleanError(err));
      setInput(text);
    }
  };

  const stop = () => {
    if (!activeSessionId) return;
    window.hf.chat.stop(activeSessionId);
    setBusy(false);
    setStreaming('');
    setToolStatus('');
  };

  const doFinish = async (payload?: { ordered: boolean; targetStatus?: 'pending' | 'owned' }) => {
    if (!activeSessionId || finishing) return;
    setConfirmFinish(false);
    setInstigateOpen(false);
    setFinishing(true);
    setError('');
    try {
      const result = payload
        ? await window.hf.ritual.instigate(day, activeSessionId, payload.ordered, payload.targetStatus)
        : await window.hf.ritual.finish(day, activeSessionId);
      setLastSummary(result.summary || '');
      applyState(result.state);
      setShowIntro(true);
      await onRefreshData();
      if (result.state.status === 'complete') {
        toast('今日份上贡完毕。', 'ok');
      } else if (payload?.ordered && payload.targetStatus === 'owned') {
        const hasFull = state.item?.photos?.some((p) => p.shot === 'full');
        toast(hasFull ? '下单成功，直接归入已拥有。' : '下单成功，已归入已拥有——记得补一张全身照。', 'ok');
      } else if (payload?.ordered) {
        toast('下单成功，她进入待补款了。', 'ok');
      } else if (payload && !payload.ordered) {
        toast('她还在购物车里。记忆替你留着。', 'info');
      }
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setFinishing(false);
    }
  };

  const requestFinish = () => {
    if (!messages.length) {
      toast('她还没开口呢，等一句再结束。', 'info');
      return;
    }
    if (!messages.some((m) => m.role === 'user')) {
      toast('先回她一句，把这一轮聊起来再结束。', 'info');
      return;
    }
    if (state.phase === 'instigate') {
      setInstigateOpen(true);
      return;
    }
    setConfirmFinish(true);
  };

  const skipPhase = async () => {
    const ok = await confirmDialog({
      title: '跳过这个阶段？',
      message: '这段对话会直接归档，不再继续。',
      confirmText: '跳过',
    });
    if (!ok) return;
    setFinishing(true);
    try {
      const result = await window.hf.ritual.skip(day);
      applyState(result.state);
      setShowIntro(true);
      await onRefreshData();
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setFinishing(false);
    }
  };

  if (isComplete) {
    return (
      <div className="page ritual-complete">
        <div className="complete-stamp">
          <IconCheck size={34} />
          <span>贡</span>
        </div>
        <div className="eyebrow">TODAY&apos;S OFFERING · COMPLETE</div>
        <h1>今日份上贡完毕</h1>
        <p className="complete-sub">
          {formatDateCN(state.day)}。灰尘擦过了，欲望说过了，购物车也翻过了。
          {lastSummary ? ' 管理员会记得今天。' : ''}
        </p>
        <div className="complete-phases">
          {PHASES.map((phase) => {
            const record = state.phases?.[phase];
            const progress = state.progress.find((p) => p.phase === phase);
            return (
              <div key={phase} className={cx('complete-phase', record?.status || 'pending')}>
                <span className={cx('pill', `phase-${phase}`)}>{PHASE_META[phase].label}</span>
                <span className="complete-phase-name">
                  {record?.status === 'skipped' ? '（跳过）' : progress?.itemName || '没有对象'}
                </span>
                {record?.status === 'done' ? <IconCheck size={15} /> : <span className="muted">—</span>}
              </div>
            );
          })}
        </div>
        <div className="complete-actions">
          <button type="button" className="btn btn-primary" onClick={onExit}>
            <IconArrowLeft size={16} /> 回到首页
          </button>
          <button type="button" className="btn btn-soft" onClick={onViewToday}>
            <IconCalendar size={15} /> 回看今天
          </button>
        </div>
        <div className="muted small">明天再来。管理员会等。</div>
      </div>
    );
  }

  if (!state.phase) {
    return (
      <div className="page ritual-simple">
        <button type="button" className="btn btn-ghost" onClick={onExit}><IconArrowLeft size={16} /> 返回</button>
        <div className="ritual-simple-body">
          <IconClock size={34} />
          <h2>现在没有正在进行的阶段</h2>
          <p className="muted">回到首页，点「开始今日份上贡」重新开始。</p>
          <button type="button" className="btn btn-primary" onClick={onExit}>回首页</button>
        </div>
      </div>
    );
  }

  const introScreen = showIntro || !state.session;

  return (
    <div className={cx('ritual-shell', `phase-${state.phase}`)}>
      <header className="ritual-top">
        <button type="button" className="icon-btn" onClick={onExit} title="离开" aria-label="离开">
          <IconArrowLeft size={19} />
        </button>
        <Stepper state={state} />
        {!narrow && <div className="ritual-day">{formatDateCN(state.day)}</div>}
      </header>

      {introScreen ? (
        <div className="page ritual-intro">
          <div className={cx('panel intro-card', `phase-${state.phase}`)}>
            <div className="intro-side">
              <span className="intro-num">0{currentStepIndex + 1}</span>
              <span className="intro-cn">{phaseMeta?.label}</span>
            </div>
            <div className="intro-main">
              <div className="eyebrow">{phaseMeta?.label.toUpperCase()} STAGE</div>
              <h1>
                {state.phase === 'wipe'
                  ? '把灰尘擦掉，也把嘴张开。'
                  : state.phase === 'fantasy'
                    ? '她还没到，但你可以先想。'
                    : '她还在购物车里，等你一句话。'}
              </h1>
              <p>{phaseMeta?.desc}</p>
              <div className="intro-meta">
                <span><IconSparkles size={14} /> 本轮对象：{state.eligible[state.phase]} 件</span>
                <span><IconHeart size={14} /> 管理员会先开口</span>
              </div>
              {lastSummary && (
                <div className="callout">
                  <div className="callout-title">上一段，管理员记住了</div>
                  <p>{lastSummary}</p>
                </div>
              )}
              <div className="intro-actions">
                <button type="button" className="btn btn-primary" onClick={() => void openPhase()} disabled={opening || !apiKeySet}>
                  {opening ? <Spinner size={16} /> : <IconSparkles size={16} />}
                  {opening ? '正在挑一款…' : `开始${phaseMeta?.label}`}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void skipPhase()} disabled={opening || finishing}>
                  跳过本阶段
                </button>
              </div>
              {!apiKeySet && (
                <button type="button" className="banner banner-rose" onClick={onOpenSettings}>
                  <IconAlert size={14} />
                  <span>还没配置 API Key，管理员开不了口</span>
                  <span className="banner-cta">去设置 <IconChevronRight size={13} /></span>
                </button>
              )}
              {error && <div className="chat-error"><IconAlert size={15} /><span>{error}</span></div>}
              <div className="muted small">
                <IconClock size={12} /> 开始后管理员先开口。你说一句，管理员接一句，直到你亲手结束。
              </div>
            </div>
          </div>

          <div className="intro-phases">
            {PHASES.map((phase, index) => {
              const record = state.phases?.[phase];
              const active = state.phase === phase;
              return (
                <div key={phase} className={cx('intro-phase', active && 'active', record?.status)}>
                  <span className="intro-phase-index">0{index + 1}</span>
                  <div>
                    <strong>{PHASE_META[phase].label}</strong>
                    <p>{PHASE_META[phase].desc}</p>
                  </div>
                  <span className="intro-phase-state">
                    {record?.status === 'done' ? '已完成' : record?.status === 'skipped' ? '已跳过' : active ? '当前' : '待开始'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="ritual-body">
          {!narrow && (
            <aside className="ritual-item">
              <div className="ritual-gallery">
                {mainPhoto ? (
                  <button type="button" className="ritual-photo" onClick={() => setLightbox(true)}>
                    <img src={photoUrl(mainPhoto.file)} alt={state.item?.name || ''} />
                    <span className="detail-tag">{shotLabel(mainPhoto.shot)}</span>
                  </button>
                ) : (
                  <div className="ritual-photo empty"><IconImage size={28} /></div>
                )}
                {photos.length > 1 && (
                  <div className="ritual-thumbs">
                    {photos.map((photo, index) => (
                      <button
                        type="button"
                        key={photo.id}
                        className={cx(index === photoIndex && 'active')}
                        onClick={() => setPhotoIndex(index)}
                        title={photo.caption || shotLabel(photo.shot)}
                      >
                        <img src={photoUrl(photo.thumbFile || photo.file, true)} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="ritual-info">
                <span className={cx('pill', `tone-${state.item?.status}`)}>
                  {statusLabel(state.item?.status)} · {typeLabel(state.item?.type)}
                </span>
                <h2>{state.item?.name}</h2>
                {state.item?.series && (
                  <div className="muted small">{state.item.series}{state.item.scale ? ` · ${state.item.scale}` : ''}</div>
                )}
                <div className="price-strip">
                  <div><span>购入</span><b>{formatMoney(state.item?.purchasePrice ?? state.item?.originalPrice)}</b></div>
                  <div><span>定金</span><b>{formatMoney(state.item?.deposit)}</b></div>
                  <div><span>尾款</span><b>{formatMoney(state.item?.balance)}</b></div>
                  {state.item?.dueDate && <div><span>补款</span><b>{state.item.dueDate.slice(5)}</b></div>}
                </div>
                {(state.item?.thought || state.item?.intro) && (
                  <div className="callout">
                    <div className="callout-title">你最初写的</div>
                    <p>{state.item.thought || state.item.intro}</p>
                  </div>
                )}
                <div className="muted small"><IconHeart size={12} /> 管理员记得你们所有的过去</div>
              </div>
            </aside>
          )}

          <section className="chat-main">
            <header className="chat-head">
              <ManagerAvatar src={config?.managerAvatar} />
              <div className="chat-head-text">
                <strong>收藏室管理员</strong>
                <span><span className="online-dot" /> {busy ? '正在说话…' : '在线，替你看着仓库'}</span>
              </div>
              {narrow && mainPhoto && (
                <button type="button" className="ritual-mini-item" onClick={() => setLightbox(true)}>
                  <img src={photoUrl(mainPhoto.thumbFile || mainPhoto.file, true)} alt="" />
                  <span>{state.item?.name}</span>
                </button>
              )}
              <span className={cx('pill', `phase-${state.phase}`)}>{phaseMeta?.label}</span>
            </header>

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
              <div className="chat-start-note">
                <strong>今日份上贡 · {phaseMeta?.label}{narrow && state.item ? ` · ${state.item.name}` : ''}</strong>
                <p>管理员先开口。你可以慢慢回，也可以在管理员说完后结束这一阶段。</p>
              </div>

              {messages.map((message) => (
                <div key={message.id} className={cx('msg', message.role)}>
                  {message.role === 'assistant' && <ManagerAvatar src={config?.managerAvatar} className="msg-avatar" />}
                  <div className="msg-body">
                    <div className="msg-who">{message.role === 'assistant' ? '管理员' : userName}</div>
                    <div className="msg-bubble">{message.content}</div>
                  </div>
                </div>
              ))}

              {streaming && (
                <div className="msg assistant">
                  <ManagerAvatar src={config?.managerAvatar} className="msg-avatar" />
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
                <div className="msg assistant">
                  <ManagerAvatar src={config?.managerAvatar} className="msg-avatar" />
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
                  {canRetry && (
                    <button type="button" className="link" onClick={() => startGeneration(activeSessionId || '')}>重试</button>
                  )}
                </div>
              )}
            </div>

            <div className="composer-wrap">
              <div className="composer">
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
                  placeholder={busy ? '等管理员说完…' : '对管理员说点什么…'}
                  disabled={busy || finishing}
                  rows={1}
                />
                {busy ? (
                  <button type="button" className="send-btn stop" onClick={stop} title="让她停下" aria-label="停下">
                    <IconStop size={16} />
                  </button>
                ) : (
                  <button type="button" className="send-btn" onClick={() => void send()} disabled={!input.trim() || finishing} title="发送" aria-label="发送">
                    <IconSend size={16} />
                  </button>
                )}
              </div>
              <div className="composer-foot">
                <button type="button" className="link muted" onClick={() => void skipPhase()} disabled={finishing || busy}>
                  跳过本阶段
                </button>
                <button type="button" className="btn btn-soft btn-sm" onClick={requestFinish} disabled={finishing || busy}>
                  <IconCircleCheck size={15} /> {phaseMeta?.finish}
                </button>
              </div>
            </div>

            {finishing && (
              <div className="ritual-finishing">
                <div className="panel finishing-card">
                  <Spinner size={22} />
                  <strong>正在封存这一轮…</strong>
                  <span className="muted small">管理员会把今天的对话记进关于「{state.item?.name}」的记忆里。</span>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {confirmFinish && (
        <Modal size="sm" onClose={() => setConfirmFinish(false)} className="confirm-sheet">
          <div className="confirm">
            <div className="confirm-icon"><IconCircleCheck size={24} /></div>
            <h3>{phaseMeta?.label}结束了？</h3>
            <p className="confirm-message">这一轮对话会归档到「{state.item?.name}」的记忆里，管理员以后会记得。之后自动进入下一阶段。</p>
            <div className="confirm-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmFinish(false)}>再多说两句</button>
              <button type="button" className="btn btn-primary" onClick={() => void doFinish()}>
                <IconCheck size={15} /> 封存并继续
              </button>
            </div>
          </div>
        </Modal>
      )}

      {instigateOpen && (
        <Modal size="sm" onClose={() => setInstigateOpen(false)}>
          <div className="instigate">
            <div className="instigate-head">
              <span className="pill phase-instigate">教唆</span>
              <button type="button" className="icon-btn sm" onClick={() => setInstigateOpen(false)} aria-label="关闭">
                <IconX size={17} />
              </button>
            </div>
            <h3>她下单了吗？</h3>
            <p className="muted small">「{state.item?.name}」的去留，就看你这一句话。</p>
            <div className="instigate-options">
              <button type="button" className="instigate-option" onClick={() => void doFinish({ ordered: true, targetStatus: 'pending' })}>
                <span className="instigate-glyph">待</span>
                <span><strong>下单了 · 等补款</strong><small>移入待补款，下次意淫她</small></span>
                <IconChevronRight size={16} />
              </button>
              <button type="button" className="instigate-option" onClick={() => void doFinish({ ordered: true, targetStatus: 'owned' })}>
                <span className="instigate-glyph">所</span>
                <span><strong>下单了 · 已经到手</strong><small>直接归入已拥有</small></span>
                <IconChevronRight size={16} />
              </button>
              <button type="button" className="instigate-option quiet" onClick={() => void doFinish({ ordered: false })}>
                <span className="instigate-glyph">观</span>
                <span><strong>还没 · 继续观望</strong><small>保持原样，这段记忆留着</small></span>
                <IconChevronRight size={16} />
              </button>
            </div>
            <button type="button" className="link muted" onClick={() => setInstigateOpen(false)}>再回去聊聊</button>
          </div>
        </Modal>
      )}

      {lightbox && photos.length > 0 && (
        <PhotoLightbox photos={photos} startIndex={photoIndex} onClose={() => setLightbox(false)} />
      )}
    </div>
  );
}
