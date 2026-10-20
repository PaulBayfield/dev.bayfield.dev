// The WakaTime-compatible API that editor plugins (through wakatime-cli) talk to.
//
// Point ~/.wakatime.cfg at it:   api_url = https://dev.bayfield.dev/api   api_key = <key from Settings>
// Paths match wakapi's, so a wakapi api_url keeps working once the host points here.

import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { sql } from "./db.ts";
import { HEARTBEAT_MAX_AGE_DAYS } from "./config.ts";
import { recompute } from "./durations.ts";
import { HttpError } from "./http.ts";
import { canonicalEditor, canonicalLanguage, canonicalOs, parseUserAgent } from "./names.ts";
import { rangeBounds, summary } from "./stats.ts";
import { getUser, publicHandle, type User } from "./users.ts";

type IngestEnv = { Variables: { user: User; readOnly: boolean } };

/** The key from "Basic base64(key)", "Bearer base64(key)", "Bearer key" or ?api_key=. */
export function apiKeyOf(c: Context): string | null {
  const header = c.req.header("Authorization") ?? "";
  const m = header.match(/^(Basic|Bearer)\s+(.+)$/i);
  if (m) {
    const raw = m[2].trim();
    let decoded = "";
    try {
      decoded = Buffer.from(raw, "base64").toString("utf8").trim();
    } catch {
      // Not base64: a raw key.
    }
    // "Basic base64(user:key)" from some clients: the key is the password part.
    const candidate = /^[\x20-\x7e]+$/.test(decoded) && decoded.length >= 16 ? decoded.split(":").at(-1)! : raw;
    return candidate;
  }
  return c.req.query("api_key") ?? null;
}

async function requireApiKey(c: Context<IngestEnv>, next: () => Promise<void>) {
  const key = apiKeyOf(c);
  if (!key) throw new HttpError(401, "Missing API key");
  const [row] = await sql<{ userId: string; readOnly: boolean; lastUsedAt: Date | null }[]>`
    SELECT user_id, read_only, last_used_at FROM api_keys WHERE key = ${key}`;
  if (!row) throw new HttpError(401, "Invalid API key");
  const user = await getUser(row.userId);
  if (!user) throw new HttpError(401, "Invalid API key");
  // "current" or the key owner's own name; wakapi accepted both.
  const named = c.req.param("user");
  if (named && named !== "current" && named.toLowerCase() !== user.id.toLowerCase() && named.toLowerCase() !== publicHandle(user).toLowerCase()) throw new HttpError(403, "This key belongs to another user");
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await sql`UPDATE api_keys SET last_used_at = now() WHERE key = ${key}`;
  }
  c.set("user", user);
  c.set("readOnly", row.readOnly);
  await next();
}

// --- Heartbeats ---

interface Incoming {
  entity?: unknown;
  type?: unknown;
  category?: unknown;
  time?: unknown;
  project?: unknown;
  branch?: unknown;
  language?: unknown;
  is_write?: unknown;
  lines?: unknown;
  line_additions?: unknown;
  line_deletions?: unknown;
  user_agent?: unknown;
  machine?: unknown;
  ai_model?: unknown;
}

interface Row {
  userId: string;
  time: Date;
  entity: string;
  type: string;
  category: string;
  project: string;
  branch: string;
  language: string;
  editor: string;
  operatingSystem: string;
  machine: string;
  aiModel: string;
  isWrite: boolean;
  userAgent: string;
  lines: number | null;
  lineAdditions: number | null;
  lineDeletions: number | null;
  hash: string;
}

const s = (v: unknown, max = 1024) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-2147483648, Math.min(2147483647, Math.round(v))) : null);

const PLACEHOLDERS = { project: "<<LAST_PROJECT>>", language: "<<LAST_LANGUAGE>>", branch: "<<LAST_BRANCH>>" };

/** The fields that make a heartbeat unique; repeats (the CLI's offline queue replaying) are dropped. */
export function heartbeatHash(r: Omit<Row, "hash">): string {
  return createHash("sha256")
    .update(JSON.stringify([r.time.getTime(), r.entity, r.type, r.category, r.project, r.branch, r.language, r.isWrite, r.editor, r.operatingSystem, r.machine]))
    .digest("hex")
    .slice(0, 32);
}

