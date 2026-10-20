// Talking to the DevTime server (same origin; Vite proxies /api in development).

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("devtime:signed-out"));
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

// --- Types (mirroring the server) ---

export const DIMENSIONS = ["project", "language", "editor", "operatingSystem", "machine", "branch", "category"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type Filters = Partial<Record<Dimension, string>>;

export interface Item {
  name: string;
  seconds: number;
}

export interface Summary {
  from: string;
  to: string;
  total: number;
  days: { date: string; total: number; projects: Record<string, number> }[];
  breakdowns: Record<Dimension, Item[]>;
}

export interface Me {
  id: string;
  name: string;
  email: string | null;
  isAdmin: boolean;
  timezone: string;
  weekStart: 0 | 1;
  heartbeatTimeout: number;
  ssoLinked: boolean;
  sharing: {
    /** The public profile page (/u/<handle>). */
    page: boolean;
    /** The WakaTime-compatible API, badges and card. */
    api: boolean;
    /** Name in public links (the username unless one was chosen). */
    handle: string;
    /** Name shown publicly; empty: the handle. */
    name: string;
    days: number;
    projects: boolean;
    languages: boolean;
    editors: boolean;
    os: boolean;
    machines: boolean;
    activity: boolean;
  };
  weeklyReport: boolean;
  createdAt: string;
}

export interface AuthConfig {
  oidc: { name: string } | null;
  /** Local development sign-in (DEV_LOGIN_USER). */
  dev: boolean;
}

/** GET /app/updates: whether a newer release is out on GitHub. */
export interface UpdateStatus {
  current: string;
  latest: { version: string; url: string; publishedAt: string | null } | null;
  available: boolean;
  releasesUrl: string;
  checkedAt: string | null;
  /** UPDATE_CHECK=false on the server. */
  disabled?: boolean;
  error?: string;
}

export interface ServerInfo {
  mail: boolean;
  oidc: { name: string } | null;
  version: string;
}

export interface ProjectRow {
  name: string;
  seconds: number;
  firstDay: string;
  lastDay: string;
  recent: number;
}

export interface Goal {
  id: string;
  period: "day" | "week";
  seconds: number;
  dimension: "project" | "language" | "editor" | "category" | null;
  value: string | null;
  weekdaysOnly: boolean;
  current: number;
  history: { start: string; seconds: number; counts: boolean }[];
  streak: number;
}

export interface Session {
  id: string;
  method: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface ApiKey {
  key: string;
  label: string;
  readOnly: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string | null;
  isAdmin: boolean;
  ssoLinked: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  lastHeartbeatAt: string | null;
}

export interface PublicProfile {
  id: string;
  name: string;
  /** The share window in days; 0 = all time. */
  days: number;
  from: string;
  to: string;
  /** Days actually covered (for all time: since the first day with data). */
  spanDays: number;
  total: number;
  daily: { date: string; total: number }[] | null;
  breakdowns: Partial<Record<Dimension, Item[]>>;
  activity: { date: string; seconds: number }[] | null;
  memberSince: string;
}

export function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}
