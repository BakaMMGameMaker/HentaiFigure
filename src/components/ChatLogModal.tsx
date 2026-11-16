import { Fragment, useEffect, useState } from 'react';
import type { FreeChatLogRound, FreeChatLogRun } from '../types';
import { cleanError } from '../utils';
import { Modal, SheetHeader, Spinner } from './ui';

const STATUS_LABEL = { running: '请求中', done: '已完成', stopped: '已停止', error: '失败' };
const ROLES: Record<string, string> = { system: '系统提示词', user: '用户上下文', assistant: '管理员消息', tool: '工具返回' };
type LogMessage = FreeChatLogRound['request']['messages'][number];

function formatJson(text: string) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

function followUpContext(round: FreeChatLogRound, next?: FreeChatLogRound) {
  const previous = round.request.messages;
  const current = next?.request.messages ?? [];
  let prefix = 0;
  // 后续请求会在上一份消息快照末尾追加本轮的模型消息和工具结果。
  while (prefix < previous.length && prefix < current.length &&
    JSON.stringify(previous[prefix]) === JSON.stringify(current[prefix])) {
    prefix += 1;
  }
  const added = current.slice(prefix);
  const assistant = round.calls.length && added[0]?.role === 'assistant' && Array.isArray(added[0].tool_calls)
    ? added.shift()
    : undefined;
  const callIds = new Set(round.calls.map(({ id }) => id));
  const toolResults = new Map<string, LogMessage['content']>();
  const remaining = added.filter((message) => {
    const id = message.tool_call_id;
    if (message.role !== 'tool' || typeof id !== 'string' || !callIds.has(id)) return true;
    toolResults.set(id, message.content);
    return false;
  });
  return { assistant, toolResults, remaining };
}

function MessageContent({ content }: { content: LogMessage['content'] }) {
  if (typeof content === 'string') return content ? <pre>{content}</pre> : null;
  return content?.map((part, index) => (
    <pre key={index}>{part.type === 'text' ? part.text : JSON.stringify(part, null, 2)}</pre>
  ));
}

function ContextMessage({ message, title, open }: { message: LogMessage; title?: string; open?: boolean }) {
  const { role, content, ...fields } = message;
  return (
    <details className="log-entry" open={open}>
      <summary>{title ?? ROLES[role] ?? role}</summary>
      <MessageContent content={content} />
      {Object.keys(fields).length > 0 && <pre>{JSON.stringify(fields, null, 2)}</pre>}
    </details>
  );
}

function ModelRequest({ round }: { round: FreeChatLogRound }) {
  const { messages: _messages, ...options } = round.request;
  return (
    <details className="log-entry log-request">
      <summary>
        模型请求 <span>· {options.model}</span>
      </summary>
      {round.finishReason && <div className="log-entry-label">结束原因 · {round.finishReason}</div>}
      <div className="log-entry-label">请求参数与工具定义</div>
      <pre>{JSON.stringify(options, null, 2)}</pre>
    </details>
  );
}

function ToolCall({ call, sentResult }: { call: FreeChatLogRound['calls'][number]; sentResult?: LogMessage['content'] }) {
  return (
    <details className="log-entry log-tool">
      <summary>工具调用 <code>{call.name}</code></summary>
      <div className="log-entry-label">调用 ID · {call.id}</div>
      <div className="log-entry-label">调用参数</div>
      <pre>{formatJson(call.args)}</pre>
      <div className="log-entry-label">执行结果</div>
      <pre>{formatJson(call.result)}</pre>
      {sentResult !== undefined && sentResult !== call.result && (
        <details className="log-entry log-sent-result">
          <summary>发送给模型的结果</summary>
          <MessageContent content={sentResult} />
        </details>
      )}
    </details>
  );
}

function LogTimeline({ run }: { run: FreeChatLogRun }) {
  const initial = run.rounds[0]?.request.messages ?? [];
  const last = initial.at(-1);
  const input = last?.role === 'user' ? last : undefined;
  const history = input ? initial.slice(0, -1) : initial;
  return (
    <ol className="log-timeline" role="list" aria-label="生成时间线">
      {history.length > 0 && (
        <li>
          <details className="log-entry">
            <summary>初始上下文 <span>· {history.length} 条</span></summary>
            <div className="log-initial-context">
              {history.map((message, index) => <ContextMessage key={index} message={message} />)}
            </div>
          </details>
        </li>
      )}
      {input && <li className="log-text-event"><ContextMessage message={input} open /></li>}
      {run.rounds.map((round, index) => {
        const { assistant, toolResults, remaining } = followUpContext(round, run.rounds[index + 1]);
        const content = round.response?.content ?? assistant?.content ?? null;
        const reasoning = round.response?.reasoning ?? assistant?.reasoning_content;
        const hasReasoning = typeof reasoning === 'string' && reasoning.length > 0;
        return (
          <Fragment key={index}>
            <li><ModelRequest round={round} /></li>
            {(content || hasReasoning) && (
              <li className="log-text-event">
                <div className="log-entry log-reply">
                  {content && (
                    <>
                      <div className="log-entry-label">{round.calls.length ? '管理员消息' : '管理员回复'}</div>
                      <MessageContent content={content} />
                    </>
                  )}
                  {hasReasoning && (
                    <details>
                      <summary>思考过程</summary>
                      <pre>{reasoning}</pre>
                    </details>
                  )}
                </div>
              </li>
            )}
            {round.calls.map((call, callIndex) => (
              <li key={callIndex}><ToolCall call={call} sentResult={toolResults.get(call.id)} /></li>
            ))}
            {remaining.map((message, messageIndex) => (
              <li key={messageIndex}>
                <ContextMessage message={message} title={message.role === 'user' && Array.isArray(message.content) ? '补充图片' : undefined} />
              </li>
            ))}
          </Fragment>
        );
      })}
      <li className="log-status">
        <span>{STATUS_LABEL[run.status]}</span>
        {run.error && <p className="chat-error" role="alert">{run.error}</p>}
      </li>
    </ol>
  );
}

export function ChatLogModal({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const [runs, setRuns] = useState<FreeChatLogRun[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
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
              <select className="select" value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {new Date(run.startedAt).toLocaleString()} · {STATUS_LABEL[run.status]}
                  </option>
                ))}
              </select>
            </label>
            <LogTimeline key={selected.id} run={selected} />
          </>
        ) : <p className="muted">这段对话还没有模型请求记录。</p>}
      </div>
    </Modal>
  );
}
