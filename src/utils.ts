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
