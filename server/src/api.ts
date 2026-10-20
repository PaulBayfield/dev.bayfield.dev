// The app's API for a signed-in user (cookie session).

import { Hono, type Context } from "hono";
import { stream } from "hono/streaming";
import { sql } from "./db.ts";
import { APP_VERSION, UPDATE_CHECK, mail, oidc } from "./config.ts";
import { requireAdmin, requireUser, signOutEverywhere, type AppEnv } from "./auth.ts";
import { newApiKey, sha256 } from "./crypto.ts";
import { rebuildRollup, recompute } from "./durations.ts";
import { goalProgress, listGoals } from "./goals.ts";
import { HttpError, bad, body, isDate, isTimeZone, rateLimit, str } from "./http.ts";
import { canonicalLanguage } from "./names.ts";
import { sendWeeklyReport } from "./reports.ts";
import { RELEASES_URL, updateStatus } from "./updates.ts";
import { activity, addDays, files, localDate, parseFilters, projects, rangeBounds, rhythm, summary } from "./stats.ts";
import { USERNAME, getUser, handleFree, meView, type User } from "./users.ts";

export const api = new Hono<AppEnv>();
api.use("*", requireUser);

/** `?range=last_7_days` or `?from=YYYY-MM-DD&to=YYYY-MM-DD` (to inclusive). */
function bounds(c: Context<AppEnv>, user: User) {
  const { from, to, range } = c.req.query();
  if (isDate(from) && isDate(to) && from <= to) return { from, to: addDays(to, 1) };
  const b = rangeBounds(range ?? "last_7_days", user);
  if (!b) throw bad("Unknown range");
  return b;
}

// --- Stats ---

api.get("/stats", async (c) => {
  const user = c.get("user");
  const { from, to } = bounds(c, user);
  return c.json(await summary(user, from, to, parseFilters(c.req.query())));
});

api.get("/activity", async (c) => {
  const user = c.get("user");
  const to = addDays(localDate(user.timezone), 1);
  const days = Math.min(Math.max(Number(c.req.query("days")) || 371, 7), 3660);
  return c.json(await activity(user, addDays(to, -days), to, parseFilters(c.req.query())));
});

api.get("/rhythm", async (c) => {
  const user = c.get("user");
  const { from, to } = bounds(c, user);
  return c.json(await rhythm(user, from, to, parseFilters(c.req.query())));
});

// --- Projects ---

api.get("/projects", async (c) => c.json(await projects(c.get("user"))));

api.get("/projects/:name/files", async (c) => {
  const user = c.get("user");
  const { from, to } = bounds(c, user);
  return c.json(await files(user, c.req.param("name"), from, to, parseFilters(c.req.query())));
});

/** Renames a project, or merges it into another; future heartbeats follow through an alias. */
api.post("/projects/:name/rename", async (c) => {
  const user = c.get("user");
  const from = c.req.param("name");
  const to = str((await body(c)).to, 255);
  if (!to || to === from) throw bad("Pick a different name");
  await sql.begin(async (tx) => {
    await tx`UPDATE heartbeats SET project = ${to} WHERE user_id = ${user.id} AND project = ${from}`;
    await tx`UPDATE project_aliases SET project = ${to} WHERE user_id = ${user.id} AND project = ${from}`;
    await tx`
      INSERT INTO project_aliases (user_id, alias, project) VALUES (${user.id}, ${from}, ${to})
      ON CONFLICT (user_id, alias) DO UPDATE SET project = excluded.project`;
    await tx`DELETE FROM project_aliases WHERE user_id = ${user.id} AND lower(alias) = lower(project)`;
    await tx`UPDATE goals SET value = ${to} WHERE user_id = ${user.id} AND dimension = 'project' AND value = ${from}`;
  });
  await rebuildRollup(user.id);
  return c.json({ ok: true });
});

api.get("/aliases", async (c) =>
  c.json(await sql`SELECT alias, project FROM project_aliases WHERE user_id = ${c.get("user").id} ORDER BY project, alias`),
);

