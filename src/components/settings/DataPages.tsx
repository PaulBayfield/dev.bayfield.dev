import { useState } from "react";
import { api, type ApiKey } from "../../lib/api";
import { useApp } from "../../lib/app";
import { invalidate, useApi } from "../../lib/hooks";
import { useSettings } from "../../lib/settings";
import { ConfirmDialog, CopyButton, useToast } from "../common";
import { Download, ExternalLink, Eye, EyeOff, Plus, Trash } from "../icons";
import { PageHeader, Row, Switch, useSaveProfile } from "./common";

const origin = location.origin;

// --- Editors & API keys ---

export function EditorsPage() {
  const { t, f } = useSettings();
  const keys = useApi<ApiKey[]>("/app/keys");
  const [label, setLabel] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ApiKey | null>(null);
  const toast = useToast();
  const first = keys.data?.find((k) => !k.readOnly);
  const cfg = `[settings]\napi_url = ${origin}/api\napi_key = ${first?.key ?? "<create a key below>"}`;

  const reload = () => {
    invalidate("/app/keys");
    keys.reload();
  };

  return (
    <>
      <PageHeader title={t("editorsAndKeys")} hint={t("editorsHint")} />
      <section>
        <h3>{t("setupSteps")}</h3>
        <ol className="steps">
          <li>
            {t("setupStep1")}{" "}
            <a href="https://wakatime.com/plugins" target="_blank" rel="noreferrer">
              wakatime.com/plugins <ExternalLink size={12} />
            </a>
          </li>
          <li>
            {t("setupStep2")}
            <pre className="code-block" style={{ marginTop: 8 }}>
              {cfg}
              <span className="copy-button">
                <CopyButton text={cfg} />
              </span>
            </pre>
          </li>
          <li>{t("setupStep3")}</li>
        </ol>
        <p className="small muted" style={{ marginTop: 12 }}>
          {t("migratedFromWakapi")}
        </p>
      </section>

      <section>
        <h3>{t("apiKeys")}</h3>
        <div className="settings-list">
          {(keys.data ?? []).map((k) => (
            <div key={k.key} className="settings-list-row">
              <div className="settings-list-main">
                <span>
                  {k.label}
                  {k.readOnly && <span className="badge">{t("readOnly")}</span>}
                </span>
                <code className="small muted">{revealed === k.key ? k.key : `${k.key.slice(0, 8)}-••••-••••-••••-••••••••••••`}</code>
                <span className="small muted">{k.lastUsedAt ? t("usedAt", { when: f.relative(k.lastUsedAt, t) }) : t("neverUsed")}</span>
              </div>
              <button className="icon-button small" onClick={() => setRevealed(revealed === k.key ? null : k.key)} aria-label={revealed === k.key ? t("hide") : t("reveal")}>
                {revealed === k.key ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <CopyButton text={k.key} />
              <button className="icon-button small danger" onClick={() => setDeleting(k)} aria-label={t("deleteKey")}>
                <Trash size={14} />
              </button>
            </div>
          ))}
          <form
            className="settings-list-row"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const res = await api<{ key: string }>("/app/keys", { body: { label: label.trim() || "Editor" } });
                setLabel("");
                setRevealed(res.key);
                reload();
              } catch (err) {
                toast((err as Error).message, "error");
              }
            }}
          >
            <input className="text-field" style={{ flex: 1 }} placeholder={t("keyLabel")} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={64} />
            <button className="text-button">
              <Plus size={14} />
              {t("newKey")}
            </button>
          </form>
        </div>
      </section>
      {deleting && (
        <ConfirmDialog
          title={t("deleteKey")}
          text={`${deleting.label}: ${t("deleteKeyConfirm")}`}
          action={t("delete")}
          onConfirm={async () => {
            await api(`/app/keys/${encodeURIComponent(deleting.key)}`, { method: "DELETE" });
            reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

// --- Data ---

export function DataPage() {
  const { t } = useSettings();
  const { me, reloadProjects } = useApp();
  const { save } = useSaveProfile();
  const toast = useToast();
  const aliases = useApi<{ alias: string; project: string }[]>("/app/aliases");
  const mappings = useApi<{ extension: string; language: string }[]>("/app/mappings");
  const [ext, setExt] = useState("");
  const [lang, setLang] = useState("");
  const [history, setHistory] = useState(true);
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <PageHeader title={t("data")} hint={t("dataHint")} />
      <section className="settings-rows">
        <Row label={t("timeout")} hint={t("timeoutHint")}>
          <select
            value={me.heartbeatTimeout}
            onChange={async (e) => {
              if (await save({ heartbeatTimeout: Number(e.target.value) }, t("recomputing"))) invalidate("/app/");
            }}
          >
            {[1, 2, 5, 10, 15, 20, 30, 45, 60].map((m) => (
              <option key={m} value={m * 60}>
                {t("minutesN", { n: m })}
              </option>
            ))}
          </select>
        </Row>
      </section>

      <section>
        <h3>{t("aliases")}</h3>
        <p className="small muted" style={{ marginBottom: 8 }}>
          {t("aliasesHint")}
        </p>
        {aliases.data?.length ? (
          <div className="settings-list">
            {aliases.data.map((a) => (
              <div key={a.alias} className="settings-list-row">
                <div className="settings-list-main">
                  <span>
                    <code>{a.alias}</code> → {a.project}
                  </span>
                </div>
                <button
                  className="icon-button small danger"
                  aria-label={t("delete")}
                  onClick={async () => {
                    await api(`/app/aliases/${encodeURIComponent(a.alias)}`, { method: "DELETE" });
                    invalidate("/app/aliases");
                    aliases.reload();
                  }}
                >
                  <Trash size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="settings-empty">{t("noAliases")}</p>
        )}
      </section>

      <section>
        <h3>{t("mappings")}</h3>
        <p className="small muted" style={{ marginBottom: 8 }}>
          {t("mappingsHint")}
        </p>
        <div className="settings-list">
          {(mappings.data ?? []).map((m) => (
            <div key={m.extension} className="settings-list-row">
              <div className="settings-list-main">
                <span>
                  <code>.{m.extension}</code> → {m.language}
                </span>
              </div>
              <button
                className="icon-button small danger"
                aria-label={t("delete")}
                onClick={async () => {
                  await api(`/app/mappings/${encodeURIComponent(m.extension)}`, { method: "DELETE" });
                  invalidate("/app/mappings");
                  mappings.reload();
                }}
              >
                <Trash size={14} />
              </button>
            </div>
          ))}
          <form
            className="settings-list-row"
            style={{ flexWrap: "wrap" }}
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/app/mappings", { body: { extension: ext, language: lang, applyToHistory: history } });
                setExt("");
                setLang("");
                invalidate("/app/");
                mappings.reload();
                if (history) reloadProjects();
              } catch (err) {
                toast((err as Error).message, "error");
              }
            }}
          >
            <input className="text-field" style={{ width: 110 }} placeholder={t("extension")} value={ext} onChange={(e) => setExt(e.target.value)} required />
            <span className="muted">→</span>
            <input className="text-field" style={{ flex: 1, minWidth: 120 }} placeholder={t("language")} value={lang} onChange={(e) => setLang(e.target.value)} required />
            <button className="text-button">{t("add")}</button>
            <label className="checkbox" style={{ flexBasis: "100%" }}>
              <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
              {t("applyToHistory")}
            </label>
          </form>
        </div>
      </section>

      <section className="settings-rows">
        <Row label={t("export")} hint={t("exportHint")}>
          <a className="text-button" href="/api/app/export?format=csv" download>
            <Download size={14} /> CSV
          </a>
          <a className="text-button" href="/api/app/export?format=json" download>
            <Download size={14} /> JSON
          </a>
        </Row>
        <Row label={t("deleteData")} hint={t("deleteDataHint")}>
          <button className="text-button danger" onClick={() => setDeleting(true)}>
            {t("delete")}
          </button>
        </Row>
      </section>
      {deleting && (
        <ConfirmDialog
          title={t("deleteData")}
          text={t("deleteDataHint")}
          word={me.id}
          action={t("delete")}
          onConfirm={async () => {
            await api("/app/profile/delete-data", { body: { confirm: me.id } });
            invalidate("/app/");
            reloadProjects();
            toast(t("dataDeleted"));
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  );
}

// --- Sharing ---

export function SharingPage() {
  const { t } = useSettings();
  const { me, projects } = useApp();
  const { save } = useSaveProfile();
  const s = me.sharing;
  const [picked, setProject] = useState("");
  // The project list may arrive after the page opens.
  const project = picked || projects?.find((p) => p.name)?.name || "";
  const share = (patch: Partial<typeof s>) => void save({ sharing: patch });
  const profileUrl = `${origin}/u/${encodeURIComponent(me.id)}`;
  const badge = `${origin}/api/badge/${encodeURIComponent(me.id)}.svg`;
  const projectBadge = `${badge}?project=${encodeURIComponent(project)}`;
  const card = `${origin}/api/card/${encodeURIComponent(me.id)}.svg`;
  // Bust the browser's cache of the previews when settings change.
  const v = JSON.stringify(s).length + Number(s.publicProfile) * 1000 + s.days;

  return (
    <>
      <PageHeader title={t("sharing")} hint={t("sharingHint")} />
      <section className="settings-rows">
        <Row label={t("publicProfile")} hint={s.publicProfile ? <a href={profileUrl} target="_blank" rel="noreferrer">{profileUrl}</a> : t("publicProfileHint")}>
          {s.publicProfile && (
            <a className="text-button" href={profileUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />
              {t("openProfile")}
            </a>
          )}
          <Switch checked={s.publicProfile} onChange={(on) => share({ publicProfile: on })} label={t("publicProfile")} />
        </Row>
        <Row label={t("shareWindow")} hint={t("shareWindowHint")} disabled={!s.publicProfile}>
          <select value={s.days} disabled={!s.publicProfile} onChange={(e) => share({ days: Number(e.target.value) })}>
            {[7, 30, 90, 365].map((d) => (
              <option key={d} value={d}>
                {t("daysN", { n: d })}
              </option>
            ))}
          </select>
        </Row>
      </section>
      <section className="settings-rows">
        <h3>{t("shareWhat")}</h3>
        {(
          [
            ["languages", "shareLanguages"],
            ["editors", "shareEditors"],
            ["projects", "shareProjects"],
            ["os", "shareOs"],
            ["machines", "shareMachines"],
            ["activity", "shareActivity"],
          ] as const
        ).map(([key, label]) => (
          <Row key={key} label={t(label)} disabled={!s.publicProfile}>
            <Switch checked={s[key]} disabled={!s.publicProfile} onChange={(on) => share({ [key]: on })} label={t(label)} />
          </Row>
        ))}
      </section>
      {s.publicProfile && (
        <section>
          <h3>{t("badges")}</h3>
          <p className="small muted">{t("badgesHint")}</p>
          <div className="badge-preview">
            <span className="small">{t("totalBadge")}</span>
            <img src={`${badge}?v=${v}`} alt="" />
            <Snippet text={`![coding time](${badge})`} />
          </div>
          <div className="badge-preview">
            <span className="small">{t("projectBadge")}</span>
            <select value={project} onChange={(e) => setProject(e.target.value)} style={{ alignSelf: "flex-start" }}>
              {(projects ?? []).filter((p) => p.name).map((p) => (
                <option key={p.name}>{p.name}</option>
              ))}
            </select>
            <img src={`${projectBadge}&v=${v}`} alt="" />
            <Snippet text={`![${project}](${projectBadge})`} />
          </div>
          <div className="badge-preview">
            <span className="small">{t("languagesCard")}</span>
            <img src={`${card}?v=${v}`} alt="" />
            <Snippet text={`![languages](${card})`} />
          </div>
        </section>
      )}
    </>
  );
}

function Snippet({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <code style={{ flex: 1 }}>{text}</code>
      <CopyButton text={text} />
    </div>
  );
}

// --- Weekly report ---

export function ReportsPage() {
  const { t } = useSettings();
  const { me, server } = useApp();
  const { save } = useSaveProfile();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const mail = server?.mail ?? false;
  return (
    <>
      <PageHeader title={t("reports")} hint={t("reportsHint")} />
      <section className="settings-rows">
        <Row label={t("weeklyEmail")} hint={!mail ? t("mailOff") : !me.email ? t("needsEmail") : me.email} disabled={!mail || !me.email}>
          {mail && me.email && (
            <button
              className="text-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/app/reports/test", { method: "POST" });
                  toast(t("testSent", { email: me.email! }));
                } catch (e) {
                  toast((e as Error).message, "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("sendTest")}
            </button>
          )}
          <Switch checked={me.weeklyReport} disabled={!mail || !me.email} onChange={(on) => void save({ weeklyReport: on })} label={t("weeklyEmail")} />
        </Row>
      </section>
    </>
  );
}
