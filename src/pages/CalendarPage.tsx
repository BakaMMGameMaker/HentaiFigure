import { useEffect, useMemo, useState } from 'react';
import type { CalendarDay, DayDetail } from '../types';
import { PHASE_META, formatDateCN, todayKey, weekdayCN } from '../constants';
import { cx, formatTime } from '../utils';
import { SessionModal } from '../components/SessionModal';
import { Spinner } from '../components/ui';
import {
  IconCalendar, IconCheck, IconChevronLeft, IconChevronRight, IconClock, IconSparkles,
} from '../icons';

function monthCells(year: number, month: number): (number | null)[] {
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const total = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: offset }, () => null);
  for (let d = 1; d <= total; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function CalendarPage({
  onToast,
  focusDay,
}: {
  onToast: (text: string, kind?: 'ok' | 'error' | 'info') => void;
  focusDay?: string | null;
}) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [days, setDays] = useState<Record<string, CalendarDay>>({});
  const [selected, setSelected] = useState<string | null>(todayKey());
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!focusDay) return;
    const [y, m] = focusDay.split('-').map(Number);
    if (y && m) setCursor({ y, m });
    setSelected(focusDay);
  }, [focusDay]);

  useEffect(() => {
    let alive = true;
    window.hf.calendar.month(cursor.y, cursor.m)
      .then((data) => { if (alive) setDays(data); })
      .catch(() => { if (alive) onToast('日历加载失败', 'error'); });
    return () => { alive = false; };
  }, [cursor, onToast]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    window.hf.calendar.day(selected)
      .then((data) => { if (alive) setDetail(data); })
      .catch(() => { if (alive) onToast('这一天翻不出来了', 'error'); })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [selected, onToast]);

  const cells = useMemo(() => monthCells(cursor.y, cursor.m), [cursor]);
  const completedDays = Object.values(days).filter((d) => d.hasRitual).length;
  const todayDay = now.getDate();
  const isCurrentMonth = cursor.y === now.getFullYear() && cursor.m === now.getMonth() + 1;

  const changeMonth = (delta: number) => {
    const next = new Date(cursor.y, cursor.m - 1 + delta, 1);
    setCursor({ y: next.getFullYear(), m: next.getMonth() + 1 });
    setSelected(null);
    setDetail(null);
  };

  const goToday = () => {
    setCursor({ y: now.getFullYear(), m: now.getMonth() + 1 });
    setSelected(todayKey());
  };

  return (
    <div className="page calendar">
      <header className="page-head">
        <div>
          <div className="eyebrow">DAILY OFFERING</div>
          <h1>上贡日历</h1>
          <p className="page-sub">每一次上贡都会在这里留下一个勾。管理员记得所有日子，你也可以点开看。</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={goToday}>
          <IconCalendar size={15} /> 回到今天
        </button>
      </header>

      <div className="cal-layout">
        <section className="panel cal-card">
          <div className="cal-head">
            <button type="button" className="icon-btn" onClick={() => changeMonth(-1)} aria-label="上个月">
              <IconChevronLeft size={19} />
            </button>
            <div className="cal-title">
              <strong>{cursor.y}</strong>
              <span>{String(cursor.m).padStart(2, '0')} 月</span>
            </div>
            <button type="button" className="icon-btn" onClick={() => changeMonth(1)} aria-label="下个月">
              <IconChevronRight size={19} />
            </button>
          </div>

          <div className="cal-legend">
            <span><i className="legend-check"><IconCheck size={9} /></i> 已上贡</span>
            <span><i className="legend-dot" /> 有记录</span>
            <span className="cal-count">本月 {completedDays} 天</span>
          </div>

          <div className="cal-weekdays">
            {['一', '二', '三', '四', '五', '六', '日'].map((d) => <span key={d}>{d}</span>)}
          </div>

          <div className="cal-grid">
            {cells.map((dayNum, index) => {
              if (!dayNum) return <div className="day-cell blank" key={`b${index}`} />;
              const key = `${cursor.y}-${String(cursor.m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const info = days[key];
              const isToday = isCurrentMonth && dayNum === todayDay;
              return (
                <button
                  type="button"
                  key={key}
                  className={cx(
                    'day-cell',
                    info?.hasRitual && 'has-ritual',
                    info?.sessions?.length ? 'has-sessions' : '',
                    selected === key && 'selected',
                    isToday && 'today',
                  )}
                  onClick={() => setSelected(key)}
                >
                  <span className="day-number">{dayNum}</span>
                  {info?.hasRitual && <span className="day-stamp"><IconCheck size={11} /></span>}
                  {!info?.hasRitual && info?.sessions?.length ? <span className="day-dot" /> : null}
                  {info?.hasRitual && (
                    <span className="day-mini">
                      {info.sessions.slice(0, 3).map((s) => PHASE_META[s.phase]?.label?.charAt(0)).join(' ')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="panel cal-detail">
          {detailLoading ? (
            <div className="cal-empty"><Spinner /> 翻着日历…</div>
          ) : !selected ? (
            <div className="cal-empty">
              <IconCalendar size={28} />
              <p>点一个日子<br />看看那天她和你说了什么。</p>
            </div>
          ) : detail ? (
            <>
              <div className="cal-detail-head">
                <div>
                  <div className="eyebrow">{weekdayCN(selected)}</div>
                  <h2>{formatDateCN(selected)}</h2>
                </div>
                {detail.record?.completedAt ? (
                  <span className="pill tone-owned">已上贡</span>
                ) : detail.record ? (
                  <span className="pill tone-pending">未完成</span>
                ) : (
                  <span className="pill">平静的一天</span>
                )}
              </div>

              {detail.sessions.length ? (
                <div className="day-sessions">
                  {detail.sessions.map((session) => (
                    <button type="button" className="day-session" key={session.id} onClick={() => setSessionId(session.id)}>
                      <div className="day-session-top">
                        <span className={cx('pill', `phase-${session.phase}`)}>{PHASE_META[session.phase]?.label || session.phase}</span>
                        <span className="day-session-time">{formatTime(session.startedAt).slice(11)}</span>
                      </div>
                      <div className="day-session-item">{session.itemName}</div>
                      <p>{session.summary || '这段对话还没有摘要。'}</p>
                      <span className="link">查看对话 <IconChevronRight size={12} /></span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="cal-empty">
                  <IconClock size={26} />
                  <p>这天什么也没发生。<br />灰尘还在，欲望也还在。</p>
                </div>
              )}

              {detail.record?.completedAt && (
                <div className="cal-detail-foot">
                  <IconSparkles size={14} /> 这天完成了当日上贡
                </div>
              )}
            </>
          ) : null}
        </aside>
      </div>

      {sessionId && <SessionModal sessionId={sessionId} onClose={() => setSessionId(null)} />}
    </div>
  );
}
