import type { MobileConfig } from './store';

export class ApiError extends Error {
  status = 0;
  detail = '';
  code = '';
  constructor(message: string, opts: { status?: number; detail?: string; code?: string } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = opts.status || 0;
    this.detail = opts.detail || '';
    this.code = opts.code || '';
  }
}

export function friendlyError(err: unknown): string {
  const e = err as ApiError;
  if (!e) return '未知错误';
  if (e.code === 'NO_KEY') return '还没有配置 DeepSeek API Key，请先在设置里填入。';
  if (e.code === 'ABORTED') return '已停止生成。';
  if (e.code === 'NETWORK') return `连不上 DeepSeek 服务：${e.message}`;
  if (e.status === 401) return 'API Key 无效或已过期（401），请到设置里检查。';
  if (e.status === 402) return 'DeepSeek 账户余额不足（402），请先充值。';
  if (e.status === 429) return '请求太频繁了（429），缓一缓再来。';
  if (e.status === 400) return `请求被拒绝（400）：${e.detail || e.message}`;
  if (e.status === 404) return `接口或模型不存在（404）：${e.detail || e.message}`;
  if (e.status >= 500) return `DeepSeek 服务出错了（${e.status}），稍后再试。`;
  return e.message || '请求失败';
}

export function modelSupportsVision(model: string): boolean {
  const name = String(model || '').toLowerCase();
  if (!name) return true;
  if (name.includes('deepseek')) {
    return name.includes('flash') || name.includes('vision') || name.includes('vl') || name.includes('v4');
  }
  return true;
}

export function normalizeBaseUrl(url: string): string {
  const base = String(url || 'https://api.deepseek.com').trim().replace(/\/+$/, '');
  return base || 'https://api.deepseek.com';
}

function extractErrorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message || parsed?.message || text;
  } catch {
    return String(text || '').slice(0, 500);
  }
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  finishReason: string;
}

export async function requestChat({
  config,
  apiKey,
  messages,
  tools,
  maxTokens,
  temperature,
  signal,
}: {
  config: MobileConfig;
  apiKey: string;
  messages: any[];
  tools?: any[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<ChatResult> {
  if (!apiKey) throw new ApiError('missing key', { code: 'NO_KEY' });
  const payload: Record<string, any> = {
    model: config.model || 'deepseek-flash',
    messages,
    stream: false,
    temperature: typeof temperature === 'number' ? temperature : config.temperature,
  };
  if (tools?.length) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }
  if (maxTokens) payload.max_tokens = maxTokens;

  let res: Response;
  try {
    res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new ApiError('aborted', { code: 'ABORTED' });
    throw new ApiError(err?.message || 'network error', { code: 'NETWORK' });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(`HTTP ${res.status}`, { status: res.status, detail: extractErrorMessage(text) });
  }
  const json = await res.json();
  const choice = json?.choices?.[0];
  const message = choice?.message || {};
  return {
    content: typeof message.content === 'string' ? message.content : '',
    reasoning: typeof message.reasoning_content === 'string' ? message.reasoning_content : '',
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
    finishReason: choice?.finish_reason || 'stop',
  };
}

export async function completeText({
  config,
  apiKey,
  messages,
  maxTokens = 400,
  temperature = 0.5,
}: {
  config: MobileConfig;
  apiKey: string;
  messages: any[];
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const result = await requestChat({ config, apiKey, messages, maxTokens, temperature });
  return result.content;
}

export async function testConnection(config: MobileConfig, apiKey: string) {
  const text = await completeText({
    config,
    apiKey,
    messages: [{ role: 'user', content: '只回复两个字：在的' }],
    maxTokens: 16,
    temperature: 0,
  });
  return { ok: true, reply: text.trim(), model: config.model };
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function emitText(text: string, onDelta: (text: string) => void, chunk = 8, delay = 18) {
  if (!text) return;
  for (let i = 0; i < text.length; i += chunk) {
    onDelta(text.slice(i, i + chunk));
    await sleep(delay);
  }
}
