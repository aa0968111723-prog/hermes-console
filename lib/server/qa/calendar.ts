export const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"] as const;

export type CalendarDate = { year: number; month: number; day: number };

export function taipeiWeekday(date: CalendarDate): number {
  const utc = Date.UTC(date.year, date.month - 1, date.day, 4, 0, 0);
  return new Date(utc).getUTCDay();
}

export function weekdayLabel(day: number): string {
  return "週" + WEEKDAY_ZH[day]!;
}

export function parseCalendarDate(value: string): CalendarDate | null {
  const iso = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return pack(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const zh = value.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/);
  if (zh) return pack(Number(zh[1]), Number(zh[2]), Number(zh[3]));
  return null;
}

function pack(year: number, month: number, day: number): CalendarDate | null {
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31)
    return null;
  const probe = new Date(Date.UTC(year, month - 1, day, 4, 0, 0));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  )
    return null;
  return { year, month, day };
}

export function sameDate(a: CalendarDate, b: CalendarDate) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function formatDate(date: CalendarDate) {
  return (
    date.year +
    "-" +
    String(date.month).padStart(2, "0") +
    "-" +
    String(date.day).padStart(2, "0")
  );
}

export type ExtractedDate = {
  raw: string;
  date: CalendarDate;
  weekday: number | null;
};

export function extractDatesFromText(
  text: string,
  yearHint: number | null,
): ExtractedDate[] {
  const found: ExtractedDate[] = [];
  const push = (raw: string, date: CalendarDate | null, weekday: number | null) => {
    if (!date) return;
    found.push({ raw, date, weekday });
  };

  const full =
    /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/g;
  for (const match of text.matchAll(full)) {
    push(
      match[0],
      pack(Number(match[1]), Number(match[2]), Number(match[3])),
      weekdayNear(text, match.index || 0, match[0].length),
    );
  }

  const md = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
  for (const match of text.matchAll(md)) {
    const year = yearHint;
    if (!year) continue;
    push(
      match[0],
      pack(year, Number(match[1]), Number(match[2])),
      weekdayNear(text, match.index || 0, match[0].length),
    );
  }

  const slash = /(^|[^\d])(\d{1,2})\/(\d{1,2})(?!\d)/g;
  for (const match of text.matchAll(slash)) {
    const year = yearHint;
    if (!year) continue;
    const raw = match[2] + "/" + match[3];
    const index = (match.index || 0) + match[1]!.length;
    if (text.slice(Math.max(0, index - 5), index).match(/\d{4}\s*[-/.]/))
      continue;
    push(
      raw,
      pack(year, Number(match[2]), Number(match[3])),
      weekdayNear(text, index, raw.length),
    );
  }

  return found;
}

const WEEKDAY_RE = /[（(]?\s*[週周星期]?\s*([一二三四五六日天])\s*[）)]?/;

export function extractWeekdaysFromText(text: string) {
  const hits: Array<{ raw: string; day: number }> = [];
  const re = /[週周星期]([一二三四五六日天])/g;
  for (const match of text.matchAll(re)) {
    const day = weekdayIndex(match[1]!);
    if (day !== null) hits.push({ raw: match[0], day });
  }
  return hits;
}

function weekdayNear(text: string, index: number, length: number): number | null {
  const window = text.slice(Math.max(0, index - 2), index + length + 8);
  const match = window.match(WEEKDAY_RE);
  return match ? weekdayIndex(match[1]!) : null;
}

function weekdayIndex(token: string): number | null {
  if (token === "日" || token === "天") return 0;
  const order = "一二三四五六";
  const i = order.indexOf(token);
  return i >= 0 ? i + 1 : null;
}

export function dateWeekdayConflicts(
  text: string,
  factDates: string[],
): Array<{ claimed: string; actual: string; raw: string }> {
  const hints = factDates
    .map(parseCalendarDate)
    .filter((item): item is CalendarDate => !!item);
  const yearHint = hints[0]?.year ?? null;
  const conflicts: Array<{ claimed: string; actual: string; raw: string }> = [];
  for (const item of extractDatesFromText(text, yearHint)) {
    if (item.weekday === null) continue;
    const actual = taipeiWeekday(item.date);
    if (actual !== item.weekday) {
      conflicts.push({
        raw: item.raw,
        claimed: weekdayLabel(item.weekday),
        actual: weekdayLabel(actual),
      });
    }
  }
  return conflicts;
}

export function copyMentionsDate(text: string, value: string, yearHint: number | null) {
  if (text.includes(value)) return true;
  const parsed = parseCalendarDate(value) || parseLooseDate(value, yearHint);
  if (!parsed) return false;
  if (text.includes(formatDate(parsed))) return true;
  if (text.includes(parsed.year + "/" + parsed.month + "/" + parsed.day)) return true;
  if (text.includes(parsed.month + "月" + parsed.day + "日")) return true;
  return extractDatesFromText(text, yearHint ?? parsed.year).some((item) =>
    sameDate(item.date, parsed),
  );
}

function parseLooseDate(value: string, yearHint: number | null): CalendarDate | null {
  const slash = value.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slash) return pack(Number(slash[1]), Number(slash[2]), Number(slash[3]));
  const md = value.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md && yearHint) return pack(yearHint, Number(md[1]), Number(md[2]));
  return null;
}
