// What other people can see, only when the user turned it on (Settings → Sharing):
// the public page (public_page), and README badges and a languages card (public_api, with the
// WakaTime-compatible API in compat.ts). Users are found by public handle and shown by public name.

import { Hono, type Context } from "hono";
import colors from "./colors.json" with { type: "json" };
import { DIMENSIONS, sql, type Dimension } from "./db.ts";
import { HttpError, rateLimit } from "./http.ts";
import { formatDuration } from "./reports.ts";
import { activity, addDays, localDate, rangeBounds, summary, type Filters } from "./stats.ts";
import { findByHandle, publicHandle, publicName, type User } from "./users.ts";

export const SHARED: Partial<Record<Dimension, keyof User>> = {
  project: "shareProjects",
  language: "shareLanguages",
  editor: "shareEditors",
  operatingSystem: "shareOs",
  machine: "shareMachines",
};

/** "page": the public profile page. "api": the WakaTime-compatible API, badges and card. */
export async function publicUser(handle: string, surface: "page" | "api"): Promise<User> {
  const u = await findByHandle(handle);
  if (!u || !(surface === "page" ? u.publicPage : u.publicApi)) throw new HttpError(404, "Not found");
  return u;
}

/** The first day the public may see, or null when the window is "all time" (share_days = 0). */
export function windowStart(user: User): string | null {
  return user.shareDays > 0 ? addDays(localDate(user.timezone), -(user.shareDays - 1)) : null;
}

/** Shared ranges never reach further back than the user allows. With no range: the whole window. */
export function sharedRange(user: User, range: string | undefined) {
  const allowedFrom = windowStart(user);
  const fallback = user.shareDays === 0 ? "all_time" : user.shareDays === 365 ? "last_12_months" : `last_${user.shareDays}_days`;
  const b = rangeBounds(range ?? fallback, user) ?? rangeBounds("last_7_days", user)!;
  return { from: allowedFrom && b.from < allowedFrom ? allowedFrom : b.from, to: b.to };
}

function sharedFilters(user: User, q: Record<string, string>): Filters {
  const f: Filters = {};
  for (const d of DIMENSIONS) {
    if (q[d] === undefined) continue;
    const flag = SHARED[d];
    if (!flag || !user[flag]) throw new HttpError(403, `${d} isn't shared`);
    f[d] = q[d];
  }
  return f;
}

export const publicRoutes = new Hono();

publicRoutes.get("/public/users/:id", async (c) => {
  rateLimit(c, "public", 120, 10 * 60_000);
  const user = await publicUser(c.req.param("id"), "page");
  const { from, to } = sharedRange(user, undefined);
  const s = await summary(user, from, to, {});
  const breakdowns: Partial<Record<Dimension, { name: string; seconds: number }[]>> = {};
  for (const [d, flag] of Object.entries(SHARED) as [Dimension, keyof User][]) {
    if (user[flag]) breakdowns[d] = s.breakdowns[d].slice(0, 20);
  }
  const today = localDate(user.timezone);
  // The heatmap covers the last year, but never more than the window.
  const yearAgo = addDays(today, -370);
  const heatFrom = from > yearAgo ? from : yearAgo;
  return c.json({
    id: publicHandle(user),
    name: publicName(user),
    /** The share window in days; 0 = all time. */
    days: user.shareDays,
    // summary() moves an all-time start to the first day with data.
    from: s.from,
    to,
    spanDays: s.days.length,
    total: s.total,
    daily: user.shareActivity ? s.days.map((d) => ({ date: d.date, total: d.total })) : null,
    breakdowns,
    activity: user.shareActivity ? await activity(user, heatFrom, addDays(today, 1)) : null,
    memberSince: user.createdAt,
  });
});

