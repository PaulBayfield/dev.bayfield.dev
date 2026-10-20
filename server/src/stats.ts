// Coding-time queries, all served from the `daily_stats` rollup (files come from heartbeats).

import { COLUMN, DIMENSIONS, sql, type Dimension } from "./db.ts";
import { statsVersion } from "./durations.ts";
import type { User } from "./users.ts";

export type Filters = Partial<Record<Dimension, string>>;

export interface Item {
  name: string;
  seconds: number;
}

export interface Summary {
  from: string;
  to: string;
  total: number;
  /** One entry per day in the range, zeros included. */
  days: { date: string; total: number; projects: Record<string, number> }[];
  breakdowns: Record<Dimension, Item[]>;
}

// --- Dates (local to the user) ---

/** "YYYY-MM-DD" for `date` as seen in `tz`. */
export function localDate(tz: string, date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

export function startOfWeek(day: string, weekStart: number): string {
  return addDays(day, -((weekday(day) - weekStart + 7) % 7));
}

export const RANGES = ["today", "yesterday", "week", "last_week", "last_7_days", "last_30_days", "month", "last_month", "year", "last_12_months", "all_time"] as const;
export type Range = (typeof RANGES)[number];

/**
 * A named range as local dates, `from` inclusive and `to` exclusive.
 * wakatime-cli's names ("Last 7 Days", "last_7_days", "today") are accepted too.
 */
export function rangeBounds(name: string, user: Pick<User, "timezone" | "weekStart">): { from: string; to: string } | null {
  const key = name.toLowerCase().replace(/[\s-]+/g, "_");
  const today = localDate(user.timezone);
  const tomorrow = addDays(today, 1);
  const month = today.slice(0, 8) + "01";
  switch (key) {
    case "today":
      return { from: today, to: tomorrow };
    case "yesterday":
      return { from: addDays(today, -1), to: today };
    case "week":
    case "this_week":
      return { from: startOfWeek(today, user.weekStart), to: tomorrow };
    case "last_week": {
      const start = startOfWeek(today, user.weekStart);
      return { from: addDays(start, -7), to: start };
    }
    case "last_7_days":
      return { from: addDays(today, -6), to: tomorrow };
    case "last_14_days":
      return { from: addDays(today, -13), to: tomorrow };
    case "last_30_days":
      return { from: addDays(today, -29), to: tomorrow };
    case "month":
    case "this_month":
      return { from: month, to: tomorrow };
    case "last_month": {
      const d = new Date(`${month}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - 1);
      return { from: d.toISOString().slice(0, 10), to: month };
    }
    case "year":
    case "this_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: tomorrow };
    case "last_12_months":
    case "last_year":
      return { from: addDays(today, -364), to: tomorrow };
    case "all_time":
      return { from: "1970-01-01", to: tomorrow };
    default: {
      const n = Number(key.match(/^last_(\d+)_days$/)?.[1]);
      return n >= 1 && n <= 3660 ? { from: addDays(today, -(n - 1)), to: tomorrow } : null;
    }
  }
}

// --- Cache ---

/** Results stay valid until the user's numbers change (ingest, import, settings). */
const cache = new Map<string, { version: number; value: unknown }>();
async function cached<T>(user: User, key: string, load: () => Promise<T>): Promise<T> {
  const k = `${user.id}|${user.timezone}|${key}`;
  const version = statsVersion(user.id);
  const hit = cache.get(k);
  if (hit && hit.version === version) return hit.value as T;
  const value = await load();
  cache.set(k, { version, value });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return value;
}

function where(user: User, from: string, to: string, filters: Filters) {
  let w = sql`user_id = ${user.id} AND day >= ${from}::date AND day < ${to}::date`;
  for (const d of DIMENSIONS) {
    const v = filters[d];
    if (v !== undefined) w = sql`${w} AND ${sql(COLUMN[d])} = ${v}`;
  }
  return w;
}

// --- Queries ---

export async function summary(user: User, from: string, to: string, filters: Filters): Promise<Summary> {
  return cached(user, `summary|${from}|${to}|${JSON.stringify(filters)}`, async () => {
    // All_time starts at the first day with data, not 1970.
    if (from === "1970-01-01") {
      const [first] = await sql<{ day: string | null }[]>`SELECT min(day)::text AS day FROM daily_stats WHERE user_id = ${user.id}`;
      from = first?.day ?? addDays(to, -1);
    }

    // One pass over the rollup: per day, per day and project, and per dimension.
    const rows = await sql<{ g: number; day: string | null; seconds: number; [k: string]: unknown }[]>`
      SELECT
        GROUPING(day, project, language, editor, operating_system, machine, branch, category) AS g,
        day::text, project, language, editor, operating_system, machine, branch, category,
        sum(seconds)::float8 AS seconds
      FROM daily_stats
      WHERE ${where(user, from, to, filters)}
      GROUP BY GROUPING SETS ((day), (day, project), (project), (language), (editor), (operating_system), (machine), (branch), (category))`;

    // GROUPING() sets a bit for every column left out; bit 7 is `day`, bit 0 is `category`.
    const ALL = 0b11111111;
    const onlyDay = ALL & ~(1 << 7);
    const dayProject = ALL & ~(1 << 7) & ~(1 << 6);
    const dimBit: Record<Dimension, number> = { project: 6, language: 5, editor: 4, operatingSystem: 3, machine: 2, branch: 1, category: 0 };

    const byDay = new Map<string, { total: number; projects: Record<string, number> }>();
    const breakdowns = Object.fromEntries(DIMENSIONS.map((d) => [d, [] as Item[]])) as Record<Dimension, Item[]>;
    for (const r of rows) {
      if (r.g === onlyDay) {
        byDay.set(r.day!, { ...(byDay.get(r.day!) ?? { projects: {} }), total: r.seconds });
      } else if (r.g === dayProject) {
        const entry = byDay.get(r.day!) ?? { total: 0, projects: {} };
        entry.projects[r.project as string] = r.seconds;
        byDay.set(r.day!, entry);
      } else {
        for (const d of DIMENSIONS) {
          if (r.g === (ALL & ~(1 << dimBit[d]))) breakdowns[d].push({ name: r[d] as string, seconds: r.seconds });
        }
      }
    }
    for (const d of DIMENSIONS) breakdowns[d].sort((a, b) => b.seconds - a.seconds);

    const days: Summary["days"] = [];
    for (let day = from; day < to; day = addDays(day, 1)) {
      const entry = byDay.get(day);
      days.push({ date: day, total: entry?.total ?? 0, projects: entry?.projects ?? {} });
    }
    return { from, to, total: days.reduce((sum, d) => sum + d.total, 0), days, breakdowns };
  });
}

/** Daily totals for the heatmap. */
export async function activity(user: User, from: string, to: string, filters: Filters = {}): Promise<{ date: string; seconds: number }[]> {
  return cached(user, `activity|${from}|${to}|${JSON.stringify(filters)}`, async () => {
    const rows = await sql<{ day: string; seconds: number }[]>`
      SELECT day::text, sum(seconds)::float8 AS seconds FROM daily_stats
      WHERE ${where(user, from, to, filters)} GROUP BY day`;
    const map = new Map(rows.map((r) => [r.day, r.seconds]));
    const out: { date: string; seconds: number }[] = [];
    for (let day = from; day < to; day = addDays(day, 1)) out.push({ date: day, seconds: map.get(day) ?? 0 });
    return out;
  });
}

export interface ProjectRow {
  name: string;
  seconds: number;
  firstDay: string;
  lastDay: string;
  /** Last 30 days. */
  recent: number;
}

export async function projects(user: User): Promise<ProjectRow[]> {
  return cached(user, "projects", async () => {
    const since = addDays(localDate(user.timezone), -29);
    return sql<ProjectRow[]>`
      SELECT project AS name, sum(seconds)::float8 AS seconds, min(day)::text AS first_day, max(day)::text AS last_day,
             coalesce(sum(seconds) FILTER (WHERE day >= ${since}::date), 0)::float8 AS recent
      FROM daily_stats WHERE user_id = ${user.id}
      GROUP BY project ORDER BY max(day) DESC, sum(seconds) DESC`;
  });
}

/** Most worked-on files of a project, read from heartbeats (the rollup doesn't keep them). */
export async function files(user: User, project: string, from: string, to: string, filters: Filters): Promise<Item[]> {
  return cached(user, `files|${project}|${from}|${to}|${JSON.stringify(filters)}`, async () => {
    let w = sql`user_id = ${user.id} AND project = ${project}
      AND time >= (${from}::date::timestamp AT TIME ZONE ${user.timezone})
      AND time < (${to}::date::timestamp AT TIME ZONE ${user.timezone})`;
    for (const d of DIMENSIONS) {
      const v = filters[d];
      if (v !== undefined && d !== "project") w = sql`${w} AND ${sql(COLUMN[d])} = ${v}`;
    }
    return sql<Item[]>`
      SELECT entity AS name, sum(duration)::float8 AS seconds FROM heartbeats
      WHERE ${w} AND type = 'file'
      GROUP BY entity HAVING sum(duration) > 0 ORDER BY 2 DESC LIMIT 100`;
  });
}

/** Seconds per local hour of day (0–23) and weekday (0 = Sunday), for "when do you code". */
export async function rhythm(user: User, from: string, to: string, filters: Filters): Promise<number[][]> {
  return cached(user, `rhythm|${from}|${to}|${JSON.stringify(filters)}`, async () => {
    let w = sql`user_id = ${user.id}
      AND time >= (${from}::date::timestamp AT TIME ZONE ${user.timezone})
      AND time < (${to}::date::timestamp AT TIME ZONE ${user.timezone})`;
    for (const d of DIMENSIONS) {
      const v = filters[d];
      if (v !== undefined) w = sql`${w} AND ${sql(COLUMN[d])} = ${v}`;
    }
    const rows = await sql<{ dow: number; hour: number; seconds: number }[]>`
      SELECT extract(dow FROM time AT TIME ZONE ${user.timezone})::int AS dow,
             extract(hour FROM time AT TIME ZONE ${user.timezone})::int AS hour,
             sum(duration)::float8 AS seconds
      FROM heartbeats WHERE ${w} AND duration > 0 GROUP BY 1, 2`;
    const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    for (const r of rows) grid[r.dow][r.hour] = r.seconds;
    return grid;
  });
}

export function parseFilters(q: Record<string, string>): Filters {
  const f: Filters = {};
  for (const d of DIMENSIONS) if (q[d] !== undefined) f[d] = q[d].slice(0, 255);
  return f;
}
