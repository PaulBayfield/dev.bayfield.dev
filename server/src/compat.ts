// WakaTime-compatible read API: the user, daily summaries and stats over a range.
// Same paths as WakaTime / wakapi, under /api, /api/v1 and /api/compat/wakatime/v1.
//
// With the owner's API key (Authorization: Basic base64(key), or Bearer): everything.
// Without one: only when the user turned on the public API (Settings → Sharing), and only what
// they share. Hidden dimensions are left out, ranges stop at the share window, and day-by-day
// summaries need the activity calendar to be shared.

import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { sql, type Dimension } from "./db.ts";
import { HttpError, bad, isDate, rateLimit } from "./http.ts";
import { apiKeyOf, digital, items } from "./ingest.ts";
import { SHARED, publicUser, windowStart } from "./public.ts";
import { addDays, rangeBounds, summary } from "./stats.ts";
import { getUser, publicHandle, publicName, type User } from "./users.ts";

interface Viewer {
  user: User;
  /** The owner's own key: no sharing limits. */
  full: boolean;
}

/** `:user` is "current" (needs a key), the owner's username or handle, or someone's public handle. */
async function viewer(c: Context): Promise<Viewer> {
  const named = c.req.param("user") ?? "current";
  const key = apiKeyOf(c);
  if (key) {
    const [row] = await sql<{ userId: string }[]>`SELECT user_id FROM api_keys WHERE key = ${key}`;
    const owner = row && (await getUser(row.userId));
    if (!owner) throw new HttpError(401, "Invalid API key");
    const n = named.toLowerCase();
    if (n === "current" || n === owner.id.toLowerCase() || n === publicHandle(owner).toLowerCase()) return { user: owner, full: true };
  } else if (named === "current") {
    throw new HttpError(401, "Missing API key");
  }
  rateLimit(c, "compat", 300, 10 * 60_000);
  return { user: await publicUser(named, "api"), full: false };
}

/** The dimensions a viewer may see, as WakaTime's field names. */
function fields(v: Viewer): [Dimension, string][] {
  const all: [Dimension, string][] = [
    ["project", "projects"],
    ["language", "languages"],
    ["editor", "editors"],
    ["operatingSystem", "operating_systems"],
    ["machine", "machines"],
    ["category", "categories"],
    ["branch", "branches"],
  ];
  return all.filter(([d]) => v.full || (SHARED[d] && v.user[SHARED[d]!]));
}

/** Public viewers never see further back than the share window. */
function clamp(v: Viewer, from: string, to: string) {
  if (v.full) return { from, to };
  const allowedFrom = windowStart(v.user);
  return { from: allowedFrom && from < allowedFrom ? allowedFrom : from, to };
}

const total = (seconds: number) => ({ total_seconds: seconds, decimal: (seconds / 3600).toFixed(2), ...digital(seconds) });

export const compatRoutes = new Hono();
// Readable from any site (a portfolio, a dashboard): no cookies are involved, only keys.
const open = cors({ origin: "*", allowMethods: ["GET", "OPTIONS"], allowHeaders: ["Authorization", "Content-Type"], maxAge: 86400 });

