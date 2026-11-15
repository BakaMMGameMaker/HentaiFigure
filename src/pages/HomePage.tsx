import { useEffect, useMemo, useState } from 'react';
import type { Config, FreeChatState, Item, ItemStatus, RitualState, UpdateInfo } from '../types';
import {
  PHASES, PHASE_META, STATUS_META, formatMoney, itemCover, pendingTail, photoUrl,
  pickGreeting, totalSpent,
} from '../constants';
import {
  IconAlert, IconCheck, IconChevronRight, IconCircleCheck, IconClock, IconGallery, IconPlus,
  IconRefresh, IconSparkles, IconWallet,
} from '../icons';
import { ManagerAvatar } from '../components/ui';
import { cx } from '../utils';

export function HomePage({
  items,
  todayState,
  config,
  updateInfo,
  freeChat,
  chatUnread,
  onAdd,
  onStart,
  onResume,
  onViewToday,
  onOpenSettings,
  onGoCollection,
  onOpenItem,
  onUpdateClick,
  onOpenChat,
}: {
  items: Item[];
  todayState: RitualState | null;
  config: Config | null;
  updateInfo: UpdateInfo | null;
  freeChat: FreeChatState | null;
  chatUnread: boolean;
  onAdd: () => void;
  onStart: () => void;
  onResume: () => void;
  onViewToday: () => void;
  onOpenSettings: () => void;
  onGoCollection: (status?: ItemStatus) => void;
  onOpenItem: (item: Item) => void;
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
  const userName = config?.userName || '';
  const [greeting, setGreeting] = useState(() => pickGreeting(items, complete, counts, userName));

  useEffect(() => {
    setGreeting(pickGreeting(items, complete, counts, userName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, complete, userName]);

  const recent = useMemo(() => {
    return [...items]
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
      .slice(0, 12);
  }, [items]);
  const fan = recent.filter((item) => item.photos?.length).slice(0, 3);

  const today = new Date();
  const dateText = `${today.getMonth() + 1}月${today.getDate()}日 · 周${['日', '一', '二', '三', '四', '五', '六'][today.getDay()]}`;
  const spent = totalSpent(items);
  const tail = pendingTail(items);
  const lastChat = freeChat?.lastMessage || null;
  const chatSchedule = config?.dailyChatEnabled !== false
    ? `每天 ${config?.dailyChatTime || '22:00'} 主动来找你`
    : '主动话题已关闭';

  const reroll = () => setGreeting(pickGreeting(items, complete, counts, userName));
  const showProgress = Boolean(todayState?.progress?.length) && (inProgress || complete);

  return (
    <div className="page home">
      {updateInfo?.available && (
        <button type="button" className="banner banner-gold" onClick={onUpdateClick}>
          <span className="pulse-dot" />
          <span>发现新版本 v{updateInfo.latestVersion}</span>
          <span className="banner-cta">去看看 <IconChevronRight size={14} /></span>
        </button>
      )}

      {config && (!config.apiKeySet || !config.visionModelReady) && (
        <button type="button" className="banner banner-rose" onClick={onOpenSettings}>
          <IconAlert size={16} />
          <span>{config.apiKeySet ? '请保存能通过看图验证的模型。' : '还没填 DeepSeek API Key，管理员暂时开不了口。'}</span>
          <span className="banner-cta">去设置 <IconChevronRight size={14} /></span>
        </button>
      )}

      <section className={cx('hero', complete && 'is-complete')}>
        <div className="hero-main">
          <div className="hero-date">{dateText}</div>
          <button type="button" className="hero-greeting" onClick={reroll} title="换一句">
            {greeting}
            <IconRefresh size={14} className="hero-reroll" />
          </button>
          <p className="hero-sub">
            {complete
              ? '今天的份已经交上去了。余韵、灰尘和钱包，都明天再说。'
              : inProgress
                ? '上一轮还没结束，管理员在等你把话说完。'
                : '擦拭 · 意淫 · 教唆。一次做完，今天才算数。'}
          </p>

          <div className="hero-actions">
            <button
              type="button"
              className={cx('cta', complete && 'is-done')}
              onClick={complete ? onViewToday : inProgress ? onResume : onStart}
              disabled={!items.length && !complete}
            >
              {complete ? <IconCircleCheck size={20} /> : <IconSparkles size={20} />}
              <span>{complete ? '今日已上贡 · 回看' : inProgress ? '继续上贡' : '开始今日份上贡'}</span>
              <IconChevronRight size={18} className="cta-arrow" />
            </button>
            {!items.length && (
              <button type="button" className="btn btn-ghost" onClick={onAdd}>
                <IconPlus size={16} /> 先添加第一件周边
              </button>
            )}
          </div>

          {showProgress && (
            <ol className="hero-steps">
              {PHASES.map((phase, index) => {
                const p = todayState?.progress.find((x) => x.phase === phase);
                const state = p?.status || 'pending';
                return (
                  <li key={phase} className={cx('hero-step', `phase-${phase}`, state)}>
                    <span className="hero-step-dot">{state === 'done' ? <IconCheck size={11} /> : index + 1}</span>
                    <span className="hero-step-text">
                      <strong>{PHASE_META[phase].label}</strong>
                      <small>{state === 'skipped' ? '已跳过' : p?.itemName || (state === 'active' ? '进行中' : '待开始')}</small>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="hero-art" aria-hidden="true">
          {fan.length ? (
            fan.map((item, index) => (
              <div className={`hero-card c${index}`} key={item.id}>
                <img src={photoUrl(itemCover(item), true)} alt="" loading="lazy" />
              </div>
            ))
          ) : (
            <div className="hero-card placeholder"><IconGallery size={34} /></div>
          )}
        </div>
      </section>

      <section className="home-grid">
        <div className="stat-grid">
          {(['owned', 'pending', 'watching'] as ItemStatus[]).map((status) => (
            <button type="button" className={cx('stat', `tone-${status}`)} key={status} onClick={() => onGoCollection(status)}>
              <span className="stat-glyph">{STATUS_META[status].glyph}</span>
              <span className="stat-num">{counts[status]}</span>
              <span className="stat-label">{STATUS_META[status].label}</span>
            </button>
          ))}
          <div className="stat tone-money">
            <span className="stat-glyph"><IconWallet size={16} /></span>
            <span className="stat-num">{formatMoney(spent)}</span>
            <span className="stat-label">累计投入{tail > 0 ? ` · 待补 ${formatMoney(tail)}` : ''}</span>
          </div>
        </div>

        <button type="button" className={cx('manager-card', chatUnread && 'has-unread')} onClick={onOpenChat}>
          <div className="manager-card-top">
            <ManagerAvatar src={config?.managerAvatar} className="avatar-lg" />
            <div className="manager-card-id">
              <strong>收藏室管理员</strong>
              <small><span className="online-dot" /> {freeChat?.busy ? '正在输入…' : '在线'}</small>
            </div>
            {chatUnread && <span className="badge">新消息</span>}
          </div>
          <p className="manager-card-quote">
            {lastChat
              ? lastChat.content.replace(/\s+/g, ' ').slice(0, 120)
              : '聊聊收藏、尾款、旧事，或者今天的心情。'}
          </p>
          <div className="manager-card-foot">
            <span><IconClock size={13} /> {chatSchedule}</span>
            <span className="link">去聊天 <IconChevronRight size={13} /></span>
          </div>
        </button>
      </section>

      {recent.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h3>最近摆弄的</h3>
            <button type="button" className="link" onClick={() => onGoCollection()}>
              全部 {items.length} 件 <IconChevronRight size={13} />
            </button>
          </div>
          <div className="shelf">
            {recent.map((item) => (
              <button type="button" className="shelf-item" key={item.id} onClick={() => onOpenItem(item)}>
                <span className="shelf-cover">
                  {item.photos?.length
                    ? <img src={photoUrl(itemCover(item), true)} alt="" loading="lazy" />
                    : <IconGallery size={22} />}
                  <span className={cx('status-dot', `tone-${item.status}`)} />
                </span>
                <span className="shelf-name">{item.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
