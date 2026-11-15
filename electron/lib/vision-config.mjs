export const DEEPSEEK_URL = 'https://api.deepseek.com';
export const DEFAULT_VISION_MODEL = 'deepseek-flash';
const VERIFIED_VISION_ERROR = '请在「设置 → API」保存能通过看图验证的模型。';

function normalizeEndpoint(value) {
  const address = String(value ?? '').trim().replace(/\/+$/, '');
  return address || DEEPSEEK_URL;
}

function originOf(value) {
  try { return new URL(normalizeEndpoint(value)).origin; } catch { return ''; }
}

export function isDeepSeekEndpoint(value) {
  return originOf(value) === DEEPSEEK_URL;
}

export function migrateVisionModel(config) {
  return isDeepSeekEndpoint(config.baseUrl) ? DEFAULT_VISION_MODEL : String(config.model ?? '').trim();
}

function visionIdentity(config) {
  return JSON.stringify([normalizeEndpoint(config.baseUrl), config.model]);
}

export function validateVisionModel(config) {
  if (!String(config.model ?? '').trim()) throw new Error('模型名不能为空。');
  if (isDeepSeekEndpoint(config.baseUrl) && config.model !== DEFAULT_VISION_MODEL) {
    throw new Error('DeepSeek 官方接口请选择支持看图的 deepseek-flash。');
  }
}

export function isVisionReady(config) {
  return isDeepSeekEndpoint(config.baseUrl)
    ? config.model === DEFAULT_VISION_MODEL
    : config.verifiedVision === visionIdentity(config);
}

export function assertVisionReady(config) {
  if (!isVisionReady(config)) throw new Error(VERIFIED_VISION_ERROR);
}

export function connectionTestInput(current, input) {
  const baseUrl = normalizeEndpoint(input?.baseUrl ?? current.baseUrl);
  const model = String(input?.model ?? current.model).trim();
  const apiKey = String(input?.apiKey ?? '').trim();
  return { baseUrl, model, apiKey: apiKey || (originOf(baseUrl) === originOf(current.baseUrl) ? current.apiKey : '') };
}

// Commit a custom selection only after the exact endpoint, model and key pass
// the image check. The verification stored on disk contains no credentials.
export async function verifyVisionSettings({ current, patch, test }) {
  const next = connectionTestInput(current, {
    ...patch,
    apiKey: patch.clearApiKey ? '' : patch.apiKey,
  });
  if (patch.clearApiKey || patch.apiKey === '') next.apiKey = '';
  const sameSelection = visionIdentity(next) === visionIdentity(current);
  const sameKey = next.apiKey === current.apiKey;
  if (sameSelection && sameKey && (!patch.verifyVision || isVisionReady(current))) return current.verifiedVision;

  validateVisionModel(next);
  if (isDeepSeekEndpoint(next.baseUrl)) return '';
  if (sameSelection && !next.apiKey) return '';
  if (!next.apiKey) throw new Error('请填写该 API 地址的 Key，再保存看图模型。');
  await test(next);
  return visionIdentity(next);
}

const COLORS = [
  ['red', '#e32d36'],
  ['green', '#1bac56'],
  ['blue', '#2459ea'],
  ['yellow', '#ffd729'],
];

export async function runVisionCheck({ renderImage, complete }) {
  const colors = Array.from({ length: 6 }, () => COLORS[Math.floor(Math.random() * COLORS.length)]);
  const image = renderImage(colors.map(([, hex]) => hex));
  const reply = String(await complete([{
    role: 'user',
    content: [
      { type: 'text', text: 'Read the six vertical color bars from left to right. Reply with exactly six English color names separated by spaces. Use only red, green, blue, and yellow.' },
      { type: 'image_url', image_url: { url: image, detail: 'low' } },
    ],
  }])).trim();
  const actual = reply.toLowerCase().match(/[a-z]+/g)?.join(' ');
  if (actual !== colors.map(([name]) => name).join(' ')) {
    throw new Error('模型没有通过看图验证，请使用支持图片输入的模型。');
  }
  return reply;
}
