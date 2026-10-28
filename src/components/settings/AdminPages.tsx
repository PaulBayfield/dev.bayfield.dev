import { useState } from "react";
import { api, type AdminUser } from "../../lib/api";
import { useApp } from "../../lib/app";
import { invalidate, useApi } from "../../lib/hooks";
import { useSettings } from "../../lib/settings";
import type { UpdateCheck } from "../../lib/updates";
import { ConfirmDialog, Dialog, Dropdown, useToast } from "../common";
import { ExternalLink, MoreHorizontal, Plus } from "../icons";
import { PageHeader, Row } from "./common";

export function UsersPage() {
  const { t, f } = useSettings();
  const { me } = useApp();
  const toast = useToast();
  const users = useApi<AdminUser[]>("/app/admin/users");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const reload = () => {
    invalidate("/app/admin/users");
    users.reload();
  };
  const patch = async (id: string, body: Record<string, unknown>) => {
    try {
      await api(`/app/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body });
      reload();
      toast(t("saved"));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <>
      <PageHeader title={t("users")} hint={`${t("usersHint")} ${t("usersHintStats")}`} />
      <section>
        <div className="settings-list">
          {(users.data ?? []).map((u) => (
            <div key={u.id} className="settings-list-row">
              <div className="settings-list-main">
                <span>
                  {u.name || u.id} <span className="muted small">@{u.id}</span>
                  {u.id === me.id && <span className="badge">{t("you")}</span>}
                  {u.isAdmin && <span className="badge good">{t("admin")}</span>}
                  {!u.ssoLinked && <span className="badge" title={t("pendingHint")}>{t("pending")}</span>}
                </span>
                <span className="small muted">
                  {u.email ?? "—"} · {u.lastSeenAt ? t("lastSeen", { when: f.relative(u.lastSeenAt, t) }) : t("neverSeen")}
                  {u.lastHeartbeatAt && ` · ${t("lastActive").toLowerCase()} ${f.relative(u.lastHeartbeatAt, t)}`}
                </span>
              </div>
              <span className="small muted tabular" title={`${t("activeDays")}: ${f.number(u.days)} · ${t("projects")}: ${f.number(u.projects)}`}>
                {f.duration(u.weekSeconds)} · {f.duration(u.seconds)}
              </span>
              {u.id !== me.id && (
                <Dropdown button={(_, toggle) => <button className="icon-button small" aria-label="More" onClick={toggle}><MoreHorizontal size={14} /></button>}>
                  {(close) => (
                    <>
                      <button
                        onClick={() => {
                          close();
                          setEditing(u);
                        }}
                      >
                        {t("editUser")}
                      </button>
                      <button
                        onClick={() => {
                          close();
                          void patch(u.id, { isAdmin: !u.isAdmin });
                        }}
                      >
                        {u.isAdmin ? t("removeAdmin") : t("makeAdmin")}
                      </button>
                      <button
                        onClick={() => {
                          close();
                          void patch(u.id, { signOut: true });
                        }}
                      >
                        {t("signOutEverywhere")}
                      </button>
                      <div className="menu-separator" />
                      <button
                        className="danger"
                        onClick={() => {
                          close();
                          setDeleting(u);
                        }}
                      >
                        {t("deleteUser")}
                      </button>
                    </>
                  )}
                </Dropdown>
              )}
            </div>
          ))}
        </div>
        <button className="text-button" style={{ marginTop: 10 }} onClick={() => setCreating(true)}>
          <Plus size={14} />
          {t("newUser")}
        </button>
      </section>
      {creating && <NewUserDialog onClose={() => setCreating(false)} onCreated={reload} />}
      {editing && <EditUserDialog user={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {deleting && (
        <ConfirmDialog
          title={t("deleteUser")}
          text={t("deleteUserConfirm", { name: deleting.name || deleting.id })}
          word={deleting.id}
          action={t("delete")}
          onConfirm={async () => {
            await api(`/app/admin/users/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
            reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

function NewUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useSettings();
  const { server } = useApp();
  const toast = useToast();
  const [form, setForm] = useState({ username: "", name: "", email: "", isAdmin: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <Dialog title={t("newUser")} onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api("/app/admin/users", { body: form });
            onCreated();
            toast(t("userCreated"));
            onClose();
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <label className="field">
          {t("username")}
          <input className="text-field" value={form.username} onChange={(e) => set({ username: e.target.value })} autoFocus required />
        </label>
        <label className="field">
          {t("displayName")}
          <input className="text-field" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field">
          {t("emailLabel")}
          <input className="text-field" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
        </label>
        <p className="dialog-text">{t("newUserHint", { name: server?.oidc?.name ?? "SSO" })}</p>
        <label className="checkbox">
          <input type="checkbox" checked={form.isAdmin} onChange={(e) => set({ isAdmin: e.target.checked })} />
          {t("admin")}
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="text-button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="primary-button" disabled={busy}>
            {t("create")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Name and email: users signed in through SSO can't change their own. */
function EditUserDialog({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const { t } = useSettings();
  const toast = useToast();
  const [form, setForm] = useState({ name: user.name, email: user.email ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={t("editUser")} onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api(`/app/admin/users/${encodeURIComponent(user.id)}`, { method: "PATCH", body: form });
            onSaved();
            toast(t("saved"));
            onClose();
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <label className="field">
          {t("username")}
          <input className="text-field" value={user.id} disabled />
        </label>
        <label className="field">
          {t("displayName")}
          <input className="text-field" value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </label>
        <label className="field">
          {t("emailLabel")}
          <input className="text-field" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="text-button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="primary-button" disabled={busy}>
            {t("save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** The version, whether a newer one is out, and where to find the source. */
export function AboutPage({ updates }: { updates: UpdateCheck }) {
  const { t, f } = useSettings();
  const { server } = useApp();
  const { status, checking, error, check } = updates;
  const version = status?.current ?? (server?.version && server.version !== "dev" ? server.version : __APP_VERSION__);
  const latest = status?.available ? status.latest : null;

  const hint = status?.disabled
    ? t("updateCheckOff")
    : checking
      ? t("checkingUpdates")
      : latest
        ? t("updateAvailable", { version: latest.version })
        : error
          ? t("updateCheckFailed")
          : status?.latest
            ? t("upToDate")
            : t("noReleases");

  return (
    <>
      <PageHeader title={t("about")} />
      <section className="settings-rows">
        <Row label={t("appName")} hint={t("aboutText")}>
          <span className="muted small tabular">{t("version", { version })}</span>
        </Row>
        <Row
          label={t("updates")}
          hint={
            <>
              {hint}
              {latest && <> {t("updateHowTo")}</>}
              {!latest && status?.checkedAt && !checking && !status.disabled && <> · {t("lastChecked", { when: f.relative(status.checkedAt, t) })}</>}
            </>
          }
        >
          {latest ? (
            <a className="primary-button" href={latest.url} target="_blank" rel="noreferrer">
              {t("whatsNew")}
            </a>
          ) : (
            !status?.disabled && (
              <button className="text-button" disabled={checking} onClick={() => void check()}>
                {t("checkForUpdates")}
              </button>
            )
          )}
        </Row>
        <Row label={t("allVersions")}>
          <a className="text-button" href={status?.releasesUrl ?? "https://github.com/PaulBayfield/dev.bayfield.dev/releases"} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            {t("releaseNotes")}
          </a>
        </Row>
        <Row label={t("sourceCode")}>
          <a className="text-button" href="https://github.com/PaulBayfield/dev.bayfield.dev" target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            GitHub
          </a>
        </Row>
      </section>
    </>
  );
}
