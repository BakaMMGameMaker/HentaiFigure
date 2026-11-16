import { useEffect, useState } from 'react';
import type { FreeChatLogRound, FreeChatLogRun } from '../types';
import { cleanError } from '../utils';
import { Modal, SheetHeader, Spinner } from './ui';

const STATUS_LABEL = { running: '请求中', done: '已完成', stopped: '已停止', error: '失败' };
const ROLES: Record<string, string> = { system: '系统提示词', user: '用户上下文', assistant: '管理员上下文', tool: '工具返回' };

function formatJson(text: string) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

function RequestRound({ round, index }: { round: FreeChatLogRound; index: number }) {
  const { model, messages, tools, ...options } = round.request;
  return (
    <details className="log-round" open={index === 0}>
      <summary>
        <strong>第 {index + 1} 次模型请求</strong>
        <span>{model} · {messages.length} 条上下文 · {round.calls.length} 次工具调用</span>
      </summary>
      <div className="log-round-body">
        <details className="log-entry">
          <summary>请求参数与工具定义</summary>
          <pre>{JSON.stringify({ model, ...options, ...(tools && { tools }) }, null, 2)}</pre>
        </details>
        {messages.map(({ role, content, ...fields }, i) => (
          <details className="log-entry" key={i} open={index === 0 && role === 'system'}>
            <summary>{i + 1}. {ROLES[role] || role} <span>· {role}</span></summary>
            {content && (
              typeof content === 'string' ? <pre>{content}</pre> : content.map((part, j) => (
                <pre key={j}>{part.type === 'text' ? part.text : JSON.stringify(part, null, 2)}</pre>
              ))
            )}
            {Object.keys(fields).length > 0 && <pre>{JSON.stringify(fields, null, 2)}</pre>}
          </details>
        ))}
        {round.calls.map((call, i) => (
          <details className="log-entry log-tool" key={`${i}-${call.id}`}>
            <summary>工具调用 <code>{call.name}</code> <span>· {call.id}</span></summary>
            <div className="log-entry-label">调用参数</div>
            <pre>{formatJson(call.args)}</pre>
            <div className="log-entry-label">执行结果</div>
            <pre>{formatJson(call.result)}</pre>
          </details>
        ))}
        {round.finishReason && <p className="muted small">结束原因 · {round.finishReason}</p>}
      </div>
    </details>
  );
}

export function ChatLogModal({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const [runs, setRuns] = useState<FreeChatLogRun[] | null>(null);
  const [selectedId, setSelectedId] = useState<number>();
  const [error, setError] = useState('');

  useEffect(() => {
    let currentRequest = 0;
    const refresh = async () => {
      const request = ++currentRequest;
      try {
        const next = await window.hf.chat.freeLogs(threadId);
        if (request !== currentRequest) return;
        setRuns(next);
        setError('');
      } catch (err) {
        if (request === currentRequest) setError(cleanError(err));
      }
    };
    const unsubscribe = window.hf.onEvent((event) => {
      if (event.type === 'free:log' && event.threadId === threadId) void refresh();
    });
    void refresh();
    return () => { ++currentRequest; unsubscribe(); };
  }, [threadId]);

  const selected = runs?.find((run) => run.id === selectedId) || runs?.[0];

  return (
    <Modal size="lg" className="chat-log-sheet" titleId="chat-log-title" onClose={onClose}>
      <SheetHeader title="对话日志" titleId="chat-log-title" onClose={onClose} />
      <div className="sheet-body chat-log-body">
        {error ? <p className="chat-error" role="alert">{error}</p> : !runs ? (
          <div className="sheet-loading"><Spinner /> 正在读取日志…</div>
        ) : selected ? (
          <>
            <label className="log-picker">
              <span>生成记录</span>
              <select className="select" value={selected.id} onChange={(event) => setSelectedId(Number(event.target.value))}>
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {new Date(run.startedAt).toLocaleString()} · {STATUS_LABEL[run.status]}
                  </option>
                ))}
              </select>
            </label>
            {selected.error && <p className="chat-error" role="alert">{selected.error}</p>}
            <div className="log-rounds" key={selected.id}>
              {selected.rounds.map((round, index) => <RequestRound key={index} round={round} index={index} />)}
            </div>
          </>
        ) : <p className="muted">本次运行还没有这段对话的模型请求记录。</p>}
      </div>
    </Modal>
  );
}