for (const prefix of ["", "/v1", "/compat/wakatime/v1"]) {
  const base = `${prefix}/users/:user`;
  for (const path of [base, `${base}/summaries`, `${base}/stats`, `${base}/stats/:range`]) compatRoutes.use(path, open);

  // --- The user ---
  compatRoutes.get(base, async (c) => {
    const v = await viewer(c);
    const u = v.user;
    const showLast = v.full || u.shareActivity;
    const [last] = showLast
      ? await sql<{ time: Date; project: string; editor: string }[]>`
          SELECT time, project, editor FROM heartbeats WHERE user_id = ${u.id} ORDER BY time DESC LIMIT 1`
      : [];
    const handle = publicHandle(u);
    return c.json({
      data: {
        id: v.full ? u.id : handle,
        username: v.full ? u.id : handle,
        display_name: v.full ? u.name || u.id : publicName(u),
        full_name: v.full ? u.name || u.id : publicName(u),
        ...(v.full ? { email: u.email, timezone: u.timezone } : {}),
        photo: null,
        is_hireable: false,
        profile_url: u.publicPage ? `/u/${encodeURIComponent(handle)}` : null,
        last_heartbeat_at: last?.time.toISOString() ?? null,
        last_project: last && (v.full || u.shareProjects) ? last.project : null,
        last_plugin_name: last && (v.full || u.shareEditors) ? last.editor : null,
        created_at: u.createdAt.toISOString(),
      },
    });
  });

  // --- Daily summaries: ?start=YYYY-MM-DD&end=YYYY-MM-DD (end included), or ?range=last_7_days ---
  compatRoutes.get(`${base}/summaries`, async (c) => {
    const v = await viewer(c);
    const u = v.user;
    if (!v.full && !u.shareActivity) throw new HttpError(403, "Daily activity isn't shared");
    const q = c.req.query();
    const start = q.start?.slice(0, 10);
    const end = q.end?.slice(0, 10);
    let bounds: { from: string; to: string } | null;
    if (start || end) {
      if (!isDate(start) || !isDate(end) || start > end) throw bad("start and end must be dates (YYYY-MM-DD), start before end");
      bounds = { from: start, to: addDays(end, 1) };
    } else {
      bounds = rangeBounds(q.range ?? "last_7_days", u);
      if (!bounds) throw bad("Unknown range");
    }
    let { from, to } = clamp(v, bounds.from, bounds.to);
    if (from === "1970-01-01") {
      const [first] = await sql<{ day: string | null }[]>`SELECT min(day)::text AS day FROM daily_stats WHERE user_id = ${u.id}`;
      from = first?.day ?? addDays(to, -1);
    }
    if (from >= to) from = addDays(to, -1);
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 3660) throw bad("At most 10 years per request");

    const shown = fields(v);
    // One pass over the rollup: per day, and per day and dimension.
    const rows = await sql<{ g: number; day: string; seconds: number; [k: string]: unknown }[]>`
      SELECT GROUPING(project, language, editor, operating_system, machine, branch, category) AS g,
        day::text, project, language, editor, operating_system, machine, branch, category,
        sum(seconds)::float8 AS seconds
      FROM daily_stats
      WHERE user_id = ${u.id} AND day >= ${from} AND day < ${to}
      GROUP BY GROUPING SETS ((day), (day, project), (day, language), (day, editor), (day, operating_system), (day, machine), (day, branch), (day, category))`;
    // GROUPING() sets a bit for each column left out: bit 6 is project … bit 0 category.
    const ALL = 0b1111111;
    const bit: Record<Dimension, number> = { project: 6, language: 5, editor: 4, operatingSystem: 3, machine: 2, branch: 1, category: 0 };
    const days = new Map<string, { total: number; dims: Partial<Record<Dimension, { name: string; seconds: number }[]>> }>();
    for (const r of rows) {
      const entry = days.get(r.day) ?? { total: 0, dims: {} };
      days.set(r.day, entry);
      if (r.g === ALL) entry.total = r.seconds;
      else
        for (const [d] of shown) {
          if (r.g === (ALL & ~(1 << bit[d]))) (entry.dims[d] ??= []).push({ name: r[d] as string, seconds: r.seconds });
        }
    }

    const data = [];
    let sum = 0;
    for (let day = from; day < to; day = addDays(day, 1)) {
      const entry = days.get(day) ?? { total: 0, dims: {} };
      sum += entry.total;
      const item: Record<string, unknown> = {
        grand_total: total(entry.total),
        range: {
          date: day,
          start: `${day}T00:00:00`,
          end: `${day}T23:59:59`,
          text: day,
          ...(v.full ? { timezone: u.timezone } : {}),
        },
      };
      for (const [d, field] of shown) item[field] = items((entry.dims[d] ?? []).sort((a, b) => b.seconds - a.seconds), entry.total);
      data.push(item);
    }
    return c.json({
      data,
      cumulative_total: { seconds: sum, text: digital(sum).text, decimal: (sum / 3600).toFixed(2), digital: digital(sum).digital },
      daily_average: { seconds: data.length ? sum / data.length : 0, text: digital(data.length ? sum / data.length : 0).text, days_including_holidays: data.length },
      start: `${from}T00:00:00`,
      end: `${addDays(to, -1)}T23:59:59`,
    });
  });

  // --- Stats over a range: last_7_days (default), last_30_days, last_6_months, last_year, all_time, … ---
  const stats = async (c: Context) => {
    const v = await viewer(c);
    const u = v.user;
    const range = (c.req.param("range") ?? c.req.query("range") ?? "last_7_days").toLowerCase();
    const bounds = range === "last_6_months" ? rangeBounds("last_183_days", u) : rangeBounds(range, u);
    if (!bounds) throw bad("Unknown range");
    const { from, to } = clamp(v, bounds.from, bounds.to);
    const s = await summary(u, from, to, {});
    const days = Math.max(1, s.days.length);
    const data: Record<string, unknown> = {
      id: v.full ? u.id : publicHandle(u),
      username: v.full ? u.id : publicHandle(u),
      range,
      start: `${s.from}T00:00:00`,
      end: `${addDays(s.to, -1)}T23:59:59`,
      ...(v.full ? { timezone: u.timezone } : {}),
      total_seconds: s.total,
      total_seconds_including_other_language: s.total,
      daily_average: s.total / days,
      human_readable_total: digital(s.total).text,
      human_readable_daily_average: digital(s.total / days).text,
      days_including_holidays: days,
      is_up_to_date: true,
      status: "ok",
    };
    for (const [d, field] of fields(v)) data[field] = items(s.breakdowns[d], s.total);
    return c.json({ data });
  };
  compatRoutes.get(`${base}/stats`, stats);
  compatRoutes.get(`${base}/stats/:range`, stats);
}

