import type { Item, ItemStatus, ItemType, Phase, Shot } from './types';

export const STATUS_META: Record<ItemStatus, { label: string; desc: string; short: string; glyph: string }> = {
  owned: { label: '已拥有', desc: '在柜子里，等她落灰，也等你擦拭', short: '拥有', glyph: '所' },
  pending: { label: '待补款', desc: '定金已付，尾款未结，心也悬着', short: '待补', glyph: '待' },
  watching: { label: '观望中', desc: '还在购物车里，只差你点下那个按钮', short: '观望', glyph: '观' },
};

export const TYPE_OPTIONS: { value: ItemType; label: string }[] = [
  { value: 'figure', label: '手办' },
  { value: 'acrylic', label: '亚克力立牌' },
  { value: 'pillow', label: '抱枕' },
  { value: 'poster', label: '海报' },
  { value: 'badge', label: '徽章' },
  { value: 'itabag', label: '痛包' },
  { value: 'plush', label: '毛绒' },
  { value: 'other', label: '其他周边' },
];

export const SHOT_OPTIONS: { value: Shot; label: string; group: 'basic' | 'part' }[] = [
  { value: 'promo', label: '宣传图', group: 'basic' },
  { value: 'real', label: '实物图', group: 'basic' },
  { value: 'full', label: '全身照', group: 'basic' },
  { value: 'face', label: '脸蛋', group: 'part' },
  { value: 'armpit', label: '腋下', group: 'part' },
  { value: 'chest', label: '胸部', group: 'part' },
  { value: 'back', label: '美背', group: 'part' },
  { value: 'belly', label: '肚子', group: 'part' },
  { value: 'mango', label: '芒果', group: 'part' },
  { value: 'butt', label: '屁股', group: 'part' },
  { value: 'underSkirt', label: '裙底', group: 'part' },
  { value: 'thigh', label: '大腿', group: 'part' },
  { value: 'feet', label: '玉足', group: 'part' },
  { value: 'other', label: '其他', group: 'basic' },
];

export const PHASE_META: Record<Phase, { label: string; key: string; desc: string; finish: string }> = {
  wipe: { label: '擦拭', key: 'wipe', desc: '给柜子里的她擦去灰尘，一边擦一边说骚话', finish: '擦拭完毕' },
  fantasy: { label: '意淫', key: 'fantasy', desc: '对着还在补款路上的她，先想个够', finish: '意淫完毕' },
  instigate: { label: '教唆', key: 'instigate', desc: '把购物车里的她，塞进你的待补款清单', finish: '结束教唆' },
};

export const PHASES: Phase[] = ['wipe', 'fantasy', 'instigate'];

export function typeLabel(type: string | undefined): string {
  return TYPE_OPTIONS.find((t) => t.value === type)?.label || '周边';
}

export function shotLabel(shot: string | undefined): string {
  return SHOT_OPTIONS.find((s) => s.value === shot)?.label || '照片';
}

export function statusLabel(status: string | undefined): string {
  if (status === 'owned') return '已拥有';
  if (status === 'pending') return '待补款';
  if (status === 'watching') return '观望中';
  return '未知';
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || (value as unknown) === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

export function formatDateCN(day: string | undefined): string {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return `${y}年${m}月${d}日`;
}

export function weekdayCN(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return '';
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(y, m - 1, d).getDay()];
}

export function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function photoUrl(file: string | undefined, thumb = false, fallback?: string): string {
  const target = thumb ? (file || fallback) : file;
  if (!target) return '';
  return `hf-img://local/${target}`;
}

const UNIVERSAL_GREETINGS = [
  '收藏室的门开着，杂鱼。',
  '今天也来看塑料老婆了吗？',
  '你的手办们在柜子里看着你哦。',
  '呼吸放轻一点，她们在睡觉。',
  '要上贡了吗？我等你很久了。',
  '眼睛往哪里看呢，杂鱼。',
  '灰尘和欲望，今天先清哪个？',
  '有点无聊，来陪我说说话。',
  '你今天的气味，闻起来像刚拆封。',
  '别站在门口，进来。',
  '灯已经调暗了，你懂的。',
  '收藏室的规矩，你还记得吗？',
];

