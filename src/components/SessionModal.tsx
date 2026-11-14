import { useEffect, useState } from 'react';
import type { Session } from '../types';
import { PHASE_META, formatDateCN } from '../constants';
import { formatTime } from '../utils';
import { Modal, Spinner } from './ui';
import { IconBook, IconX } from '../icons';

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
    <Modal className="modal-session" onClose={onClose}>
      <div className="session-view">
        <header className="session-head">
          <div>
            <div className="eyebrow">
              {session ? `${formatDateCN(session.day)} · ${meta?.label || session.phase}` : '记忆'}
            </div>
            <h2>{session?.itemName || '…'}</h2>
            {session && (
              <div className="session-meta">
                {session.archived ? '已归档' : '进行中'} · {session.messages.length} 句
                {session.startedAt ? ` · ${formatTime(session.startedAt)}` : ''}
              </div>
            )}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><IconX size={20} /></button>
        </header>

        {loading ? (
          <div className="session-loading"><Spinner /> 正在翻出这段记忆…</div>
        ) : !session ? (
          <div className="session-loading">这段记忆找不到了。</div>
        ) : (
          <div className="session-body">
            {session.summary && (
              <div className="session-summary">
                <div className="session-summary-title"><IconBook size={14} /> 记忆摘要</div>
                <p>{session.summary}</p>
              </div>
            )}
            {session.outcome?.ordered !== undefined && (
              <div className={`session-outcome ${session.outcome.ordered ? 'ordered' : ''}`}>
                {session.outcome.ordered
                  ? `教唆成功：从观望中进入${session.outcome.to === 'owned' ? '已拥有' : '待补款'}`
                  : '教唆未果：继续躺在购物车里'}
              </div>
            )}
            <div className="transcript">
              {session.messages.length === 0 && <div className="muted">这次还没有说话。</div>}
              {session.messages.map((m) => (
                <div key={m.id} className={`transcript-row ${m.role}`}>
                  <span className="transcript-who">{m.role === 'assistant' ? '管' : '你'}</span>
                  <div className="transcript-bubble">{m.content}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

