'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS_PATH = path.join(__dirname, '..', 'prompts.default.json');
const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

function readDefaults() {
  try {
    const raw = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  } catch {}
  return {};
}

/** 系统默认提示词。修改它等于修改所有新安装的默认值。 */
const defaults = readDefaults();

function keys() {
  return Object.keys(defaults);
}

function has(key) {
  return Object.prototype.hasOwnProperty.call(defaults, key);
}

function get(key) {
  return typeof defaults[key] === 'string' ? defaults[key] : '';
}

/**
 * 渲染模板：只替换调用方明确提供的变量，未知的 {xxx} 原样保留，
 * 这样管理员自己在提示词里写花括号也不会被吃掉。
 */
function render(template, vars) {
  const text = typeof template === 'string' ? template : '';
  if (!text) return '';
  return text.replace(PLACEHOLDER, (match, key) => {
    if (vars && Object.prototype.hasOwnProperty.call(vars, key)) {
      const value = vars[key];
      return value === undefined || value === null ? '' : String(value);
    }
    return match;
  });
}

/** 系统默认 + 用户覆盖层。用户层里只有非空字符串才算覆盖。 */
function resolve(overrides) {
  const out = { ...defaults };
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value === 'string' && value.trim()) out[key] = value;
    }
  }
  return out;
}

/** 开发人员模式：直接把默认值写回 prompts.default.json。 */
function writeDefaults(values) {
  const next = { ...defaults };
  let changed = 0;
  for (const [key, value] of Object.entries(values || {})) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue;
    next[key] = String(value === undefined || value === null ? '' : value);
    changed += 1;
  }
  if (!changed) return { changed: 0, file: DEFAULTS_PATH };
  fs.writeFileSync(DEFAULTS_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  for (const [key, value] of Object.entries(next)) defaults[key] = value;
  return { changed, file: DEFAULTS_PATH };
}

module.exports = {
  DEFAULTS_PATH,
  defaults,
  keys,
  has,
  get,
  render,
  resolve,
  writeDefaults,
};