api.delete("/aliases/:alias", async (c) => {
  await sql`DELETE FROM project_aliases WHERE user_id = ${c.get("user").id} AND alias = ${c.req.param("alias")}`;
  return c.json({ ok: true });
});

// --- Goals ---

function parseGoal(b: Record<string, unknown>) {
  const period = b.period === "week" ? "week" : b.period === "day" ? "day" : null;
  const seconds = Math.round(Number(b.seconds));
  const dimension = ["project", "language", "editor", "category"].includes(b.dimension as string) ? (b.dimension as string) : null;
  const value = dimension ? str(b.value, 255) : null;
  if (!period || !Number.isFinite(seconds) || seconds < 60 || seconds > 7 * 24 * 3600) throw bad("Invalid goal");
  return { period, seconds, dimension, value, weekdaysOnly: period === "day" && b.weekdaysOnly === true };
}

api.get("/goals", async (c) => {
  const user = c.get("user");
  return c.json(await Promise.all((await listGoals(user.id)).map((g) => goalProgress(user, g))));
});

api.post("/goals", async (c) => {
  const user = c.get("user");
  const g = parseGoal(await body(c));
  const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM goals WHERE user_id = ${user.id}`;
  if (count >= 50) throw bad("That's a lot of goals");
  await sql`INSERT INTO goals ${sql({ userId: user.id, ...g })}`;
  return c.json({ ok: true }, 201);
});

api.put("/goals/:id", async (c) => {
  const g = parseGoal(await body(c));
  await sql`UPDATE goals SET ${sql(g)} WHERE id = ${c.req.param("id")} AND user_id = ${c.get("user").id}`;
  return c.json({ ok: true });
});

api.delete("/goals/:id", async (c) => {
  await sql`DELETE FROM goals WHERE id = ${c.req.param("id")} AND user_id = ${c.get("user").id}`;
  return c.json({ ok: true });
});

// --- Profile & preferences ---

api.patch("/profile", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const patch: Record<string, unknown> = {};
  if (b.name !== undefined) patch.name = str(b.name, 100);
  if (b.email !== undefined) {
    const email = str(b.email, 255).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("That email doesn't look right");
    if (email) {
      const [taken] = await sql`SELECT 1 FROM users WHERE lower(email) = ${email} AND id <> ${user.id}`;
      if (taken) throw new HttpError(409, "Another account uses that email");
    }
    patch.email = email || null;
  }
  if (b.timezone !== undefined) {
    if (!isTimeZone(b.timezone)) throw bad("Unknown time zone");
    patch.timezone = b.timezone;
  }
  if (b.weekStart !== undefined) patch.weekStart = b.weekStart === 0 ? 0 : 1;
  if (b.heartbeatTimeout !== undefined) {
    const t = Math.round(Number(b.heartbeatTimeout));
    if (!(t >= 60 && t <= 3600)) throw bad("The timeout goes from 1 to 60 minutes");
    patch.heartbeatTimeout = t;
  }
  if (b.weeklyReport !== undefined) patch.weeklyReport = b.weeklyReport === true;
  if (b.language === "en" || b.language === "fr") patch.language = b.language;
  if (b.sharing && typeof b.sharing === "object") {
    const s = b.sharing as Record<string, unknown>;
    const map: Record<string, string> = {
      page: "publicPage",
      api: "publicApi",
      projects: "shareProjects",
      languages: "shareLanguages",
      editors: "shareEditors",
      os: "shareOs",
      machines: "shareMachines",
      activity: "shareActivity",
    };
    for (const [k, col] of Object.entries(map)) if (typeof s[k] === "boolean") patch[col] = s[k];
    if (s.days !== undefined) patch.shareDays = [0, 7, 30, 90, 365].includes(Number(s.days)) ? Number(s.days) : 30; // 0: all time
    if (s.name !== undefined) patch.publicName = str(s.name, 100);
    if (s.handle !== undefined) {
      const handle = str(s.handle, 63);
      if (!handle || handle.toLowerCase() === user.id.toLowerCase()) patch.publicHandle = null;
      else {
        if (!USERNAME.test(handle)) throw bad("Use letters, numbers, dots, dashes and underscores");
        if (!(await handleFree(handle, user.id))) throw new HttpError(409, "That public username is taken");
        patch.publicHandle = handle;
      }
    }
  }
  if (Object.keys(patch).length === 0) return c.json(meView(user));
  await sql`UPDATE users SET ${sql(patch)} WHERE id = ${user.id}`;

  // Day boundaries and gaps depend on these: recompute everything (in the background, it can take a while).
  if ((patch.timezone && patch.timezone !== user.timezone) || (patch.heartbeatTimeout && patch.heartbeatTimeout !== user.heartbeatTimeout)) {
    void recompute(user.id, null).catch((e) => console.error("Recompute failed", e));
  }
  return c.json(meView((await getUser(user.id))!));
});

// --- Sessions ---

api.get("/sessions", async (c) => {
  const current = c.get("session").id;
  const rows = await sql<{ id: string; method: string; userAgent: string; ip: string; createdAt: Date; lastSeenAt: Date }[]>`
    SELECT id, method, user_agent, ip, created_at, last_seen_at FROM sessions
    WHERE user_id = ${c.get("user").id} AND expires_at > now()
    ORDER BY last_seen_at DESC`;
  // The id is the token's hash; hash it again so the page never sees anything a cookie could be checked against.
  return c.json(rows.map((r) => ({ ...r, id: sha256(r.id).slice(0, 24), current: r.id === current })));
});

api.delete("/sessions/:id", async (c) => {
  const user = c.get("user");
  const rows = await sql<{ id: string }[]>`SELECT id FROM sessions WHERE user_id = ${user.id}`;
  const target = rows.find((r) => sha256(r.id).slice(0, 24) === c.req.param("id"));
  if (target) await sql`DELETE FROM sessions WHERE id = ${target.id}`;
  return c.json({ ok: true });
});

api.post("/sessions/revoke-others", async (c) => {
  await signOutEverywhere(c.get("user").id, c.get("session").id);
  return c.json({ ok: true });
});

// --- API keys ---

api.get("/keys", async (c) =>
  c.json(
    await sql`SELECT key, label, read_only, created_at, last_used_at FROM api_keys WHERE user_id = ${c.get("user").id} ORDER BY created_at`,
  ),
);

api.post("/keys", async (c) => {
  const b = await body(c);
  const key = newApiKey();
  await sql`INSERT INTO api_keys (key, user_id, label, read_only) VALUES (${key}, ${c.get("user").id}, ${str(b.label, 64) || "Editor"}, ${b.readOnly === true})`;
  return c.json({ key }, 201);
});

api.delete("/keys/:key", async (c) => {
  await sql`DELETE FROM api_keys WHERE key = ${c.req.param("key")} AND user_id = ${c.get("user").id}`;
  return c.json({ ok: true });
});

// --- Language mappings ---

api.get("/mappings", async (c) =>
  c.json(await sql`SELECT extension, language FROM language_mappings WHERE user_id = ${c.get("user").id} ORDER BY extension`),
);

api.post("/mappings", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const extension = str(b.extension, 50).replace(/^\.+/, "").toLowerCase();
  const language = canonicalLanguage(str(b.language, 100));
  if (!/^[a-z0-9_.+-]+$/.test(extension) || !language) throw bad("Give an extension (like vue) and a language");
  await sql`
    INSERT INTO language_mappings (user_id, extension, language) VALUES (${user.id}, ${extension}, ${language})
    ON CONFLICT (user_id, extension) DO UPDATE SET language = excluded.language`;
  if (b.applyToHistory === true) {
    const pattern = `%.${extension.replace(/[\\%_]/g, (m) => `\\${m}`)}`;
    await sql`UPDATE heartbeats SET language = ${language} WHERE user_id = ${user.id} AND entity LIKE ${pattern}`;
    await rebuildRollup(user.id);
  }
  return c.json({ ok: true });
});

api.delete("/mappings/:extension", async (c) => {
  await sql`DELETE FROM language_mappings WHERE user_id = ${c.get("user").id} AND extension = ${c.req.param("extension")}`;
  return c.json({ ok: true });
});

// --- Your data ---

const EXPORT_COLUMNS = ["time", "project", "branch", "language", "entity", "type", "category", "editor", "operating_system", "machine", "is_write", "duration"];

api.get("/export", async (c) => {
  const user = c.get("user");
  const csv = c.req.query("format") === "csv";
  c.header("Content-Type", csv ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="devtime-${user.id}-${localDate(user.timezone)}.${csv ? "csv" : "ndjson"}"`);
  const quote = (v: unknown) => {
    const s = v instanceof Date ? v.toISOString() : String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return stream(c, async (out) => {
    if (csv) await out.write(EXPORT_COLUMNS.join(",") + "\n");
    const cursor = sql`
      SELECT ${sql(EXPORT_COLUMNS)} FROM heartbeats WHERE user_id = ${user.id} ORDER BY time`.cursor(2000);
    for await (const rows of cursor) {
      let chunk = "";
      for (const r of rows as Record<string, unknown>[]) {
        chunk += csv ? Object.values(r).map(quote).join(",") + "\n" : JSON.stringify(r) + "\n";
      }
      await out.write(chunk);
    }
  });
});

