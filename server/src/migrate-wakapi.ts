// Imports a wakapi PostgreSQL database into DevTime.
//
//   npm run migrate:wakapi -- "postgres://user:pass@host:5432/wakapi" [--tz UTC] [--users paul,alice] [--dry-run]
//
// What comes over: users (settings, sharing, weekly-report choice, SSO subject), API keys (so editors
// keep working), project/language aliases (applied to project and language names), extension → language
// mappings, and every heartbeat. Running it again only adds what's missing (heartbeats are deduplicated).
//
// Not migrated: passwords (DevTime only signs in through Authentik). Each imported account is claimed by the
// first sign-in with the same wakapi SSO subject, verified email, or username.
//
// --tz: wakapi stores Postgres times without a time zone, as the wall-clock time of the wakapi server.
// That's UTC in its Docker image; pass the server's zone if you set TZ on it.

import postgres from "postgres";
import { sql, migrate } from "./db.ts";
import { recompute } from "./durations.ts";
import { aliasResolver, heartbeatHash, mapLanguage } from "./ingest.ts";
import { isTimeZone } from "./http.ts";
import { canonicalEditor, canonicalLanguage, canonicalOs } from "./names.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const sourceUrl = args.find((a) => /^postgres(ql)?:\/\//.test(a)) ?? process.env.WAKAPI_DATABASE_URL;
const sourceTz = opt("tz") ?? "UTC";
const onlyUsers = opt("users")?.split(",").map((u) => u.trim());
const dryRun = args.includes("--dry-run");
// 19 columns per row; Postgres allows 65535 parameters per query.
const BATCH = 2000;

if (!sourceUrl) {
  console.error('Usage: npm run migrate:wakapi -- "postgres://user:pass@host:5432/wakapi" [--tz UTC] [--users a,b] [--dry-run]');
  process.exit(1);
}
if (!isTimeZone(sourceTz)) {
  console.error(`Unknown time zone: ${sourceTz}`);
  process.exit(1);
}

const src = postgres(sourceUrl, { max: 2, onnotice: () => {} });

async function columns(table: string): Promise<Map<string, string>> {
  const rows = await src<{ column_name: string; data_type: string }[]>`
    SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ${table} AND table_schema = current_schema()`;
  return new Map(rows.map((r) => [r.column_name, r.data_type]));
}

const val = <T>(row: Record<string, unknown>, key: string, fallback: T): T => (row[key] ?? fallback) as T;
const text = (row: Record<string, unknown>, key: string) => (typeof row[key] === "string" ? (row[key] as string) : "");

function shareDays(maxDays: number): number {
  if (maxDays < 0) return 365;
  return [7, 30, 90, 365].find((d) => d >= maxDays) ?? 365;
}

