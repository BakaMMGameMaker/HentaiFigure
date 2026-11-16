export const SHOT_LABELS = {
  promo: '宣传图',
  real: '实物图',
  full: '全身照',
  face: '脸蛋',
  armpit: '腋下',
  chest: '胸部',
  back: '美背',
  belly: '肚子',
  private: '私处',
  butt: '屁股',
  underSkirt: '裙底',
  thigh: '大腿',
  feet: '玉足',
  other: '其他',
};

export const SHOT_OPTIONS = Object.entries(SHOT_LABELS).map(([value, label]) => ({ value, label }));
const shotOrder = new Map(SHOT_OPTIONS.map(({ value }, index) => [value, index]));

export function shotLabel(shot) {
  return SHOT_OPTIONS[shotOrder.get(shot)]?.label || '照片';
}

export function sortPhotos(photos) {
  const order = (shot) => shotOrder.get(shot) ?? SHOT_OPTIONS.length;
  return [...photos].sort((a, b) => order(a.shot) - order(b.shot) || (a.createdAt || 0) - (b.createdAt || 0));
}
