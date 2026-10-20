// The date range and filters a page shows, read from the query string.

import { DIMENSIONS, type Filters } from "./api";
import { addDays, addMonths, daysBetween, startOfMonth, startOfWeek, today } from "./dates";
import type { StringKey, Translate, Formats } from "./i18n";

export const RANGES: { id: string; label: StringKey; key?: string }[] = [
  { id: "today", label: "today", key: "T" },
  { id: "yesterday", label: "yesterday" },
  { id: "week", label: "thisWeek", key: "W" },
  { id: "last_week", label: "lastWeek" },
  { id: "last_7_days", label: "last7", key: "7" },
  { id: "last_30_days", label: "last30", key: "3" },
  { id: "month", label: "thisMonth", key: "M" },
  { id: "last_month", label: "lastMonth" },
  { id: "year", label: "thisYear", key: "Y" },
  { id: "last_12_months", label: "last12Months", key: "1" },
  { id: "all_time", label: "allTime", key: "A" },
];

export const DEFAULT_RANGE = "last_7_days";

export interface RangeQuery {
  range?: string;
  from?: string;
  to?: string;
}

const isDay = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** The API query for the current range: either a named range or explicit dates (to inclusive). */
export function rangeParams(q: Record<string, string>): RangeQuery {
  if (isDay(q.from) && isDay(q.to)) return { from: q.from, to: q.to };
  return { range: RANGES.some((r) => r.id === q.range) ? q.range : DEFAULT_RANGE };
}

/**
 * The current range as days, `to` inclusive (same rules as the server).
 * All time has no fixed start: it's reported as null.
 */
export function rangeDays(q: Record<string, string>, me: { timezone: string; weekStart: number }): { from: string | null; to: string } {
  const p = rangeParams(q);
  if (p.from && p.to) return { from: p.from, to: p.to };
  const t = today(me.timezone);
  switch (p.range) {
    case "today":
      return { from: t, to: t };
    case "yesterday":
      return { from: addDays(t, -1), to: addDays(t, -1) };
    case "week":
      return { from: startOfWeek(t, me.weekStart), to: t };
    case "last_week": {
      const s = startOfWeek(t, me.weekStart);
      return { from: addDays(s, -7), to: addDays(s, -1) };
    }
    case "last_30_days":
      return { from: addDays(t, -29), to: t };
    case "month":
      return { from: startOfMonth(t), to: t };
    case "last_month":
      return { from: addMonths(t, -1), to: addDays(startOfMonth(t), -1) };
    case "year":
      return { from: `${t.slice(0, 4)}-01-01`, to: t };
    case "last_12_months":
      return { from: addDays(t, -364), to: t };
    case "all_time":
      return { from: null, to: t };
    default:
      return { from: addDays(t, -6), to: t };
  }
}

/**
 * The period before or after the current one, as explicit dates. Whole months and years move by
 * month or year; anything else by its length in days. Null when it would only reach the future.
 */
export function shiftRange(q: Record<string, string>, me: { timezone: string; weekStart: number }, dir: 1 | -1): { from: string; to: string } | null {
  const { from, to } = rangeDays(q, me);
  if (!from) return null;
  const t = today(me.timezone);
  let next: { from: string; to: string };
  const wholeMonth = from === startOfMonth(from) && (addDays(to, 1) === startOfMonth(addDays(to, 1)) || (to === t && from === startOfMonth(t)));
  const wholeYear = from.slice(5) === "01-01" && (to.slice(5) === "12-31" || (to === t && from.slice(0, 4) === t.slice(0, 4)));
  if (wholeYear) {
    const y = Number(from.slice(0, 4)) + dir;
    next = { from: `${y}-01-01`, to: `${y}-12-31` };
  } else if (wholeMonth && from.slice(0, 7) === to.slice(0, 7)) {
    const start = addMonths(from, dir);
    next = { from: start, to: addDays(addMonths(start, 1), -1) };
  } else {
    const n = daysBetween(from, to) + 1;
    next = { from: addDays(from, n * dir), to: addDays(to, n * dir) };
  }
  if (next.from > t) return null;
  if (next.to > t) next.to = t;
  return next;
}

export function rangeLabel(q: Record<string, string>, t: Translate, f: Formats): string {
  const p = rangeParams(q);
  if (p.from && p.to) return p.from === p.to ? f.mediumDate(p.from) : `${f.shortDate(p.from)} – ${f.mediumDate(p.to)}`;
  return t(RANGES.find((r) => r.id === p.range)!.label);
}

/** The range that comes right before, as explicit dates, to compare against. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  // `to` from the API is exclusive.
  const days = daysBetween(from, to);
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

export function filtersOf(q: Record<string, string>): Filters {
  const f: Filters = {};
  for (const d of DIMENSIONS) if (q[d] !== undefined) f[d] = q[d];
  return f;
}
