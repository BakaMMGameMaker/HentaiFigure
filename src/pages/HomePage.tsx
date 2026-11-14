import { useEffect, useMemo, useState } from 'react';
import type { AppInfo, Config, FreeChatState, Item, ItemStatus, RitualState, UpdateInfo } from '../types';
import {
  PHASES, PHASE_META, STATUS_META, formatMoney, itemCover, pendingTail, photoUrl,
  pickGreeting, totalSpent,
} from '../constants';
import {
  IconAlert, IconCamera, IconCheck, IconChevronRight, IconCircleCheck, IconChat, IconClock, IconPlus,
  IconRefresh, IconSettings, IconSparkles,
} from '../icons';

export function HomePage({
  items,
  todayState,
  config,
  appInfo,
  updateInfo,
  freeChat,
  onAdd,
  onStart,
  onResume,
  onViewToday,
  onOpenSettings,
  onGoCollection,
  onUpdateClick,
  onOpenChat,
}: {
  items: Item[];
  todayState: RitualState | null;
  config: Config | null;
  appInfo: AppInfo | null;
  updateInfo: UpdateInfo | null;
  freeChat: FreeChatState | null;
  onAdd: () => void;
  onStart: () => void;
  onResume: () => void;
  onViewToday: () => void;
  onOpenSettings: () => void;
  onGoCollection: (status?: ItemStatus) => void;
  onUpdateClick: () => void;
  onOpenChat: () => void;
}) {
  const counts = todayState?.counts || {
    owned: items.filter((i) => i.status === 'owned').length,
    pending: items.filter((i) => i.status === 'pending').length,
    watching: items.filter((i) => i.status === 'watching').length,
    total: items.length,
  };
  const complete = todayState?.status === 'complete';
  const inProgress = todayState?.status === 'in_progress' && todayState.exists;
  const [greeting, setGreeting] = useState(() => pickGreeting(items, complete, counts));

  useEffect(() => {
    setGreeting(pickGreeting(items, complete, counts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, complete]);

  const collage = useMemo(() => {
    return items
      .filter((item) => item.photos?.length)
      .slice(0, 7)
      .map((item) => ({ id: item.id, src: photoUrl(itemCover(item), true), name: item.name }));
  }, [items]);

  const today = new Date();
  const dateText = `${today.getMonth() + 1}月${today.getDate()}日 · 周${['日', '一', '二', '三', '四', '五', '六'][today.getDay()]}`;
  const spent = totalSpent(items);
  const tail = pendingTail(items);
  const lastChat = freeChat?.messages?.[freeChat.messages.length - 1];
  let unread = false;
  try {
    unread = Boolean(lastChat?.role === 'assistant' && lastChat.ts > Number(localStorage.getItem('hf.freechatReadAt') || 0));
  } catch {}
  const chatSchedule = config?.dailyChatEnabled !== false
    ? `每天 ${config?.dailyChatTime || '22:00'} 主动来找你`
    : '主动话题已关闭';

  const reroll = () => setGreeting(pickGreeting(items, complete, counts));

  return (
    <div className="page home-page">
      {updateInfo?.available && (
        <button className="update-banner" onClick={onUpdateClick}>
          <span className="update-banner-dot" />
          发现新版本 v{updateInfo.latestVersion}，去更新
          <IconChevronRight size={15} />
        </button>
      )}

      <div className="home-collage" aria-hidden="true">
        {collage.slice(0, 4).map((item, index) => (
          <div className={`collage-card c${index}`} key={item.id}>
            <img src={item.src} alt="" loading="lazy" />
          </div>
        ))}
      </div>
      <div className="home-collage right" aria-hidden="true">
        {collage.slice(4, 7).map((item, index) => (
          <div className={`collage-card c${index}`} key={item.id}>
            <img src={item.src} alt="" loading="lazy" />
          </div>
        ))}
      </div>

      <div className="hero">
        <div className="hero-kicker">
          <span className="hero-kicker-line" />
          今日份 · 上贡
          <span className="hero-date">{dateText}</span>
        </div>

        <div className="hero-greeting-wrap">
          <h1 className="hero-greeting">{greeting}</h1>
        </div>

        <p className="hero-sub">
          {complete
            ? '今天的份已经交上去了。余韵、灰尘和钱包，都明天再说。'
            : inProgress
              ? '上一轮还没结束。管理员在等你把话说完。'
              : '擦拭 · 意淫 · 教唆。一次做完，今天才算数。'}
        </p>

        <div className="hero-actions">
          <button
            className={`offering-button ${complete ? 'is-complete' : ''}`}
            onClick={complete ? onViewToday : inProgress ? onResume : onStart}
            disabled={!items.length && !complete}
          >
            <span className="offering-glow" />
            {complete ? <IconCircleCheck size={22} /> : <IconSparkles size={22} />}
            <span>{complete ? '今日已上贡' : inProgress ? '继续上贡' : '今日份上贡'}</span>
            {!complete && <span className="offering-arrow"><IconChevronRight size={18} /></span>}
          </button>
          <button className="reroll-button" onClick={reroll} title="换一句问候">
            <IconRefresh size={15} />
            换一句
          </button>
        </div>

        {complete && (
          <button className="today-link" onClick={onViewToday}>
            回看今天发生了什么 <IconChevronRight size={14} />
          </button>
        )}

        {!items.length && (
          <div className="hero-empty">
            <span>柜子还空着。</span>
            <button className="text-button" onClick={onAdd}><IconPlus size={14} /> 添加第一件周边</button>
          </div>
        )}

        {config && !config.apiKeySet && (
          <button className="setup-hint" onClick={onOpenSettings}>
            <IconAlert size={15} />
            还没填 DeepSeek API Key，管理员暂时开不了口。
            <span>去设置 <IconChevronRight size={13} /></span>
          </button>
        )}

        {!complete && todayState?.progress?.some((p) => p.status !== 'pending') && (
          <div className="hero-progress">
            {PHASES.map((phase) => {
              const p = todayState?.progress.find((x) => x.phase === phase);
              const state = p?.status || 'pending';
              return (
                <div key={phase} className={`mini-phase ${state}`}>
                  <span className="mini-phase-dot">
                    {state === 'done' ? <IconCheck size={10} /> : null}
                  </span>
                  {PHASE_META[phase].label}
                  {p?.itemName ? <em>{p.itemName}</em> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="home-stats">
        {(['owned', 'pending', 'watching'] as ItemStatus[]).map((status) => (
          <button className={`stat-card stat-${status}`} key={status} onClick={() => onGoCollection(status)}>
            <span className="stat-glyph">{STATUS_META[status].glyph}</span>
            <span className="stat-body">
              <span className="stat-number">{counts[status]}</span>
              <span className="stat-label">{STATUS_META[status].label}</span>
            </span>
            <IconChevronRight size={15} className="stat-arrow" />
          </button>
        ))}
        <div className="stat-card stat-money">
          <span className="stat-glyph"><IconCamera size={18} /></span>
          <span className="stat-body">
            <span className="stat-number">{formatMoney(spent)}</span>
            <span className="stat-label">累计投入{tail > 0 ? ` · 待补 ${formatMoney(tail)}` : ''}</span>
          </span>
        </div>
      </div>

      <button className={`home-chat-entry ${unread ? 'has-unread' : ''}`} onClick={onOpenChat}>
        <span className="home-chat-avatar">管</span>
        <span className="home-chat-body">
          <span className="home-chat-title">
            收藏室管理员
            <em>{freeChat?.busy ? '正在输入…' : '在线'}</em>
          </span>
          <span className="home-chat-preview">
            {lastChat
              ? lastChat.content.replace(/\s+/g, ' ').slice(0, 88)
              : '聊聊收藏、尾款、旧事，或者今天的心情。'}
          </span>
        </span>
        <span className="home-chat-side">
          <span className="home-chat-schedule"><IconClock size={12} /> {chatSchedule}</span>
          {unread && <span className="home-chat-badge">新消息</span>}
          <IconChevronRight size={15} />
        </span>
      </button>

      <div className="home-foot">
        <span>{appInfo?.name || 'HentaiFigure'} · 私人的收藏室</span>
        <span className="home-foot-dot" />
        <span>照片、记忆与 API Key 都只留在这台电脑上</span>
        <button className="home-settings-link" onClick={onOpenSettings}>
          <IconSettings size={14} /> 设置
        </button>
      </div>
    </div>
  );
}



