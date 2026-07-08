// Date helpers over plain 'YYYY-MM-DD' strings (all date math is UTC, no library).

export const todayStr = () => new Date().toISOString().slice(0, 10);

const parse = (s: string) => {
  const [y = 0, m = 1, d = 1] = s.slice(0, 10).split('-').map(Number);
  return { y, m, d };
};

const pad = (n: number) => String(n).padStart(2, '0');
const toStr = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Add months, clamping the day like date-fns (Jan 31 + 1mo = Feb 28/29). */
export function addMonths(dateStr: string, months: number): string {
  const { y, m, d } = parse(dateStr);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toStr(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addDays(dateStr: string, days: number): string {
  const { y, m, d } = parse(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Jul 7, 2026' - or a dash for null. */
export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const { y, m, d } = parse(dateStr);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** 'Jul 7, 2026, 14:05 UTC' from an ISO timestamp. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const t = iso.slice(11, 16);
  return t ? `${fmtDate(iso)}, ${t} UTC` : fmtDate(iso);
}

/** 'Jul 7, 2026' or 'Jul 7 - Jul 9, 2026' when the span has an end date. */
export function fmtRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return '-';
  if (!end || end === start) return fmtDate(start);
  return `${fmtDate(start)} - ${fmtDate(end)}`;
}

/** 'YYYY-MM' bucket. */
export const monthKey = (dateStr: string) => dateStr.slice(0, 7);

/** 'Jul 2026' from a 'YYYY-MM' key. */
export function fmtMonth(key: string): string {
  const [y = 0, m = 1] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** First day of the month `offset` months from the current one, as 'YYYY-MM-DD'. */
export function monthStart(offset = 0): string {
  const t = new Date();
  const total = t.getUTCFullYear() * 12 + t.getUTCMonth() + offset;
  return toStr(Math.floor(total / 12), (total % 12) + 1, 1);
}