const OWNED_GREETINGS = [
  '落灰了哦，要不要来擦一擦？',
  '她今天也想被你摸一遍。',
  '全身照都拍了，还装什么正经？',
  '柜子里那位，昨天被你冷落了。',
  '想从哪个部位开始擦？',
  '软布准备好了吗，杂鱼？',
  '她的裙摆上有一层灰，你心疼吗？',
  '擦的时候，手别抖。',
];

const PENDING_GREETINGS = [
  '杂鱼，存款还够补尾款吗？',
  '补款日快到了，别装死。',
  '定金都交了，尾款还想赖？',
  '钱包在哭，你在看新品。',
  '她还躺在仓库里，等你接回家。',
  '钱不够的话，我可以借你……利息很贵哦。',
  '你的尾款，和你的理智，哪个先到账？',
  '别假装忘了，短信都发来了。',
];

const WATCHING_GREETINGS = [
  '购物车都快满了，还不下单？',
  '再犹豫，她就绝版了。',
  '你看了她七次，还是没买。',
  '限量两个字，认识吗？',
  '现在不买，以后跪着求。',
  '你的购物车里，藏着多少见不得人的欲望？',
  '下单只要三秒，后悔要三年。',
  '你是在等降价，还是在等自己死心？',
];

const EMPTY_GREETINGS = [
  '收藏室还是空的。先放点什么进来吧。',
  '杂鱼，你连一只塑料老婆都没有？',
  '从第一款开始吧，我陪你挑。',
  '空柜子会寂寞的，你听。',
];

const COMPLETE_GREETINGS = [
  '今日已上贡。乖，去睡吧。',
  '今天很努力了，杂鱼。',
  '上贡完毕，余韵还在吗？',
  '明天再来，别熬夜。',
  '今天的你，还算是有点用。',
];

function pickFrom(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)] || list[0];
}

export function pickGreeting(items: Item[], ritualComplete: boolean, counts?: { owned: number; pending: number; watching: number }): string {
  if (ritualComplete) return pickFrom(COMPLETE_GREETINGS);
  if (!items.length) return pickFrom(EMPTY_GREETINGS);
  const pools: string[][] = [UNIVERSAL_GREETINGS];
  if ((counts?.owned ?? 0) > 0) pools.push(OWNED_GREETINGS);
  if ((counts?.pending ?? 0) > 0) pools.push(PENDING_GREETINGS);
  if ((counts?.watching ?? 0) > 0) pools.push(WATCHING_GREETINGS);
  const pool = pools[Math.floor(Math.random() * pools.length)];
  return pickFrom(pool);
}

export function itemCover(item: Item): string {
  const photos = item.photos || [];
  const full = photos.find((p) => p.shot === 'full');
  const photo = full || photos[0];
  return photo ? (photo.thumbFile || photo.file) : '';
}

export function itemCoverFull(item: Item): string {
  const photos = item.photos || [];
  const full = photos.find((p) => p.shot === 'full');
  const photo = full || photos[0];
  return photo ? photo.file : '';
}

export function totalSpent(items: Item[]): number {
  return items.reduce((sum, item) => {
    const paid = item.status === 'owned'
      ? (item.purchasePrice ?? item.originalPrice ?? 0)
      : (item.deposit ?? 0);
    return sum + (Number(paid) || 0);
  }, 0);
}

export function pendingTail(items: Item[]): number {
  return items.reduce((sum, item) => {
    if (item.status !== 'pending') return sum;
    const tail = item.balance ?? Math.max(0, (item.purchasePrice ?? item.originalPrice ?? 0) - (item.deposit ?? 0));
    return sum + (Number(tail) || 0);
  }, 0);
}

