// The user record and the shape the app sees.

import { sql } from "./db.ts";

export interface User {
  id: string;
  name: string;
  email: string | null;
  oidcSub: string | null;
  isAdmin: boolean;
  timezone: string;
  weekStart: number;
  heartbeatTimeout: number;
  publicProfile: boolean;
  shareDays: number;
  shareProjects: boolean;
  shareLanguages: boolean;
  shareEditors: boolean;
  shareOs: boolean;
  shareMachines: boolean;
  shareActivity: boolean;
  weeklyReport: boolean;
  language: "en" | "fr";
  lastReportAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date | null;
}

export async function getUser(id: string): Promise<User | undefined> {
  const [u] = await sql<User[]>`SELECT * FROM users WHERE id = ${id}`;
  return u;
}

/** What the signed-in user's app gets: no secrets. */
export function meView(u: User) {
  return {
    id: u.id,
    name: u.name || u.id,
    email: u.email,
    isAdmin: u.isAdmin,
    timezone: u.timezone,
    weekStart: u.weekStart,
    heartbeatTimeout: u.heartbeatTimeout,
    /** False for accounts imported or created by an admin until their first sign-in. */
    ssoLinked: !!u.oidcSub,
    sharing: {
      publicProfile: u.publicProfile,
      days: u.shareDays,
      projects: u.shareProjects,
      languages: u.shareLanguages,
      editors: u.shareEditors,
      os: u.shareOs,
      machines: u.shareMachines,
      activity: u.shareActivity,
    },
    weeklyReport: u.weeklyReport,
    createdAt: u.createdAt,
  };
}

/** Usernames end up in URLs (public profile, badges): keep them simple. */
export const USERNAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/;

/** A free username based on `wanted` ("paul", "paul2", …). */
export async function freeUsername(wanted: string): Promise<string> {
  const base =
    wanted
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_.-]+/g, "")
      .replace(/^[^a-zA-Z0-9]+/, "")
      .slice(0, 50) || "user";
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? base : `${base}${i}`;
    const [taken] = await sql`SELECT 1 FROM users WHERE lower(id) = lower(${candidate})`;
    if (!taken) return candidate;
  }
}
