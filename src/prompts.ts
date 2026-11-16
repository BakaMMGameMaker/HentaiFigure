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
  label?: string;
  desc?: string;
  fields: PromptField[];
}

const DATA_VARS = ['{name}', '{date}', '{item}', '{context}', '{digest}', '{changes}', '{time}', '{names}', '{count}'];

export const PROMPT_SCHEMA: PromptGroup[] = [
  {
    id: 'persona',
    fields: [
      { key: 'persona', label: '人格底色', hint: '管理员每一次开口前的基础设定。进阶项会自动接在它后面。', vars: ['{name}'], rows: 12 },
    ],
  },
  {
    id: 'ritual',
    label: '上贡流程',
    desc: '先发系统提示，再发本阶段的开场指令或已有对话。三条阶段规则只发送当前阶段对应的一条。',
    fields: [
      { key: 'ritual.scene', label: '系统块 · 日期与场景', hint: '接在人格底色后。', vars: ['{date}', '{name}'] },
      { key: 'ritual.tools', label: '系统块 · 工具权限', hint: '说明管理员可以查询藏品和过去的对话。', vars: ['{name}'] },
      { key: 'ritual.phaseWipe', label: '阶段 · 擦拭', hint: '已拥有的藏品，用户正在动手除尘。', vars: ['{name}'] },
      { key: 'ritual.phaseFantasy', label: '阶段 · 意淫', hint: '待补款的藏品，只有宣传图。', vars: ['{name}'] },
      { key: 'ritual.phaseInstigate', label: '阶段 · 教唆', hint: '观望中的藏品，逼用户做决定。', vars: ['{name}'] },
      { key: 'ritual.itemBlock', label: '区块 · 当前周边', hint: '周边资料的标题行，{context} 是应用自动生成的资料。', vars: ['{context}'] },
      { key: 'ritual.characterBlock', label: '区块 · 当前周边的角色档案', hint: '藏品绑定了角色时接在周边资料后。', vars: ['{context}'] },
      { key: 'ritual.memoryBlock', label: '区块 · 旧记忆', hint: '往事节选的标题行。', vars: ['{digest}'] },
      { key: 'ritual.output', label: '系统块 · 输出要求', hint: '规定管理员回复的形式。有可查看的照片时，应用随后加上文字版照片清单。', vars: ['{name}'] },
      { key: 'ritual.photoNoteNoFiles', label: '系统块 · 没上传图', hint: '没有照片时，这段说明接在输出要求后，也可填入消息的 {photoNote}。', vars: [] },
      { key: 'ritual.opening', label: '开场 · 本阶段第一句', hint: '告诉管理员本阶段抽中了哪款周边，并让它先开口。', vars: ['{item}', '{photoNote}', '{name}'], rows: 5 },
      { key: 'ritual.photoNote', label: '对话 · 按需看图说明', hint: '有可查看的照片时填入消息的 {photoNote}。', vars: ['{count}', '{names}'] },
      { key: 'ritual.photoAttached', label: '对话 · 最新用户消息', hint: '接在本阶段已发生的对话后。{text} 是用户刚发的话，可用 {photoNote} 插入照片说明。', vars: ['{text}', '{photoNote}'] },
    ],
  },
  {
    id: 'summary',
    label: '记忆整理',
    desc: '阶段归档时，单独发送整理指令和该阶段的对话记录。',
    fields: [
      { key: 'summary.system', label: '记忆整理员指令', hint: '这里可调整摘要的写法和目标长度。', vars: [], rows: 5 },
    ],
  },
  {
    id: 'freechat',
    label: '日常聊天 / 主动话题',
    desc: '先发系统提示和已有对话，再按场景选用开场指令。',
    fields: [
      { key: 'freechat.scene', label: '系统块 · 日期与场景', hint: '接在人格底色后。', vars: ['{date}', '{name}'] },
      { key: 'freechat.itemBlock', label: '区块 · 聚焦周边', hint: '某段对话绑定周边时，插入该周边的资料。', vars: ['{context}'] },
      { key: 'freechat.tools', label: '系统块 · 工具权限', hint: '说明管理员可以按需查询收藏现状、角色相关的藏品与记忆、最近聊过的藏品和全库。', vars: [] },
      { key: 'freechat.output', label: '系统块 · 输出要求', hint: '规定管理员回复的形式。有可查看的照片时，应用随后加上文字版照片清单。', vars: ['{name}'] },
      { key: 'freechat.openingItem', label: '开场 · 藏品话题', hint: '打开一段围绕某款周边的对话。', vars: ['{name}', '{item}', '{context}'], rows: 5 },
      { key: 'freechat.openingDaily', label: '开场 · 日常', hint: '普通聊天开始且还没有对话记录时使用。', vars: ['{name}'], rows: 4 },
      { key: 'freechat.itemIntroCreate', label: '藏品 · 新入库', hint: '记录一款新藏品后主动开场。', vars: ['{name}', '{item}', '{context}'], rows: 6 },
      { key: 'freechat.itemIntroUpdate', label: '藏品 · 资料更新', hint: '{changes} 是前后差异。', vars: ['{name}', '{item}', '{changes}', '{context}'], rows: 7 },
      { key: 'freechat.proactive', label: '每日主动话题', hint: '{time} 是设定的时间。', vars: ['{time}', '{name}'], rows: 5 },
      { key: 'freechat.photoNote', label: '主动开场 · 照片说明', hint: '主动开场且有可查看的藏品照片时，接在开场指令后。', vars: ['{names}'] },
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