async function main() {
  await migrate();
  const userCols = await columns("users");
  const hbCols = await columns("heartbeats");
  if (!userCols.size || !hbCols.size) throw new Error("That database has no wakapi users/heartbeats tables.");
  const hasTz = hbCols.get("time")?.includes("with time zone");
  // Epoch milliseconds, whatever the column type.
  const timeExpr = hasTz ? src`extract(epoch from time) * 1000` : src`extract(epoch from (time AT TIME ZONE ${sourceTz})) * 1000`;

  let users: Record<string, unknown>[] = await src<Record<string, unknown>[]>`SELECT * FROM users ORDER BY created_at`;
  if (onlyUsers) users = users.filter((u) => onlyUsers.includes(u.id as string));
  console.log(`${users.length} user(s) to import${dryRun ? " (dry run)" : ""}. Wakapi times read as ${hasTz ? "UTC (timestamptz)" : sourceTz}.`);

  const [{ count: existing }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM users`;

  for (const [index, u] of users.entries()) {
    const id = u.id as string;
    const location = text(u, "location");
    const timezone = isTimeZone(location) && location !== "Local" ? location : "UTC";
    const authType = text(u, "auth_type");
    const share = (k: string) => u[k] === true;
    const maxDays = Number(val(u, "share_data_max_days", 0));
    const anyShared = ["share_projects", "share_languages", "share_editors", "share_oss", "share_machines", "share_activity_chart"].some(share);

    console.log(`\n→ ${id}`);
    const [already] = await sql<{ id: string }[]>`SELECT id FROM users WHERE lower(id) = lower(${id})`;
    const email = text(u, "email").toLowerCase() || null;
    const [emailTaken] = email ? await sql`SELECT 1 FROM users WHERE lower(email) = ${email} AND lower(id) <> lower(${id})` : [];

    const profile = {
      id,
      name: id,
      email: emailTaken ? null : email,
      oidcSub: authType && authType !== "local" && text(u, "sub") ? text(u, "sub") : null,
      // The first imported user into an empty DevTime is an admin, as are wakapi's admins.
      isAdmin: share("is_admin") || (existing === 0 && index === 0),
      timezone,
      weekStart: Number(val(u, "start_of_week", 1)) === 0 ? 0 : 1,
      heartbeatTimeout: Math.min(3600, Math.max(60, Number(val(u, "heartbeats_timeout_sec", 600)) || 600)),
      publicProfile: anyShared && maxDays !== 0,
      shareDays: shareDays(maxDays),
      shareProjects: share("share_projects"),
      shareLanguages: share("share_languages"),
      shareEditors: share("share_editors"),
      shareOs: share("share_oss"),
      shareMachines: share("share_machines"),
      shareActivity: share("share_activity_chart"),
      weeklyReport: share("reports_weekly"),
      createdAt: val<Date>(u, "created_at", new Date()),
    };

    if (already) console.log(`  already exists as ${already.id}: adding missing data only`);
    else if (!dryRun) {
      if (profile.oidcSub) {
        const [subTaken] = await sql`SELECT 1 FROM users WHERE oidc_sub = ${profile.oidcSub}`;
        if (subTaken) profile.oidcSub = null;
      }
      await sql`INSERT INTO users ${sql(profile)}`;
      console.log(`  user created (${timezone}${profile.oidcSub ? ", SSO linked" : ""}${profile.email ? `, ${profile.email}` : ""})`);
    }
    const userId = already?.id ?? id;

    // API keys: the main one, plus wakapi's extra keys.
    const keys: { key: string; label: string; readOnly: boolean }[] = [];
    if (text(u, "api_key")) keys.push({ key: text(u, "api_key"), label: "wakapi", readOnly: false });
    if ((await columns("api_keys")).size) {
      for (const k of await src<Record<string, unknown>[]>`SELECT * FROM api_keys WHERE user_id = ${id}`) {
        keys.push({ key: text(k, "api_key"), label: text(k, "label") || "wakapi", readOnly: k.read_only === true });
      }
    }
    if (!dryRun) {
      for (const k of keys) {
        await sql`INSERT INTO api_keys (key, user_id, label, read_only) VALUES (${k.key}, ${userId}, ${k.label}, ${k.readOnly}) ON CONFLICT (key) DO NOTHING`;
      }
    }
    console.log(`  ${keys.length} API key(s)`);

    // Aliases: wakapi applies them when reading, so imported names go through them now.
    // Type 0 is project, 1 language. Key is the name shown, value the alias (may contain *).
    const aliasRows = (await columns("aliases")).size
      ? await src<{ type: number; key: string; value: string }[]>`SELECT type, key, value FROM aliases WHERE user_id = ${id}`
      : [];
    const projectAliases = aliasRows.filter((a) => Number(a.type) === 0).map((a) => ({ alias: a.value, project: a.key }));
    const languageAliases = aliasRows.filter((a) => Number(a.type) === 1).map((a) => ({ alias: a.value, project: a.key }));
    const resolveProject = aliasResolver(projectAliases);
    const resolveLanguage = aliasResolver(languageAliases);
    if (!dryRun) {
      for (const a of projectAliases) {
        await sql`
          INSERT INTO project_aliases (user_id, alias, project) VALUES (${userId}, ${a.alias}, ${a.project})
          ON CONFLICT (user_id, alias) DO NOTHING`;
      }
    }

    const mappingRows = (await columns("language_mappings")).size
      ? await src<{ extension: string; language: string }[]>`SELECT extension, language FROM language_mappings WHERE user_id = ${id}`
      : [];
    const mappings = new Map(mappingRows.map((m) => [m.extension.replace(/^\.+/, "").toLowerCase(), canonicalLanguage(m.language)]));
    if (!dryRun) {
      for (const [extension, language] of mappings) {
        await sql`
          INSERT INTO language_mappings (user_id, extension, language) VALUES (${userId}, ${extension}, ${language})
          ON CONFLICT (user_id, extension) DO NOTHING`;
      }
    }
    console.log(`  ${projectAliases.length} project alias(es), ${languageAliases.length} language alias(es), ${mappings.size} extension mapping(s)`);

    // Heartbeats, in id order with keyset pagination (resumable, no long-lived cursor).
    const [{ total }] = await src<{ total: number }[]>`SELECT count(*)::int AS total FROM heartbeats WHERE user_id = ${id}`;
    let lastId = 0n;
    let read = 0;
    let inserted = 0;
    const started = Date.now();
    const has = (col: string) => hbCols.has(col);
    for (;;) {
      const rows = await src<Record<string, unknown>[]>`
        SELECT *, ${timeExpr} AS epoch_ms FROM heartbeats
        WHERE user_id = ${id} AND id > ${lastId.toString()}
        ORDER BY id LIMIT ${BATCH}`;
      if (rows.length === 0) break;
      lastId = BigInt(rows[rows.length - 1].id as string | number);
      read += rows.length;

      const batch = rows.map((r) => {
        const entity = text(r, "entity");
        const type = text(r, "type") || "file";
        const language = mapLanguage(entity, mappings) ?? canonicalLanguage(resolveLanguage(text(r, "language")));
        const category = text(r, "category") || (type === "domain" || type === "url" ? "browsing" : type === "file" && language ? "coding" : "");
        const row = {
          userId,
          time: new Date(Math.round(Number(r.epoch_ms))),
          entity,
          type,
          category,
          project: resolveProject(text(r, "project")),
          branch: text(r, "branch"),
          language,
          editor: canonicalEditor(text(r, "editor")),
          operatingSystem: canonicalOs(text(r, "operating_system")),
          machine: text(r, "machine"),
          aiModel: has("ai_model") ? text(r, "ai_model") : "",
          isWrite: r.is_write === true,
          userAgent: text(r, "user_agent").slice(0, 255),
          lines: has("lines") && r.lines != null ? Number(r.lines) : null,
          lineAdditions: has("line_additions") && r.line_additions != null ? Number(r.line_additions) : null,
          lineDeletions: has("line_deletions") && r.line_deletions != null ? Number(r.line_deletions) : null,
        };
        return { ...row, hash: heartbeatHash(row) };
      });

      if (!dryRun) {
        const res = await sql`INSERT INTO heartbeats ${sql(batch)} ON CONFLICT (user_id, hash) DO NOTHING`;
        inserted += res.count;
      }
      const rate = Math.round(read / ((Date.now() - started) / 1000 || 1));
      process.stdout.write(`\r  heartbeats: ${read.toLocaleString()} / ${total.toLocaleString()} read, ${inserted.toLocaleString()} new (${rate.toLocaleString()}/s)   `);
    }
    process.stdout.write("\n");

    if (!dryRun) {
      process.stdout.write("  computing durations and daily stats… ");
      const t = Date.now();
      await recompute(userId, null);
      const [{ seconds }] = await sql<{ seconds: number }[]>`SELECT coalesce(sum(seconds), 0)::float8 AS seconds FROM daily_stats WHERE user_id = ${userId}`;
      console.log(`done in ${Math.round((Date.now() - t) / 1000)}s: ${Math.round(seconds / 3600).toLocaleString()} hours in total`);
    }
  }

  console.log(
    `\nDone. Point your editors' ~/.wakatime.cfg api_url at this server's /api (same API keys).` +
      `\nSign in with Authentik: accounts are matched on the wakapi SSO subject, email, or username.`,
  );
}

try {
  await main();
} catch (e) {
  console.error("\nImport failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await src.end();
  await sql.end();
}
