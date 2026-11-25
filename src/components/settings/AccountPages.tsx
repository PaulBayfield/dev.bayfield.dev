import { useMemo, useState } from "react";
import { api, type Session } from "../../lib/api";
import { useApp } from "../../lib/app";
import { invalidate, useApi } from "../../lib/hooks";
import { useSettings, type Settings, type Theme } from "../../lib/settings";
import type { StringKey } from "../../lib/i18n";
import { ConfirmDialog, useToast } from "../common";
import { PageHeader, Row, useSaveProfile } from "./common";
import { connectPrefs, disconnectPrefs, usePrefsStatus, activeCustomTheme, BASE_COLORS, PREFS_URL } from "../../lib/prefs";
import { ExternalLink } from "../icons";

// --- Profile ---

export function ProfilePage() {
  const { t } = useSettings();
  const { me, signOut, server } = useApp();
  const { save, busy } = useSaveProfile();
  const toast = useToast();
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email ?? "");
  const [deleting, setDeleting] = useState(false);
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [me.timezone];
    }
  }, [me.timezone]);
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // The provider owns SSO identities: only admins edit them (Settings → Users for others).
  const locked = me.ssoLinked && !me.isAdmin;

  return (
    <>
      <PageHeader title={t("profile")} hint={t("profileHint")} />
      <section className="settings-rows">
        <Row label={t("username")} hint={t("usernameHint")}>
          <span className="muted">{me.id}</span>
        </Row>
        {locked ? (
          <>
            <Row label={t("nameLabel")} hint={t("identityLocked", { name: server?.oidc?.name ?? "SSO" })}>
              <span className="muted">{me.name}</span>
            </Row>
            <Row label={t("emailLabel")} hint={t("emailHint")}>
              <span className="muted">{me.email ?? "—"}</span>
            </Row>
          </>
        ) : (
          <>
            <Row label={t("nameLabel")}>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save({ name });
                }}
              >
                <input className="text-field" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
                <button className="primary-button" disabled={busy || name.trim() === me.name}>
                  {t("save")}
                </button>
              </form>
            </Row>
            <Row label={t("emailLabel")} hint={t("emailHint")}>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save({ email });
                }}
              >
                <input className="text-field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <button className="primary-button" disabled={busy || email.trim() === (me.email ?? "")}>
                  {t("save")}
                </button>
              </form>
            </Row>
          </>
        )}
      </section>
      <section className="settings-rows">
        <Row label={t("timezone")} hint={t("timezoneHint")}>
          <select
            value={me.timezone}
            onChange={async (e) => {
              if (await save({ timezone: e.target.value }, t("recomputing"))) invalidate("/app/");
            }}
          >
            {!zones.includes(me.timezone) && <option value={me.timezone}>{me.timezone}</option>}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
                {z === browserZone ? " ✓" : ""}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t("weekStart")}>
          <select
            value={me.weekStart}
            onChange={async (e) => {
              if (await save({ weekStart: Number(e.target.value) })) invalidate("/app/");
            }}
          >
            <option value={1}>{t("monday")}</option>
            <option value={0}>{t("sunday")}</option>
          </select>
        </Row>
      </section>
      <section className="settings-rows">
        <Row label={t("deleteAccount")} hint={t("deleteAccountHint")}>
          <button className="text-button danger" onClick={() => setDeleting(true)}>
            {t("deleteAccount")}
          </button>
        </Row>
      </section>
      {deleting && (
        <ConfirmDialog
          title={t("deleteAccount")}
          text={t("deleteAccountHint")}
          word={me.id}
          action={t("deleteAccount")}
          onConfirm={async () => {
            await api("/app/profile/delete-account", { body: { confirm: me.id } });
            toast(t("saved"));
            signOut();
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  );
}

// --- Preferences ---

const THEMES: { id: Theme; label: StringKey }[] = [
  { id: "system", label: "themeSystem" },
  { id: "light", label: "themeLight" },
  { id: "dark", label: "themeDark" },
  { id: "rosepine", label: "themeRosepine" },
  { id: "rosepine-dawn", label: "themeRosepineDawn" },
];

export function PreferencesPage() {
  const { t, settings, update } = useSettings();
  const select = <K extends keyof Settings>(key: K, options: [Settings[K], string][]) => (
    <select
      value={String(settings[key])}
      onChange={(e) => update({ [key]: options.find(([v]) => String(v) === e.target.value)![0] } as Partial<Settings>)}
    >
      {options.map(([value, label]) => (
        <option key={String(value)} value={String(value)}>
          {label}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <PageHeader title={t("preferences")} hint={t("preferencesHint")} />
      <section>
        <h3>{t("appearance")}</h3>
        <div className="theme-picker">
          {THEMES.map(({ id, label }) => (
            <button key={id} className={`theme-card${!activeCustomTheme(settings) && settings.theme === id ? " active" : ""}`} onClick={() => update({ theme: id, customTheme: "" })}>
              <span className={`theme-preview ${id}`}>
                <span />
                <span />
                <span />
              </span>
              <span className="theme-card-name">{t(label)}</span>
            </button>
          ))}
          {settings.customThemes.map((theme) => {
            const c = { ...BASE_COLORS[theme.base], ...theme.colors };
            return (
              <button
                key={theme.id}
                className={`theme-card${activeCustomTheme(settings)?.id === theme.id ? " active" : ""}`}
                title={theme.name}
                onClick={() => update({ theme: theme.base, customTheme: theme.id })}
              >
                <span className="theme-preview" style={{ background: c.bg, borderColor: c["border-strong"] }}>
                  <span style={{ background: c["bg-sidebar"] }} />
                  <span style={{ background: c.primary }} />
                  <span style={{ background: c.accent }} />
                </span>
                <span className="theme-card-name">{theme.name}</span>
              </button>
            );
          })}
        </div>
        <p className="theme-manage">
          {t("manageThemesHint")}{" "}
          <a className="theme-manage-link" href={PREFS_URL} target="_blank" rel="noopener">
            {t("manageThemes")}
            <ExternalLink size={13} />
          </a>
        </p>
      </section>
      <section className="settings-rows">
        <Row label={t("languageLabel")}>
          {select("language", [
            ["auto", t("automatic")],
            ["fr", "Français"],
            ["en", "English"],
          ])}
        </Row>
        <Row label={t("durationFormat")}>
          {select("durationStyle", [
            ["long", t("durationLong")],
            ["short", t("durationShort")],
            ["decimal", t("durationDecimal")],
          ])}
        </Row>
        <Row label={t("timeFormat")}>
          {select("timeFormat", [
            ["auto", t("automatic")],
            ["24h", "24h"],
            ["12h", "12h"],
          ])}
        </Row>
      </section>
      <PrefsSyncRow />
    </>
  );
}

// --- Security ---

export function SecurityPage() {
  const { t, f } = useSettings();
  const { server } = useApp();
  const sessions = useApi<Session[]>("/app/sessions");
  const sso = server?.oidc?.name ?? "SSO";
  const reload = () => {
    invalidate("/app/sessions");
    sessions.reload();
  };

  return (
    <>
      <PageHeader title={t("security")} hint={t("securityHint", { name: sso })} />
      <section>
        <h3>{t("sessions")}</h3>
        <div className="settings-list">
          {(sessions.data ?? []).map((s) => (
            <div key={s.id} className="settings-list-row">
              <div className="settings-list-main">
                <span>
                  {describeAgent(s.userAgent)}
                  {s.current && <span className="badge good">{t("thisDevice")}</span>}
                </span>
                <span className="small muted">
                  {t("lastActiveAt", { when: f.relative(s.lastSeenAt, t) })} · {s.ip}
                </span>
              </div>
              {!s.current && (
                <button
                  className="text-button"
                  onClick={async () => {
                    await api(`/app/sessions/${s.id}`, { method: "DELETE" });
                    reload();
                  }}
                >
                  {t("signOutDevice")}
                </button>
              )}
            </div>
          ))}
        </div>
        {(sessions.data?.length ?? 0) > 1 && (
          <button
            className="text-button"
            style={{ marginTop: 10 }}
            onClick={async () => {
              await api("/app/sessions/revoke-others", { method: "POST" });
              reload();
            }}
          >
            {t("signOutOthers")}
          </button>
        )}
      </section>
    </>
  );
}

/** "Chrome · Windows" from a user agent, roughly. */
function describeAgent(ua: string): string {
  const browser = /edg\//i.test(ua) ? "Edge" : /firefox\//i.test(ua) ? "Firefox" : /chrome\//i.test(ua) ? "Chrome" : /safari\//i.test(ua) ? "Safari" : ua.split(" ")[0] || "?";
  const os = /windows/i.test(ua) ? "Windows" : /android/i.test(ua) ? "Android" : /iphone|ipad/i.test(ua) ? "iOS" : /mac os/i.test(ua) ? "macOS" : /linux/i.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

/** Theme, language, time format, durations and time zone shared with the other bayfield.dev apps, through prefs.bayfield.dev. */
function PrefsSyncRow() {
  const { t } = useSettings();
  const { status, email } = usePrefsStatus();
  const hint =
    status === "connected"
      ? t("prefsConnected", { email: email ?? "" })
      : status === "connecting"
        ? t("prefsApprove")
        : status === "offline"
          ? t("prefsOffline")
          : t("prefsHint");
  return (
    <section className="settings-rows">
      <h3>{t("prefsTitle")}</h3>
      <Row label={t("prefsLabel")} hint={hint}>
        {status === "connected" ? (
          <button className="text-button" onClick={() => void disconnectPrefs()}>
            {t("prefsDisconnect")}
          </button>
        ) : status === "disconnected" || status === "connecting" ? (
          <button className="primary-button" onClick={() => void connectPrefs("Dev")}>
            {t("prefsConnect")}
          </button>
        ) : null}
      </Row>
    </section>
  );
}
