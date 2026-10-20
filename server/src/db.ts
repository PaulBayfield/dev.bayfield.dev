// PostgreSQL connection and schema migrations.
//
// Columns are snake_case in the database and camelCase in JS (postgres.camel transform).
//
// Time tracking works like wakapi: each heartbeat counts the gap to the user's next heartbeat,
// if that gap is under their timeout and both fall on the same local day. That gap is stored
// on the heartbeat (`duration`), and `daily_stats` rolls it up per day and dimension so
// dashboards over months or years only read a few thousand rows.

import postgres from "postgres";
import { DATABASE_URL } from "./config.ts";

export const sql = postgres(DATABASE_URL, {
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  onnotice: () => {},
  transform: postgres.camel,
});

export type Sql = typeof sql;

/** Heartbeats AI agents send on their own; like wakapi, they don't count towards coding time. */
export const EXCLUDED = sql`(type = 'app' AND category = 'ai coding')`;

/** Columns grouped in `daily_stats`, in the order the API exposes them. */
export const DIMENSIONS = ["project", "language", "editor", "operatingSystem", "machine", "branch", "category"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export const COLUMN: Record<Dimension, string> = {
  project: "project",
  language: "language",
  editor: "editor",
  operatingSystem: "operating_system",
  machine: "machine",
  branch: "branch",
  category: "category",
};

const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE users (
    id text PRIMARY KEY,
    name text NOT NULL DEFAULT '',
    email text UNIQUE,
    password_hash text,
    totp_secret text,
    totp_enabled boolean NOT NULL DEFAULT false,
    totp_last_step bigint NOT NULL DEFAULT 0,
    recovery_codes text[] NOT NULL DEFAULT '{}',
    oidc_sub text UNIQUE,
    is_admin boolean NOT NULL DEFAULT false,
    timezone text NOT NULL DEFAULT 'UTC',
    week_start smallint NOT NULL DEFAULT 1,
    heartbeat_timeout integer NOT NULL DEFAULT 600,
    public_profile boolean NOT NULL DEFAULT false,
    share_days integer NOT NULL DEFAULT 30,
    share_projects boolean NOT NULL DEFAULT false,
    share_languages boolean NOT NULL DEFAULT true,
    share_editors boolean NOT NULL DEFAULT true,
    share_os boolean NOT NULL DEFAULT false,
    share_machines boolean NOT NULL DEFAULT false,
    share_activity boolean NOT NULL DEFAULT true,
    weekly_report boolean NOT NULL DEFAULT false,
    language text NOT NULL DEFAULT 'en',
    last_report_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz
  );

  CREATE TABLE api_keys (
    key text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label text NOT NULL DEFAULT '',
    read_only boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
  );
  CREATE INDEX api_keys_user ON api_keys(user_id);

  CREATE TABLE sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mfa_pending boolean NOT NULL DEFAULT false,
    method text NOT NULL,
    user_agent text NOT NULL DEFAULT '',
    ip text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE oidc_states (
    state text PRIMARY KEY,
    verifier text NOT NULL,
    nonce text NOT NULL,
    expires_at timestamptz NOT NULL
  );

  CREATE TABLE heartbeats (
    id bigserial PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    time timestamptz NOT NULL,
    entity text NOT NULL DEFAULT '',
    type text NOT NULL DEFAULT '',
    category text NOT NULL DEFAULT '',
    project text NOT NULL DEFAULT '',
    branch text NOT NULL DEFAULT '',
    language text NOT NULL DEFAULT '',
    editor text NOT NULL DEFAULT '',
    operating_system text NOT NULL DEFAULT '',
    machine text NOT NULL DEFAULT '',
    ai_model text NOT NULL DEFAULT '',
    is_write boolean NOT NULL DEFAULT false,
    user_agent text NOT NULL DEFAULT '',
    lines integer,
    line_additions integer,
    line_deletions integer,
    duration double precision NOT NULL DEFAULT 0,
    hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX heartbeats_hash ON heartbeats(user_id, hash);
  CREATE INDEX heartbeats_user_time ON heartbeats(user_id, time) INCLUDE (duration);
  CREATE INDEX heartbeats_user_project_time ON heartbeats(user_id, project, time);

  CREATE TABLE daily_stats (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day date NOT NULL,
    project text NOT NULL,
    language text NOT NULL,
    editor text NOT NULL,
    operating_system text NOT NULL,
    machine text NOT NULL,
    branch text NOT NULL,
    category text NOT NULL,
    seconds double precision NOT NULL,
    heartbeats integer NOT NULL
  );
  CREATE INDEX daily_stats_user_day ON daily_stats(user_id, day);

  CREATE TABLE goals (
    id bigserial PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period text NOT NULL CHECK (period IN ('day', 'week')),
    seconds integer NOT NULL CHECK (seconds > 0),
    dimension text CHECK (dimension IN ('project', 'language', 'editor', 'category')),
    value text,
    weekdays_only boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX goals_user ON goals(user_id);

  CREATE TABLE project_aliases (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alias text NOT NULL,
    project text NOT NULL,
    PRIMARY KEY (user_id, alias)
  );

  CREATE TABLE language_mappings (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    extension text NOT NULL,
    language text NOT NULL,
    PRIMARY KEY (user_id, extension)
  );

  CREATE TABLE kv (key text PRIMARY KEY, value text NOT NULL);
  `,
  /* 2: sign-in is single sign-on only: no passwords, no app-level 2FA (the provider handles MFA) */ `
  ALTER TABLE users
    DROP COLUMN password_hash,
    DROP COLUMN totp_secret,
    DROP COLUMN totp_enabled,
    DROP COLUMN totp_last_step,
    DROP COLUMN recovery_codes;
  ALTER TABLE sessions DROP COLUMN mfa_pending;
  `,
];

export async function migrate() {
  await sql.begin(async (tx) => {
    // Several containers starting at once: only one migrates.
    await tx`SELECT pg_advisory_xact_lock(4242001)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const [{ v }] = await tx<{ v: number }[]>`SELECT coalesce(max(version), 0)::int AS v FROM schema_migrations`;
    for (let i = v; i < MIGRATIONS.length; i++) {
      await tx.unsafe(MIGRATIONS[i]);
      await tx`INSERT INTO schema_migrations (version) VALUES (${i + 1})`;
      console.log(`Database migrated to version ${i + 1}`);
    }
  });
}

export async function kvGet(key: string): Promise<string | undefined> {
  const [row] = await sql<{ value: string }[]>`SELECT value FROM kv WHERE key = ${key}`;
  return row?.value;
}

export async function kvSet(key: string, value: string) {
  await sql`INSERT INTO kv (key, value) VALUES (${key}, ${value}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
}
