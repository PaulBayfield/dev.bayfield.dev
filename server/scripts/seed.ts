// Fills a development database with a year of made-up activity.
//   npm run seed    → user "demo" (set DEV_LOGIN_USER=demo to sign in as it locally), API key printed at the end.

import { migrate, sql } from "../src/db.ts";
import { newApiKey } from "../src/crypto.ts";
import { recompute } from "../src/durations.ts";
import { heartbeatHash } from "../src/ingest.ts";

const DAYS = Number(process.env.SEED_DAYS ?? 400);
const USER = "demo";

const projects = [
  { name: "devtime", weight: 5, branches: ["main", "feat/goals", "fix/heatmap"], files: ["server/src/stats.ts", "server/src/ingest.ts", "src/App.tsx", "src/components/Dashboard.tsx", "src/styles.css", "README.md"] },
  { name: "calendar.bayfield.dev", weight: 3, branches: ["main", "booking-page"], files: ["src/components/WeekView.tsx", "server/src/index.ts", "src-tauri/src/lib.rs", "src/styles.css"] },
  { name: "notes.bayfield.dev", weight: 3, branches: ["main", "editor-tables"], files: ["src/editor/schema.ts", "src/editor/Editor.tsx", "src/components/Sidebar.tsx", "src/app.css"] },
  { name: "prisme", weight: 2, branches: ["main", "worker-sync"], files: ["src/worker/__main__.py", "src/worker/sync.py", "src/frontend/app/page.tsx", "docker-compose.yml"] },
  { name: "dotfiles", weight: 1, branches: ["master"], files: [".zshrc", "nvim/init.lua", "install.sh"] },
];
const LANGS: Record<string, string> = { ts: "TypeScript", tsx: "TSX", css: "CSS", md: "Markdown", rs: "Rust", py: "Python", yml: "YAML", lua: "Lua", sh: "Bash", zshrc: "Shell" };
const languageOf = (f: string) => LANGS[f.split(".").pop()!] ?? "Text";
const machines = [
  { machine: "desktop", os: "Windows", editors: ["VS Code", "VS Code", "Claude Code"] },
  { machine: "laptop", os: "Linux", editors: ["VS Code", "Neovim"] },
];

// Deterministic randomness, so screenshots are reproducible.
let state = 42;
const rand = () => (state = (state * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const weighted = () => {
  let r = rand() * projects.reduce((s, p) => s + p.weight, 0);
  return projects.find((p) => (r -= p.weight) < 0) ?? projects[0];
};

await migrate();
await sql`DELETE FROM users WHERE id = ${USER}`;
const key = newApiKey();
await sql`INSERT INTO users (id, name, email, is_admin, timezone) VALUES (${USER}, 'Demo', 'demo@example.com', true, 'Europe/Paris')`;
await sql`INSERT INTO api_keys (key, user_id, label) VALUES (${key}, ${USER}, 'Seed')`;
await sql`INSERT INTO goals (user_id, period, seconds) VALUES (${USER}, 'day', 7200), (${USER}, 'week', 72000)`;
await sql`INSERT INTO goals (user_id, period, seconds, dimension, value) VALUES (${USER}, 'week', 18000, 'project', 'devtime')`;

const now = Date.now();
let rows: Record<string, unknown>[] = [];
let total = 0;
const flush = async () => {
  if (!rows.length) return;
  await sql`INSERT INTO heartbeats ${sql(rows)} ON CONFLICT DO NOTHING`;
  total += rows.length;
  rows = [];
};

for (let d = DAYS; d >= 0; d--) {
  const day = new Date(now - d * 86400_000);
  const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
  if (rand() < (weekend ? 0.55 : 0.12)) continue;
  const sessions = 1 + Math.floor(rand() * (weekend ? 2 : 3));
  for (let s = 0; s < sessions; s++) {
    const startHour = weekend ? 10 + rand() * 10 : pick([7, 8, 12, 13, 19, 20]) + rand();
    let t = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) + startHour * 3600_000;
    const end = t + (20 + rand() * 160) * 60_000;
    if (end > now) continue;
    const project = weighted();
    const m = pick(machines);
    const editor = pick(m.editors);
    const branch = pick(project.branches);
    while (t < end) {
      const entity = `/home/paul/code/${project.name}/${pick(project.files)}`;
      const row = {
        userId: USER,
        time: new Date(t),
        entity,
        type: "file",
        category: rand() < 0.08 ? "debugging" : "coding",
        project: project.name,
        branch,
        language: languageOf(entity),
        editor,
        operatingSystem: m.os,
        machine: m.machine,
        aiModel: "",
        isWrite: rand() < 0.3,
        userAgent: `wakatime/v1.115.2 (${m.os.toLowerCase()}-10.0-x86_64) go1.24.4 vscode/1.105.0 vscode-wakatime/25.3.0`,
        lines: Math.floor(rand() * 600),
        lineAdditions: null,
        lineDeletions: null,
      };
      rows.push({ ...row, hash: heartbeatHash(row) });
      t += (20 + rand() * 100) * 1000;
    }
    if (rows.length > 2000) await flush();
  }
}
await flush();
console.log(`Inserted ${total.toLocaleString()} heartbeats, computing durations…`);
await recompute(USER, null);
const [{ h }] = await sql<{ h: number }[]>`SELECT round(sum(seconds) / 3600)::int AS h FROM daily_stats WHERE user_id = ${USER}`;
console.log(`Done: ${h} hours. With DEV_LOGIN_USER=demo, open the app and use the development sign-in. API key: ${key}`);
await sql.end();