api.post("/profile/delete-data", async (c) => {
  const user = c.get("user");
  if (str((await body(c)).confirm) !== user.id) throw bad("Type your username to confirm");
  await sql`DELETE FROM heartbeats WHERE user_id = ${user.id}`;
  await sql`DELETE FROM daily_stats WHERE user_id = ${user.id}`;
  await rebuildRollup(user.id);
  return c.json({ ok: true });
});

api.post("/profile/delete-account", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  if (str(b.confirm) !== user.id) throw bad("Type your username to confirm");
  if (user.isAdmin) {
    const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM users WHERE is_admin AND id <> ${user.id}`;
    if (count === 0) throw bad("You're the only admin. Make someone else an admin first.");
  }
  await sql`DELETE FROM users WHERE id = ${user.id}`;
  return c.json({ ok: true });
});

// --- Weekly report ---

api.post("/reports/test", async (c) => {
  if (!mail) throw new HttpError(503, "Email isn't configured on this server (SMTP_URL)");
  rateLimit(c, "report-test", 5, 60 * 60_000);
  const user = c.get("user");
  if (!user.email) throw bad("Add an email address to your profile first");
  await sendWeeklyReport(user, { test: true });
  return c.json({ ok: true });
});

api.get("/server", (c) =>
  c.json({ mail: !!mail, oidc: oidc ? { name: oidc.name } : null, version: APP_VERSION }),
);

/** Whether a newer release is out. `?refresh=1` skips the cache (the "Check for updates" button). */
api.get("/updates", async (c) => {
  if (!UPDATE_CHECK) {
    return c.json({ current: APP_VERSION, latest: null, available: false, releasesUrl: RELEASES_URL, checkedAt: null, disabled: true });
  }
  const refresh = c.req.query("refresh") === "1";
  if (refresh) rateLimit(c, "update-check", 10, 60 * 60_000);
  return c.json(await updateStatus(refresh));
});

// --- Statistics ---

const startedAt = Date.now();

api.get("/statistics", async (c) => {
  const user = c.get("user");
  const since24h = new Date(Date.now() - 24 * 60 * 60_000);
  const [mine] = await sql<
    { heartbeats: string; last24h: string; first: Date | null; last: Date | null; seconds: number; projects: number; languages: number; editors: number; machines: number; days: number }[]
  >`
    SELECT
      (SELECT count(*) FROM heartbeats WHERE user_id = ${user.id})::text AS heartbeats,
      (SELECT count(*) FROM heartbeats WHERE user_id = ${user.id} AND time >= ${since24h})::text AS last24h,
      (SELECT min(time) FROM heartbeats WHERE user_id = ${user.id}) AS first,
      (SELECT max(time) FROM heartbeats WHERE user_id = ${user.id}) AS last,
      coalesce(sum(seconds), 0)::float8 AS seconds,
      count(DISTINCT project)::int AS projects,
      count(DISTINCT language) FILTER (WHERE language <> '')::int AS languages,
      count(DISTINCT editor) FILTER (WHERE editor <> '')::int AS editors,
      count(DISTINCT machine) FILTER (WHERE machine <> '')::int AS machines,
      count(DISTINCT day)::int AS days
    FROM daily_stats WHERE user_id = ${user.id}`;
  const [keys] = await sql<{ keys: number; sessions: number }[]>`
    SELECT (SELECT count(*) FROM api_keys WHERE user_id = ${user.id})::int AS keys,
           (SELECT count(*) FROM sessions WHERE user_id = ${user.id} AND expires_at > now())::int AS sessions`;

  let server = null;
  if (user.isAdmin) {
    const [s] = await sql<
      { users: number; activeUsers: number; heartbeats: string; last24h: string; lastHour: string; rollupRows: string; dbSize: string; heartbeatsSize: string; rollupSize: string; postgres: string }[]
    >`
      SELECT
        (SELECT count(*) FROM users)::int AS users,
        (SELECT count(DISTINCT user_id) FROM heartbeats WHERE time >= ${since24h})::int AS active_users,
        (SELECT count(*) FROM heartbeats)::text AS heartbeats,
        (SELECT count(*) FROM heartbeats WHERE time >= ${since24h})::text AS last24h,
        (SELECT count(*) FROM heartbeats WHERE created_at >= now() - interval '1 hour')::text AS last_hour,
        (SELECT count(*) FROM daily_stats)::text AS rollup_rows,
        pg_database_size(current_database())::text AS db_size,
        pg_total_relation_size('heartbeats')::text AS heartbeats_size,
        pg_total_relation_size('daily_stats')::text AS rollup_size,
        current_setting('server_version') AS postgres`;
    const perUser = await sql<{ id: string; heartbeats: string; last: Date | null }[]>`
      SELECT u.id, count(h.id)::text AS heartbeats, max(h.time) AS last
      FROM users u LEFT JOIN heartbeats h ON h.user_id = u.id
      GROUP BY u.id ORDER BY count(h.id) DESC`;
    server = {
      ...s,
      perUser,
      node: process.version,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      version: APP_VERSION,
    };
  }
  return c.json({ you: { ...mine, ...keys }, server });
});

// --- Admin ---

const admin = new Hono<AppEnv>();
admin.use("*", requireAdmin);

admin.get("/users", async (c) =>
  c.json(
    await sql`
      SELECT u.id, u.name, u.email, u.is_admin, (u.oidc_sub IS NOT NULL) AS sso_linked, u.created_at, u.last_seen_at,
             (SELECT max(time) FROM heartbeats h WHERE h.user_id = u.id) AS last_heartbeat_at
      FROM users u ORDER BY u.created_at`,
  ),
);

admin.post("/users", async (c) => {
  const b = await body(c);
  const id = str(b.username, 63);
  const email = str(b.email, 255).toLowerCase() || null;
  if (!USERNAME.test(id)) throw bad("Usernames use letters, numbers, dots, dashes and underscores.");
  const [taken] = await sql`SELECT 1 FROM users WHERE lower(id) = lower(${id}) OR (${email}::text IS NOT NULL AND lower(email) = ${email})`;
  if (taken) throw new HttpError(409, "That username or email is taken");
  await sql`
    INSERT INTO users (id, name, email, is_admin)
    VALUES (${id}, ${str(b.name, 100)}, ${email}, ${b.isAdmin === true})`;
  return c.json({ ok: true }, 201);
});

admin.patch("/users/:id", async (c) => {
  const b = await body(c);
  const id = c.req.param("id");
  if (typeof b.isAdmin === "boolean") {
    if (!b.isAdmin && id === c.get("user").id) throw bad("You can't remove your own admin rights");
    await sql`UPDATE users SET is_admin = ${b.isAdmin} WHERE id = ${id}`;
  }
  if (b.signOut === true) await signOutEverywhere(id);
  return c.json({ ok: true });
});

admin.delete("/users/:id", async (c) => {
  const id = c.req.param("id");
  if (id === c.get("user").id) throw bad("Delete your own account from your profile");
  await sql`DELETE FROM users WHERE id = ${id}`;
  return c.json({ ok: true });
});

api.route("/admin", admin);
