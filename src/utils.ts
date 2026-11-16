import type { Character, ChatThreadSummary, Item, ItemChange } from './types';
import { formatDateCN, formatMoney, statusLabel, typeLabel } from './constants';

export function cleanError(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err ?? '');
  msg = msg.replace(/^Error invoking remote method '[^']+':\s*/, '');
  msg = msg.replace(/^Error:\s*/, '');
  return msg || '出了点问题，再试一次。';
}

export function toNumberOrNull(value: string): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatInputNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

export function formatTime(ts: number | undefined | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function dateKeyOf(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function characterName(characters: Character[] | undefined, id?: string | null): string {
  if (!id) return '';
  return characters?.find((c) => c.id === id)?.name || '';
}

function shortText(value: string | undefined, max = 60): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '（空）';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function photoSummary(item: Item): string {
  const photos = item.photos || [];
  if (!photos.length) return '（无照片）';
  return `${photos.length} 张`;
}

/**
 * 对比编辑前后的藏品，产出给管理员看的人话差异。
 * 新增时不返回任何差异（由调用方给出「刚入库」的语境）。
 */
export function describeItemChanges(before: Item | null, after: Item, characters: Character[] = []): ItemChange[] {
  if (!before) return [];
  const changes: ItemChange[] = [];
  const push = (label: string, from: string, to: string) => {
    if (from !== to) changes.push({ label, before: from || '（空）', after: to || '（空）' });
  };

  push('名称', before.name, after.name);
  push('类型', typeLabel(before.type), typeLabel(after.type));
  push('状态', statusLabel(before.status), statusLabel(after.status));
  push('关联角色', characterName(characters, before.characterId) || '未关联', characterName(characters, after.characterId) || '未关联');
  push('规格', String(before.scale || ''), String(after.scale || ''));
  push('原始价格', formatMoney(before.originalPrice), formatMoney(after.originalPrice));
  push('购入价格', formatMoney(before.purchasePrice), formatMoney(after.purchasePrice));
  push('定金', formatMoney(before.deposit), formatMoney(after.deposit));
  push('尾款', formatMoney(before.balance), formatMoney(after.balance));
  push('补款日', before.dueDate ? formatDateCN(before.dueDate) : '', after.dueDate ? formatDateCN(after.dueDate) : '');
  push('商品详情', shortText(before.detail), shortText(after.detail));
  push('最初的想法', shortText(before.thought), shortText(after.thought));
  const beforePhotos = photoSummary(before);
  const afterPhotos = photoSummary(after);
  if (beforePhotos !== afterPhotos) changes.push({ label: '照片', before: beforePhotos, after: afterPhotos });
  return changes;
}

export function describeChangeLines(changes: ItemChange[]): string[] {
  return changes.map((c) => `· ${c.label}：${c.before} → ${c.after}`);
}

const DAY_MS = 86_400_000;

function startOfDay(time: number): number {
  return new Date(time).setHours(0, 0, 0, 0);
}

export interface ThreadGroup {
  key: string;
  label: string;
  threads: ChatThreadSummary[];
}

/** 类似 chat-demo 的会话分组：今天 / 昨天 / 7 天内 / 30 天内 / 按月。 */
export function groupThreads(threads: ChatThreadSummary[], now = Date.now()): ThreadGroup[] {
  const groups: ThreadGroup[] = [];
  for (const thread of threads) {
    const diff = Math.floor((now - startOfDay(thread.updatedAt || 0)) / DAY_MS);
    let key: string;
    let label: string;
    if (diff <= 0) {
      key = 'today';
      label = '今天';
    } else if (diff <= 1) {
      key = 'yesterday';
      label = '昨天';
    } else if (diff < 7) {
      key = 'week';
      label = '7 天内';
    } else if (diff < 30) {
      key = 'month';
      label = '30 天内';
    } else {
      const d = new Date(thread.updatedAt || 0);
      key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      label = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
    }
    const last = groups[groups.length - 1];
    if (last?.key === key) last.threads.push(thread);
    else groups.push({ key, label, threads: [thread] });
  }
  return groups;
}
