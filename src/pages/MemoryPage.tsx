import { useEffect, useMemo, useState } from 'react';
import type { MemoryOverview, Phase } from '../types';
import { PHASE_META, formatDateCN, weekdayCN } from '../constants';
import { SessionModal } from '../components/SessionModal';
import { EmptyState, Spinner } from '../components/ui';
import {
  IconBook, IconChevronDown, IconSearch, IconSparkles,
} from '../icons';

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
    <div className="page memory-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">HER MEMORY</div>
          <h1>记忆库</h1>
          <p className="page-sub">
            每一次上贡都封存在这里。管理员在对话里可以随时调用这些记忆，翻你的旧账。
          </p>
        </div>
        <div className="memory-stats">
          <div><b>{data?.stats.sessions ?? 0}</b><span>段对话</span></div>
          <div><b>{data?.stats.days ?? 0}</b><span>天上贡</span></div>
          <div><b>{data?.stats.items ?? 0}</b><span>件周边</span></div>
        </div>
      </header>

      <div className="memory-toolbar">
        <div className="filter-tabs">
          {phases.map((p) => (
            <button
              key={p.value}
              className={`filter-tab ${phase === p.value ? 'active' : ''}`}
              onClick={() => setPhase(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="memory-filters">
          <div className="select-wrap">
            <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="all">全部周边</option>
              {(data?.items || []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <IconChevronDown size={13} />
          </div>
          <div className="search-box">
            <IconSearch size={15} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜记忆…" />
            {search && <button onClick={() => setSearch('')} aria-label="清空">×</button>}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="memory-loading"><Spinner /> 正在整理记忆…</div>
      ) : !sessions.length ? (
        <EmptyState
          title={data?.sessions.length ? '没有匹配的记忆' : '还没有记忆'}
          desc={data?.sessions.length
            ? '换个关键词，或者清掉筛选。'
            : '完成一次今日份上贡，管理员就会把那天的事记下来。'}
          icon={<IconBook size={32} />}
        />
      ) : (
        <div className="memory-timeline">
          {grouped.map(([day, list]) => (
            <section className="memory-day" key={day}>
              <div className="memory-day-head">
                <span className="memory-day-date">{formatDateCN(day)}</span>
                <span className="memory-day-week">{weekdayCN(day)}</span>
                <span className="memory-day-line" />
                <span className="memory-day-count">{list.length} 段</span>
              </div>
              <div className="memory-cards">
                {list.map((session) => (
                  <button className="memory-card" key={session.id} onClick={() => setSessionId(session.id)}>
                    <div className="memory-card-top">
                      <span className={`phase-chip phase-${session.phase}`}>
                        {PHASE_META[session.phase]?.label || session.phase}
                      </span>
                      <span className="memory-card-item">{session.itemName}</span>
                      <span className="memory-card-count">{session.messageCount} 句</span>
                    </div>
                    <p className="memory-card-summary">{session.summary || '（这段对话没有留下摘要）'}</p>
                    <div className="memory-card-foot">
                      <span>{session.outcome?.ordered === true ? '教唆成功 · 已下单' : session.outcome?.ordered === false ? '教唆未果 · 继续观望' : '已归档'}</span>
                      <span className="memory-card-link">重读这段 <IconSparkles size={12} /></span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="memory-footnote">
        <IconSparkles size={13} />
        管理员可以调用工具翻查全部过去的事件——包括你现在看到的这些。
      </div>

      {sessionId && <SessionModal sessionId={sessionId} onClose={() => setSessionId(null)} />}
    </div>
  );
}


