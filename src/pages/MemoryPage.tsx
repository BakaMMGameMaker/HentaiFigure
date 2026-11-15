import { useEffect, useMemo, useState } from 'react';
import type { MemoryOverview, Phase } from '../types';
import { PHASE_META, formatDateCN, weekdayCN } from '../constants';
import { SessionModal } from '../components/SessionModal';
import { EmptyState, Spinner } from '../components/ui';
import { IconBook, IconSearch, IconSparkles, IconX } from '../icons';
import { cx } from '../utils';

export function MemoryPage({
  initialItemId,
  onToast,
}: {
  initialItemId?: string | null;
  onToast: (text: string, kind?: 'ok' | 'error' | 'info') => void;
}) {
  const [data, setData] = useState<MemoryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState<'all' | Phase>('all');
  const [itemId, setItemId] = useState<string>('all');
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    setItemId(initialItemId || 'all');
  }, [initialItemId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    window.hf.memory.overview()
      .then((result) => { if (alive) setData(result); })
      .catch(() => { if (alive) onToast('记忆库打不开', 'error'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [onToast]);

  const sessions = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.sessions
      .filter((s) => s.archived)
      .filter((s) => (phase === 'all' ? true : s.phase === phase))
      .filter((s) => (itemId === 'all' ? true : s.itemId === itemId))
      .filter((s) => {
        if (!q) return true;
        return `${s.itemName} ${s.summary} ${s.day}`.toLowerCase().includes(q);
      })
      .sort((a, b) => String(b.day).localeCompare(String(a.day)) || b.startedAt - a.startedAt);
  }, [data, phase, itemId, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof sessions>();
    for (const session of sessions) {
      const list = map.get(session.day) || [];
      list.push(session);
      map.set(session.day, list);
    }
    return Array.from(map.entries());
  }, [sessions]);

  const phases: { value: 'all' | Phase; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'wipe', label: PHASE_META.wipe.label },
    { value: 'fantasy', label: PHASE_META.fantasy.label },
    { value: 'instigate', label: PHASE_META.instigate.label },
  ];

  return (
    <div className="page memory">
      <header className="page-head">
        <div>
          <div className="eyebrow">HER MEMORY</div>
          <h1>记忆库</h1>
          <p className="page-sub">每一次上贡都封存在这里。管理员在对话里可以随时调用这些记忆，翻你的旧账。</p>
        </div>
        <div className="mem-stats">
          <div><b>{data?.stats.sessions ?? 0}</b><span>段对话</span></div>
          <div><b>{data?.stats.days ?? 0}</b><span>天上贡</span></div>
          <div><b>{data?.stats.items ?? 0}</b><span>件周边</span></div>
        </div>
      </header>

      <div className="toolbar">
        <div className="segmented scroll-x">
          {phases.map((p) => (
            <button
              type="button"
              key={p.value}
              className={cx(phase === p.value && 'active', p.value !== 'all' && `phase-${p.value}`)}
              onClick={() => setPhase(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <select className="select" value={itemId} onChange={(e) => setItemId(e.target.value)} aria-label="按周边筛选">
            <option value="all">全部周边</option>
            {(data?.items || []).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          <label className="search">
            <IconSearch size={15} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜记忆…" />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="清空"><IconX size={14} /></button>
            )}
          </label>
        </div>
      </div>

      {loading ? (
        <div className="sheet-loading"><Spinner /> 正在整理记忆…</div>
      ) : !sessions.length ? (
        <EmptyState
          title={data?.sessions.length ? '没有匹配的记忆' : '还没有记忆'}
          desc={data?.sessions.length
            ? '换个关键词，或者清掉筛选。'
            : '完成一次今日份上贡，管理员就会把那天的事记下来。'}
          icon={<IconBook size={30} />}
        />
      ) : (
        <div className="mem-timeline">
          {grouped.map(([day, list]) => (
            <section className="mem-day" key={day}>
              <div className="mem-day-head">
                <span className="mem-day-date">{formatDateCN(day)}</span>
                <span className="mem-day-week">{weekdayCN(day)}</span>
                <span className="mem-day-line" />
                <span className="mem-day-count">{list.length} 段</span>
              </div>
              <div className="mem-cards">
                {list.map((session) => (
                  <button type="button" className="mem-card" key={session.id} onClick={() => setSessionId(session.id)}>
                    <div className="mem-card-top">
                      <span className={cx('pill', `phase-${session.phase}`)}>
                        {PHASE_META[session.phase]?.label || session.phase}
                      </span>
                      <span className="mem-card-item">{session.itemName}</span>
                      <span className="mem-card-count">{session.messageCount} 句</span>
                    </div>
                    <p className="mem-card-summary">{session.summary || '（这段对话没有留下摘要）'}</p>
                    <div className="mem-card-foot">
                      <span>{session.outcome?.ordered === true ? '教唆成功 · 已下单' : session.outcome?.ordered === false ? '教唆未果 · 继续观望' : '已归档'}</span>
                      <span className="link">重读 <IconSparkles size={12} /></span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="mem-footnote">
        <IconSparkles size={13} /> 管理员可以调用工具翻查全部过去的事件——包括你现在看到的这些。
      </div>

      {sessionId && <SessionModal sessionId={sessionId} onClose={() => setSessionId(null)} />}
    </div>
  );
}
