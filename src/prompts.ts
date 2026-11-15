import defaultsJson from '../electron/prompts.default.json';

/**
 * 提示词默认值从 electron/prompts.default.json 读取。
 * 桌面端主进程与手机端都用这一份，改默认值只改那个文件。
 */
export type PromptValues = Record<string, string>;

export const PROMPT_DEFAULTS: PromptValues = defaultsJson as PromptValues;
export const PROMPT_KEYS: string[] = Object.keys(PROMPT_DEFAULTS);

export interface PromptField {
  key: string;
  label: string;
  hint?: string;
  vars?: string[];
  rows?: number;
}

export interface PromptGroup {
  id: string;
  label: string;
  desc: string;
  fields: PromptField[];
}

const DATA_VARS = ['{name}', '{date}', '{item}', '{context}', '{digest}', '{changes}', '{time}', '{names}', '{count}', '{model}'];

export const PROMPT_SCHEMA: PromptGroup[] = [
  {
    id: 'persona',
    label: '人格底色',
    desc: '管理员每一次开口前的基础设定。进阶项会自动接在它后面。',
    fields: [
      { key: 'persona', label: '人格底色', hint: '角色是谁、说话方式、边界。', vars: ['{name}'], rows: 12 },
    ],
  },
  {
    id: 'ritual',
    label: '上贡流程',
    desc: '每天一次的上贡：擦拭、意淫、教唆。这里是阶段规则和开场白。',
    fields: [
      { key: 'ritual.phaseWipe', label: '阶段 · 擦拭', hint: '已拥有的藏品，用户正在动手除尘。', vars: ['{name}'] },
      { key: 'ritual.phaseFantasy', label: '阶段 · 意淫', hint: '待补款的藏品，只有宣传图。', vars: ['{name}'] },
      { key: 'ritual.phaseInstigate', label: '阶段 · 教唆', hint: '观望中的藏品，逼用户做决定。', vars: ['{name}'] },
      { key: 'ritual.scene', label: '系统块 · 日期与场景', hint: '每次上贡的 system 里最先出现的一段。', vars: ['{date}', '{name}'] },
      { key: 'ritual.tools', label: '系统块 · 工具权限', hint: '告诉管理员可以自己查记忆。', vars: ['{name}'] },
      { key: 'ritual.output', label: '系统块 · 输出要求', hint: '只说话，不写旁白。', vars: ['{name}'] },
      { key: 'ritual.itemBlock', label: '区块 · 当前周边', hint: '周边资料的标题行，{context} 是应用自动生成的资料。', vars: ['{context}'] },
      { key: 'ritual.characterBlock', label: '区块 · 角色档案', hint: '角色资料的标题行（上贡和日常共用）。', vars: ['{context}'] },
      { key: 'ritual.memoryBlock', label: '区块 · 旧记忆', hint: '往事节选的标题行。', vars: ['{digest}'] },
      { key: 'ritual.opening', label: '开场 · 本轮第一句', hint: '每轮上贡第一条消息，逼管理员先开口。', vars: ['{item}', '{photoNote}', '{name}'], rows: 5 },
      { key: 'ritual.photoAttached', label: '照片 · 附在用户消息后', hint: '{text} 是用户这句话，{photoNote} 是照片说明。', vars: ['{text}', '{photoNote}'] },
      { key: 'ritual.photoNote', label: '照片 · 有图时', hint: '{count} 张数，{names} 照片清单。', vars: ['{count}', '{names}'] },
      { key: 'ritual.photoNoteNoFiles', label: '照片 · 没上传图', hint: '周边没有照片文件时的说明。', vars: [] },
      { key: 'ritual.photoNoteNoVision', label: '照片 · 模型不能看图', hint: '{model} 是当前模型名。', vars: ['{model}', '{names}'] },
    ],
  },
  {
    id: 'freechat',
    label: '日常聊天 / 主动话题',
    desc: '不在上贡流程里的对话、新藏品开场、每日主动找你说话。',
    fields: [
      { key: 'freechat.scene', label: '系统块 · 日期与场景', hint: '日常对话的 system 开头。', vars: ['{date}', '{name}'] },
      { key: 'freechat.tools', label: '系统块 · 工具权限', hint: '日常对话里查记忆的说明。', vars: [] },
      { key: 'freechat.output', label: '系统块 · 输出要求', hint: '只输出要对用户说的话。', vars: ['{name}'] },
      { key: 'freechat.collectionBlock', label: '区块 · 收藏室', hint: '收藏室摘要的标题行。', vars: ['{digest}'] },
      { key: 'freechat.characterBlock', label: '区块 · 角色档案', hint: '角色摘要的标题行。', vars: ['{digest}'] },
      { key: 'freechat.itemBlock', label: '区块 · 聚焦周边', hint: '某段对话绑定周边时的标题行。', vars: ['{context}'] },
      { key: 'freechat.memoryBlock', label: '区块 · 旧记忆', hint: '往事节选的标题行。', vars: ['{digest}'] },
      { key: 'freechat.openingItem', label: '开场 · 藏品话题', hint: '打开一段围绕某款周边的对话。', vars: ['{name}', '{item}', '{context}'], rows: 5 },
      { key: 'freechat.openingDaily', label: '开场 · 日常', hint: '打开收藏室时管理员主动开口。', vars: ['{name}'], rows: 4 },
      { key: 'freechat.photoNote', label: '照片 · 随消息附图', hint: '{names} 是照片清单。', vars: ['{names}'] },
      { key: 'freechat.itemIntroCreate', label: '藏品 · 新入库', hint: '记录一款新藏品后主动开场。', vars: ['{name}', '{item}', '{context}'], rows: 6 },
      { key: 'freechat.itemIntroUpdate', label: '藏品 · 资料更新', hint: '{changes} 是前后差异。', vars: ['{name}', '{item}', '{changes}', '{context}'], rows: 7 },
      { key: 'freechat.proactive', label: '每日主动话题', hint: '{time} 是设定的时间。', vars: ['{time}', '{name}'], rows: 5 },
    ],
  },
  {
    id: 'summary',
    label: '记忆整理',
    desc: '每次上贡结束后，用一次独立的小请求把这段对话写成记忆摘要。',
    fields: [
      { key: 'summary.system', label: '记忆整理员指令', hint: '标题里写了 140 字上限，改这里就能改摘要长度。', vars: [], rows: 5 },
    ],
  },
];

export const PROMPT_VARS_HELP = DATA_VARS;

/** 渲染模板，只替换调用方提供的变量。 */
export function renderPrompt(template: string, vars?: Record<string, string | number | undefined | null>): string {
  const text = typeof template === 'string' ? template : '';
  if (!text) return '';
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (vars && Object.prototype.hasOwnProperty.call(vars, key)) {
      const value = vars[key as keyof typeof vars];
      return value === undefined || value === null ? '' : String(value);
    }
    return match;
  });
}

/** 系统默认 + 用户覆盖层。 */
export function resolvePrompts(overrides?: Record<string, string> | null): PromptValues {
  const out: PromptValues = { ...PROMPT_DEFAULTS };
  if (overrides && typeof overrides === 'object') {
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value === 'string' && value.trim()) out[key] = value;
    }
  }
  return out;
}

/** 判断某个键是否被用户改过（与默认值不同）。 */
export function isPromptOverridden(key: string, overrides?: Record<string, string> | null): boolean {
  return Boolean(overrides && typeof overrides[key] === 'string' && overrides[key].trim());
}
