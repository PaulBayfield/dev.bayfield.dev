// DevTime server: the web app, its API, and the WakaTime-compatible API editors send heartbeats to.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { DEV_LOGIN_USER, DIST_DIR, PORT, PUBLIC_URL, oidc, mail } from "./config.ts";
import { migrate, sql } from "./db.ts";
import { api } from "./api.ts";
import { authRoutes, sameOrigin } from "./auth.ts";
import { HttpError } from "./http.ts";
import { ingestRoutes } from "./ingest.ts";
import { publicRoutes } from "./public.ts";
import { startReportScheduler } from "./reports.ts";

await migrate();

const indexPath = resolve(DIST_DIR, "index.html");
const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : null;
// index.html applies the theme in a tiny inline script before the bundle loads (no flash of the
// wrong theme). The policy allows exactly that script, by hash.
const inlineScripts = [...(indexHtml ?? "").matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
  (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
);

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...inlineScripts],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
    },
    referrerPolicy: "strict-origin-when-cross-origin",
  }),
);
// Bulk heartbeats from a long offline stretch can be large.
app.use("/api/*", bodyLimit({ maxSize: 5 * 1024 * 1024, onError: (c) => c.json({ error: "Request too large" }, 413) }));
app.use("/api/*", sameOrigin);

app.get("/api/health", async (c) => {
  await sql`SELECT 1`;
  return c.json({ ok: true });
});

app.route("/api/auth", authRoutes);
app.route("/api/app", api);
app.route("/api", publicRoutes);
app.route("/api", ingestRoutes);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

if (indexHtml) {
  const index = indexHtml;
  app.use("/assets/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  app.use("/*", serveStatic({ root: relative(process.cwd(), DIST_DIR) }));
  app.get("*", (c) => {
    c.header("Cache-Control", "no-cache");
    return c.html(index);
  });
} else {
  console.warn(`No web build at ${DIST_DIR}; only the API is served. Run \`npm run build\` in the project root.`);
}

startReportScheduler();

// Expired sessions and sign-in attempts, once an hour.
setInterval(
  () => {
    void sql`DELETE FROM sessions WHERE expires_at < now()`.catch(() => {});
    void sql`DELETE FROM oidc_states WHERE expires_at < now()`.catch(() => {});
  },
  60 * 60_000,
);

serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
  console.log(`DevTime on http://localhost:${port} (public URL ${PUBLIC_URL})`);
  console.log(`  sign-in: ${[oidc && `SSO (${oidc.name})`, DEV_LOGIN_USER && `development sign-in as ${DEV_LOGIN_USER}`].filter(Boolean).join(", ")}`);
  console.log(`  weekly reports: ${mail ? "on" : "off (no SMTP_URL)"}`);
});
