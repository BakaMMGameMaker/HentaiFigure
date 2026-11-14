'use strict';

const fs = require('node:fs');

const IMAGE_CACHE = new Map();
const MAX_CACHE_ENTRIES = 24;

class ApiError extends Error {
  constructor(message, { status = 0, detail = '', code = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

function friendlyError(err) {
  if (!err) return '未知错误';
  if (err.code === 'NO_KEY') return '还没有配置 DeepSeek API Key，请先在设置里填入。';
  if (err.code === 'ABORTED') return '已停止生成。';
  if (err.code === 'NETWORK') return `连不上 DeepSeek 服务：${err.message}`;
  if (err.status === 401) return 'API Key 无效或已过期（401），请到设置里检查。';
  if (err.status === 402) return 'DeepSeek 账户余额不足（402），请先充值。';
  if (err.status === 429) return '请求太频繁了（429），缓一缓再来。';
  if (err.status === 400) return `请求被拒绝（400）：${err.detail || err.message}`;
  if (err.status === 404) return `接口或模型不存在（404）：${err.detail || err.message}`;
  if (err.status >= 500) return `DeepSeek 服务出错了（${err.status}），稍后再试。`;
  return err.message || '请求失败';
}

function normalizeBaseUrl(baseUrl) {
  const base = String(baseUrl || 'https://api.deepseek.com').trim().replace(/\/+$/, '');
  return base || 'https://api.deepseek.com';
}

function dataUrlFromFile(filePath, maxDim = 1400) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  const cacheKey = `${filePath}:${stat.mtimeMs}:${maxDim}`;
  const cached = IMAGE_CACHE.get(cacheKey);
  if (cached) return cached;

  try {
    const { nativeImage } = require('electron');
    let img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    if (!width || !height) return null;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    if (scale < 1) {
      img = img.resize({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        quality: 'good',
      });
    }
    let buf = img.toJPEG(84);
    // Keep each image comfortably below a few MB so several fit in one request.
    let guard = 0;
    while (buf.length > 2_600_000 && guard < 4) {
      const size = img.getSize();
      img = img.resize({
        width: Math.max(1, Math.round(size.width * 0.72)),
        height: Math.max(1, Math.round(size.height * 0.72)),
        quality: 'good',
      });
      buf = img.toJPEG(78);
      guard += 1;
    }
    const result = `data:image/jpeg;base64,${buf.toString('base64')}`;
    if (IMAGE_CACHE.size >= MAX_CACHE_ENTRIES) {
      const firstKey = IMAGE_CACHE.keys().next().value;
      IMAGE_CACHE.delete(firstKey);
    }
    IMAGE_CACHE.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

function extractErrorMessage(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message || parsed?.message || text;
  } catch {
    return String(text || '').slice(0, 500);
  }
}

/**
 * Stream one OpenAI-compatible chat completion.
 * Calls onDelta(text) for content tokens and onReasoning(text) for thinking tokens.
 * Returns { content, reasoning, toolCalls, finishReason }.
 */
async function streamChat({
  config,
  apiKey,
  messages,
  tools,
  signal,
  onDelta,
  onReasoning,
  maxTokens,
}) {
  if (!apiKey) throw new ApiError('missing key', { code: 'NO_KEY' });

  const url = `${normalizeBaseUrl(config.baseUrl)}/chat/completions`;
  const payload = {
    model: config.model || 'deepseek-flash',
    messages,
    stream: true,
    temperature: typeof config.temperature === 'number' ? config.temperature : 1.3,
  };
  if (tools && tools.length) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }
  if (maxTokens) payload.max_tokens = maxTokens;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new ApiError('aborted', { code: 'ABORTED' });
    throw new ApiError(err?.message || 'network error', { code: 'NETWORK' });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(`HTTP ${res.status}`, {
      status: res.status,
      detail: extractErrorMessage(text),
    });
  }

  const contentType = res.headers.get('content-type') || '';

  // Some compatible gateways ignore stream:true and answer with plain JSON.
  if (!contentType.includes('text/event-stream')) {
    const json = await res.json().catch(() => null);
    const msg = json?.choices?.[0]?.message || {};
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content && onDelta) onDelta(content);
    if (msg.reasoning_content && onReasoning) onReasoning(msg.reasoning_content);
    return {
      content,
      reasoning: msg.reasoning_content || '',
      toolCalls: msg.tool_calls || [],
      finishReason: json?.choices?.[0]?.finish_reason || 'stop',
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let finishReason = '';
  const toolCalls = [];
  let done = false;

  while (!done) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (err?.name === 'AbortError') throw new ApiError('aborted', { code: 'ABORTED' });
      throw err;
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });

    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const rawLine = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const line = rawLine.replace(/\r$/, '');
      if (!line || line.startsWith(':')) continue;
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === '[DONE]') { done = true; break; }

      let json;
      try { json = JSON.parse(data); } catch { continue; }
      if (json.error) {
        throw new ApiError(json.error.message || 'API error', {
          status: 400,
          detail: json.error.message || '',
        });
      }
      const choice = json.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta || {};

      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        if (onDelta) onDelta(delta.content);
      }
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        if (onReasoning) onReasoning(delta.reasoning_content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const part of delta.tool_calls) {
          const idx = typeof part.index === 'number' ? part.index : 0;
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: part.id || '',
              type: 'function',
              function: { name: '', arguments: '' },
            };
          }
          const target = toolCalls[idx];
          if (part.id) target.id = part.id;
          if (part.function?.name) target.function.name += part.function.name;
          if (part.function?.arguments) target.function.arguments += part.function.arguments;
        }
      }
    }
  }

  try { await reader.cancel(); } catch {}
  return {
    content,
    reasoning,
    toolCalls: toolCalls.filter(Boolean),
    finishReason: finishReason || 'stop',
  };
}

async function completeText({ config, apiKey, messages, maxTokens = 400, temperature, signal }) {
  if (!apiKey) throw new ApiError('missing key', { code: 'NO_KEY' });
  const url = `${normalizeBaseUrl(config.baseUrl)}/chat/completions`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || 'deepseek-flash',
        messages,
        stream: false,
        temperature: typeof temperature === 'number' ? temperature : 0.4,
        max_tokens: maxTokens,
      }),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new ApiError('aborted', { code: 'ABORTED' });
    throw new ApiError(err?.message || 'network error', { code: 'NETWORK' });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(`HTTP ${res.status}`, {
      status: res.status,
      detail: extractErrorMessage(text),
    });
  }
  const json = await res.json();
  return json?.choices?.[0]?.message?.content || '';
}

async function testConnection({ config, apiKey }) {
  const text = await completeText({
    config,
    apiKey,
    messages: [{ role: 'user', content: '只回复两个字：在的' }],
    maxTokens: 16,
    temperature: 0,
  });
  return { ok: true, reply: text.trim(), model: config.model };
}

module.exports = {
  ApiError,
  friendlyError,
  streamChat,
  completeText,
  testConnection,
  dataUrlFromFile,
  normalizeBaseUrl,
};

