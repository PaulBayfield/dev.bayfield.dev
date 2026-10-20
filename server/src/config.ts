// Server configuration, read once from the environment (see server/.env.example).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see server/.env.example)`);
  return value;
}

const flag = (name: string, fallback: boolean) => {
  const v = process.env[name]?.trim().toLowerCase();
  return v ? v === "true" || v === "1" || v === "yes" : fallback;
};

const list = (name: string) =>
  (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const PUBLIC_URL = required("PUBLIC_URL").replace(/\/+$/, "");
export const PORT = Number(process.env.PORT ?? 8790);
export const DATABASE_URL = required("DATABASE_URL");
export const DIST_DIR = resolve(process.env.DIST_DIR ?? resolve(import.meta.dirname, "../../dist"));
export const SECURE_COOKIES = PUBLIC_URL.startsWith("https://");

/** Set by the Docker build; when running from a checkout, the root package.json's version. */
export const APP_VERSION = (() => {
  const env = process.env.APP_VERSION?.trim();
  if (env && env !== "dev") return env;
  try {
    return (JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8")) as { version?: string }).version ?? "dev";
  } catch {
    return "dev";
  }
})();

/** Look on GitHub for a newer release (shown in Settings → About). */
export const UPDATE_CHECK = flag("UPDATE_CHECK", true);

/**
 * Local development only: signs straight in as this user, without the identity provider.
 * Ignored unless PUBLIC_URL is localhost, so it can't be switched on in production by mistake.
 */
export const DEV_LOGIN_USER = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(PUBLIC_URL) ? process.env.DEV_LOGIN_USER?.trim() || null : null;

if (!process.env.OIDC_ISSUER && !DEV_LOGIN_USER) {
  throw new Error("Set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET: DevTime signs in through your identity provider (see server/.env.example)");
}

/** Sign in with Authentik (or any OIDC provider): the only way in. */
export const oidc = process.env.OIDC_ISSUER
  ? {
      issuer: process.env.OIDC_ISSUER.replace(/\/+$/, ""),
      clientId: required("OIDC_CLIENT_ID"),
      clientSecret: required("OIDC_CLIENT_SECRET"),
      /** Shown on the sign-in button. */
      name: process.env.OIDC_NAME ?? "Authentik",
      redirectUri: `${PUBLIC_URL}/api/auth/oidc/callback`,
      /** New users signing in through the provider get an account (default), or must be created first. */
      autoCreate: flag("OIDC_AUTO_CREATE", true),
      /** If set, only members of one of these groups (the `groups` claim) may sign in. */
      allowedGroups: list("OIDC_ALLOWED_GROUPS"),
      /** Members of these groups are admins. */
      adminGroups: list("OIDC_ADMIN_GROUPS"),
    }
  : null;


/** Weekly reports. Off when SMTP_URL is unset. */
export const mail = process.env.SMTP_URL
  ? { url: process.env.SMTP_URL, from: process.env.MAIL_FROM ?? `DevTime <devtime@${new URL(PUBLIC_URL).hostname}>` }
  : null;

/** Header your reverse proxy puts the visitor IP in (e.g. cf-connecting-ip). Unset: the TCP peer. */
export const CLIENT_IP_HEADER = process.env.CLIENT_IP_HEADER?.toLowerCase();

/** Heartbeats older than this are rejected (the CLI's offline queue can replay old ones). */
export const HEARTBEAT_MAX_AGE_DAYS = Number(process.env.HEARTBEAT_MAX_AGE_DAYS ?? 365);

/** How long a session lasts without being used. */
export const SESSION_IDLE_DAYS = Number(process.env.SESSION_IDLE_DAYS ?? 30);