/** Project aliases: exact names (any case) or wildcard patterns like "client-*". */
export function aliasResolver(rows: { alias: string; project: string }[]): (project: string) => string {
  const exact = new Map<string, string>();
  const patterns: [RegExp, string][] = [];
  for (const { alias, project } of rows) {
    if (alias.includes("*")) {
      const source = alias
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      patterns.push([new RegExp(`^${source}$`, "i"), project]);
    } else {
      exact.set(alias.toLowerCase(), project);
    }
  }
  return (project) => {
    if (!project) return project;
    const hit = exact.get(project.toLowerCase());
    if (hit !== undefined) return hit;
    for (const [re, target] of patterns) if (re.test(project)) return target;
    return project;
  };
}

/** Wakapi's "Augment": the most specific matching extension wins (test.js over js). */
export function mapLanguage(entity: string, mappings: Map<string, string>): string | null {
  let best: string | null = null;
  let precision = -1;
  for (const [ext, lang] of mappings) {
    const p = ext.split(".").length - 1;
    if (entity.endsWith(`.${ext}`) && p > precision) {
      best = lang;
      precision = p;
    }
  }
  return best;
}

async function handleHeartbeats(c: Context<IngestEnv>) {
  if (c.get("readOnly")) throw new HttpError(403, "This API key is read-only");
  const user = c.get("user");
  const payload = await c.req.json().catch(() => null);
  const list: Incoming[] = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? [payload] : [];
  if (list.length === 0 || list.length > 1000) throw new HttpError(400, "No heartbeats");

  const header = parseUserAgent(c.req.header("User-Agent") ?? "");
  const machineHeader = s(c.req.header("X-Machine-Name"), 255);
  const now = Date.now();
  const minTime = now - HEARTBEAT_MAX_AGE_DAYS * 24 * 60 * 60_000;

  const [aliases, mappings] = await Promise.all([
    sql<{ alias: string; project: string }[]>`SELECT alias, project FROM project_aliases WHERE user_id = ${user.id}`,
    sql<{ extension: string; language: string }[]>`SELECT extension, language FROM language_mappings WHERE user_id = ${user.id}`,
  ]);
  const resolveProject = aliasResolver(aliases);
  const mappingMap = new Map(mappings.map((m) => [m.extension, m.language]));

  // Placeholders resolve to the user's latest heartbeat (per project for language/branch), fetched lazily.
  let latest: { project: string; language: string; branch: string } | null | undefined;
  const latestByProject = new Map<string, { language: string; branch: string } | null>();
  const getLatest = async () => {
    if (latest === undefined) {
      [latest] = await sql<{ project: string; language: string; branch: string }[]>`
        SELECT project, language, branch FROM heartbeats WHERE user_id = ${user.id} ORDER BY time DESC LIMIT 1`;
      latest ??= null;
    }
    return latest;
  };
  const getLatestFor = async (project: string) => {
    if (!latestByProject.has(project)) {
      const [row] = await sql<{ language: string; branch: string }[]>`
        SELECT language, branch FROM heartbeats WHERE user_id = ${user.id} AND project = ${project} ORDER BY time DESC LIMIT 1`;
      latestByProject.set(project, row ?? null);
    }
    return latestByProject.get(project)!;
  };

  const rows: Row[] = [];
  const results: [unknown, number][] = [];
  for (const hb of list) {
    const seconds = typeof hb?.time === "number" ? hb.time : typeof hb?.time === "string" ? Number(hb.time) : NaN;
    const time = seconds * 1000;
    const entity = s(hb?.entity, 2048);
    if (!entity || !Number.isFinite(time) || time < minTime || time > now + 60 * 60_000) {
      results.push([{ error: "invalid heartbeat object" }, 400]);
      continue;
    }

    const type = s(hb.type, 255) || "file";
    let project = s(hb.project, 255);
    let language = s(hb.language, 255);
    let branch = s(hb.branch, 255);
    // The browser extension sends placeholders on everything; its activity stays outside projects.
    if (type === "url" || type === "domain") {
      if (project === PLACEHOLDERS.project) project = "";
      if (language === PLACEHOLDERS.language) language = "";
      if (branch === PLACEHOLDERS.branch) branch = "";
    }
    if (project === PLACEHOLDERS.project) project = (await getLatest())?.project ?? "";
    if (language === PLACEHOLDERS.language) language = (await getLatestFor(project))?.language ?? "";
    if (branch === PLACEHOLDERS.branch) branch = (await getLatestFor(project))?.branch ?? "";

    const own = typeof hb.user_agent === "string" && hb.user_agent ? parseUserAgent(hb.user_agent) : null;
    project = resolveProject(project);
    language = mapLanguage(entity, mappingMap) ?? canonicalLanguage(language);
    let category = s(hb.category, 255);
    if (!category) category = type === "domain" || type === "url" ? "browsing" : type === "file" && language ? "coding" : "";

    const row: Omit<Row, "hash"> = {
      userId: user.id,
      time: new Date(Math.round(time)),
      entity,
      type,
      category,
      project,
      branch,
      language,
      editor: own?.editor || header.editor,
      operatingSystem: canonicalOs(own?.os || header.os),
      machine: s(hb.machine, 255) || machineHeader,
      aiModel: s(hb.ai_model, 255) || own?.aiModel || header.aiModel,
      isWrite: hb.is_write === true,
      userAgent: s(hb.user_agent, 255) || s(c.req.header("User-Agent"), 255),
      lines: int(hb.lines),
      lineAdditions: int(hb.line_additions),
      lineDeletions: int(hb.line_deletions),
    };
    row.editor = canonicalEditor(row.editor);
    rows.push({ ...row, hash: heartbeatHash(row) });
    results.push([{ id: row.time.getTime() }, 201]);
  }

  if (rows.length === 0) return c.json({ error: "no valid heartbeat object given" }, 400);

  await sql`INSERT INTO heartbeats ${sql(rows)} ON CONFLICT (user_id, hash) DO NOTHING`;
  const earliest = rows.reduce((min, r) => (r.time < min ? r.time : min), rows[0].time);
  // Fast enough to do inline: it only touches the affected stretch (usually the last few minutes).
  await recompute(user.id, earliest);

  return c.json({ responses: results }, 201);
}