// --- SVG ---

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Rough Verdana 11px width, like shields.io's badges. */
const textWidth = (s: string) => [...s].reduce((w, ch) => w + (/[ilj.,:;'|!]/.test(ch) ? 3.5 : /[mwMW@]/.test(ch) ? 9.5 : /[A-Z0-9]/.test(ch) ? 7.5 : 6.5), 0);

function badge(label: string, value: string, color: string) {
  const lw = Math.round(textWidth(label) + 12);
  const vw = Math.round(textWidth(value) + 12);
  const w = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
<title>${esc(label)}: ${esc(value)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(label)}</text><text x="${lw / 2}" y="14">${esc(label)}</text>
<text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(value)}</text><text x="${lw + vw / 2}" y="14">${esc(value)}</text>
</g></svg>`;
}

function svg(c: Context, body: string) {
  c.header("Content-Type", "image/svg+xml; charset=utf-8");
  // GitHub's image proxy respects this; a little staleness is fine for a badge.
  c.header("Cache-Control", "public, max-age=900");
  return c.body(body);
}

/** /api/badge/<user>.svg?range=last_30_days&project=devtime&label=coded */
publicRoutes.get("/badge/:file", async (c) => {
  rateLimit(c, "badge", 300, 10 * 60_000);
  const id = c.req.param("file").replace(/\.svg$/, "");
  try {
    const user = await publicUser(id, "api");
    const q = c.req.query();
    const { from, to } = sharedRange(user, q.range);
    const s = await summary(user, from, to, sharedFilters(user, q));
    const label = (q.label ?? (q.project ? q.project : "coding time")).slice(0, 40);
    const color = /^[0-9a-f]{3,8}$/i.test(q.color ?? "") ? `#${q.color}` : "#2f9e74";
    return svg(c, badge(label, formatDuration(s.total), color));
  } catch (e) {
    if (e instanceof HttpError) return svg(c, badge("devtime", e.status === 404 ? "not shared" : "unavailable", "#9f9f9f"));
    throw e;
  }
});

/** /api/card/<user>.svg?theme=dark: top languages over the shared window. */
publicRoutes.get("/card/:file", async (c) => {
  rateLimit(c, "badge", 300, 10 * 60_000);
  const id = c.req.param("file").replace(/\.svg$/, "");
  const dark = c.req.query("theme") === "dark";
  const fg = dark ? "#e9e9e7" : "#37352f";
  const muted = dark ? "#9b9a97" : "#787774";
  const bg = dark ? "#191919" : "#ffffff";
  const border = dark ? "#343434" : "#e3e2e0";
  let user: User;
  try {
    user = await publicUser(id, "api");
    if (!user.shareLanguages) throw new HttpError(403, "Languages aren't shared");
  } catch (e) {
    if (e instanceof HttpError) return svg(c, badge("devtime", "not shared", "#9f9f9f"));
    throw e;
  }
  const { from, to } = sharedRange(user, undefined);
  const s = await summary(user, from, to, {});
  const langs = s.breakdowns.language.filter((l) => l.name).slice(0, 6);
  const total = langs.reduce((sum, l) => sum + l.seconds, 0) || 1;
  const palette = colors.languages as unknown as Record<string, string | null>;
  const W = 340;
  const barW = W - 40;
  let x = 20;
  const segments = langs
    .map((l, i) => {
      const w = (l.seconds / total) * barW;
      const color = palette[l.name] ?? "#9b9a97";
      // 2px surface gap between segments.
      const seg = `<rect x="${x.toFixed(1)}" y="52" width="${Math.max(0, w - (i < langs.length - 1 ? 2 : 0)).toFixed(1)}" height="8" fill="${color}"/>`;
      x += w;
      return seg;
    })
    .join("");
  const legend = langs
    .map((l, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const lx = 20 + col * 160;
      const ly = 84 + row * 22;
      const color = palette[l.name] ?? "#9b9a97";
      return `<circle cx="${lx + 4}" cy="${ly - 4}" r="4" fill="${color}"/>
<text x="${lx + 14}" y="${ly}" fill="${fg}" font-size="12">${esc(l.name)}</text>
<text x="${lx + 150}" y="${ly}" fill="${muted}" font-size="12" text-anchor="end">${Math.round((l.seconds / total) * 100)}%</text>`;
    })
    .join("");
  const H = 84 + Math.ceil(langs.length / 2) * 22;
  const title = `${publicName(user)} · ${formatDuration(s.total)}`;
  return svg(
    c,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter,Segoe UI,system-ui,sans-serif" role="img" aria-label="${esc(title)}">
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="${bg}" stroke="${border}"/>
<text x="20" y="28" fill="${fg}" font-size="14" font-weight="600">${esc(title)}</text>
<text x="${W - 20}" y="28" fill="${muted}" font-size="12" text-anchor="end">${user.shareDays ? `${user.shareDays} days` : "all time"}</text>
<clipPath id="bar"><rect x="20" y="52" width="${barW}" height="8" rx="4"/></clipPath>
<g clip-path="url(#bar)">${segments || `<rect x="20" y="52" width="${barW}" height="8" fill="${border}"/>`}</g>
${legend}
</svg>`,
  );
});
