import { useEffect, useState } from 'react';
import type { Session } from '../types';
import { PHASE_META, formatDateCN } from '../constants';
import { cx, formatTime } from '../utils';
import { Modal, SheetHeader, Spinner } from './ui';
import { IconBook } from '../icons';

export function SessionModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    window.hf.memory.session(sessionId)
      .then((data) => { if (alive) setSession(data); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sessionId]);

  const meta = session ? PHASE_META[session.phase] : null;

  return (
    <Modal size="md" onClose={onClose} className="session-sheet">
      <SheetHeader
        eyebrow={session ? `${formatDateCN(session.day)} · ${meta?.label || session.phase}` : '记忆'}
        title={session?.itemName || '正在翻阅…'}
        onClose={onClose}
      />

      {loading ? (
        <div className="sheet-loading"><Spinner /> 正在翻出这段记忆…</div>
      ) : !session ? (
        <div className="sheet-loading">这段记忆找不到了。</div>
      ) : (
        <div className="sheet-body session-body">
          <div className="session-meta">
            <span className={cx('pill', `phase-${session.phase}`)}>{meta?.label || session.phase}</span>
            <span>{session.archived ? '已归档' : '进行中'}</span>
            <span>{session.messages.length} 句</span>
            {session.startedAt && <span>{formatTime(session.startedAt)}</span>}
          </div>

          {session.summary && (
            <div className="callout">
              <div className="callout-title"><IconBook size={14} /> 记忆摘要</div>
              <p>{session.summary}</p>
            </div>
          )}

          {session.outcome?.ordered !== undefined && (
            <div className={cx('outcome-banner', session.outcome.ordered && 'ordered')}>
              {session.outcome.ordered
                ? `教唆成功：从观望中进入${session.outcome.to === 'owned' ? '已拥有' : '待补款'}`
                : '教唆未果：继续躺在购物车里'}
            </div>
          )}

          <div className="transcript">
            {session.messages.length === 0 && <div className="muted">这次还没有说话。</div>}
            {session.messages.map((m) => (
              <div key={m.id} className={cx('msg', m.role)}>
                <div className="msg-who">{m.role === 'assistant' ? '管理员' : '你'}</div>
                <div className="msg-bubble">{m.content}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