// --- Status bar (the "today" time editors show) ---

export function digital(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return { hours: h, minutes: m, digital: `${h}:${String(m).padStart(2, "0")}`, text: h ? `${h} hrs ${m} mins` : `${m} mins` };
}

export function items(list: { name: string; seconds: number }[], total: number) {
  return list.map((i) => ({
    name: i.name || "unknown",
    total_seconds: i.seconds,
    percent: total ? Math.round((i.seconds / total) * 10000) / 100 : 0,
    ...digital(i.seconds),
  }));
}

async function handleStatusBar(c: Context<IngestEnv>) {
  const user = c.get("user");
  const range = c.req.param("range") ?? "today";
  const bounds = rangeBounds(range === "today" ? "today" : range, user);
  if (!bounds) throw new HttpError(400, "invalid range");
  const data = await summary(user, bounds.from, bounds.to, {});
  const total = data.total;
  return c.json({
    cached_at: new Date().toISOString(),
    data: {
      grand_total: { total_seconds: total, ...digital(total) },
      categories: items(data.breakdowns.category, total),
      projects: items(data.breakdowns.project, total),
      languages: items(data.breakdowns.language, total),
      editors: items(data.breakdowns.editor, total),
      operating_systems: items(data.breakdowns.operatingSystem, total),
      machines: items(data.breakdowns.machine, total),
      branches: items(data.breakdowns.branch, total),
      range: { start: bounds.from, end: bounds.to, timezone: user.timezone },
    },
  });
}

export const ingestRoutes = new Hono<IngestEnv>();

for (const prefix of ["", "/v1", "/compat/wakatime/v1"]) {
  for (const path of ["/users/:user/heartbeats", "/users/:user/heartbeats.bulk"]) {
    ingestRoutes.post(prefix + path, requireApiKey, handleHeartbeats);
  }
  ingestRoutes.get(`${prefix}/users/:user/statusbar/:range`, requireApiKey, handleStatusBar);
}
ingestRoutes.post("/heartbeat", requireApiKey, handleHeartbeats);
ingestRoutes.post("/heartbeats", requireApiKey, handleHeartbeats);
