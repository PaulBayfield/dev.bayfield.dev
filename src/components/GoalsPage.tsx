import { useState } from "react";
import { api, type Goal, type Summary } from "../lib/api";
import { invalidate, useApi } from "../lib/hooks";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { ConfirmDialog, Dialog, Dropdown } from "./common";
import { Flame, MoreHorizontal, Pencil, Plus, Target, Trash } from "./icons";
import { Toolbar } from "./Toolbar";

const SCOPES: { id: Goal["dimension"] | "all"; label: StringKey }[] = [
  { id: "all", label: "goalScopeAll" },
  { id: "project", label: "goalScopeProject" },
  { id: "language", label: "goalScopeLanguage" },
  { id: "editor", label: "goalScopeEditor" },
  { id: "category", label: "goalScopeCategory" },
];

export function GoalsPage() {
  const { t } = useSettings();
  const goals = useApi<Goal[]>("/app/goals");
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);

  const changed = () => {
    invalidate("/app/goals");
    goals.reload();
  };

  return (
    <>
      <Toolbar title={t("goals")} loading={goals.loading}>
        <button className="primary-button" onClick={() => setEditing("new")}>
          <Plus size={14} />
          {t("newGoal")}
        </button>
      </Toolbar>
      <div className="content">
        <div className="page">
          {!goals.data ? (
            <div className="skeleton" style={{ height: 200 }} />
          ) : goals.data.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <Target size={32} />
                <h2>{t("noGoals")}</h2>
                <p>{t("noGoalsHint")}</p>
                <button className="primary-button" onClick={() => setEditing("new")}>
                  <Plus size={14} />
                  {t("newGoal")}
                </button>
              </div>
            </div>
          ) : (
            <div className="goal-cards">
              {goals.data.map((g) => (
                <GoalCard key={g.id} goal={g} onEdit={() => setEditing(g)} onDelete={() => setDeleting(g)} />
              ))}
            </div>
          )}
        </div>
      </div>
      {editing && <GoalDialog goal={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={changed} />}
      {deleting && (
        <ConfirmDialog
          title={t("deleteGoal")}
          text={`${deleting.value ?? t("goalScopeAll")} · ${deleting.period === "day" ? t("perDay") : t("perWeek")}`}
          action={t("delete")}
          onConfirm={async () => {
            await api(`/app/goals/${deleting.id}`, { method: "DELETE" });
            changed();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

function GoalCard({ goal, onEdit, onDelete }: { goal: Goal; onEdit: () => void; onDelete: () => void }) {
  const { t, f } = useSettings();
  const pct = Math.min(1, goal.current / goal.seconds);
  const done = goal.current >= goal.seconds;
  const scope = goal.dimension ? goal.value || t("unknown") : t("goalScopeAll");
  const max = Math.max(goal.seconds, ...goal.history.map((h) => h.seconds));
  return (
    <section className="card goal-card">
      <div className="card-head">
        <span className="card-title">
          {goal.period === "day" ? t("goalDaily") : t("goalWeekly")} · {scope}
        </span>
        <Dropdown button={(_, toggle) => <button className="icon-button small" aria-label="More" onClick={toggle}><MoreHorizontal size={14} /></button>}>
          {(close) => (
            <>
              <button
                onClick={() => {
                  close();
                  onEdit();
                }}
              >
                <span>{t("editGoal")}</span>
                <Pencil size={14} />
              </button>
              <button
                className="danger"
                onClick={() => {
                  close();
                  onDelete();
                }}
              >
                <span>{t("deleteGoal")}</span>
                <Trash size={14} />
              </button>
            </>
          )}
        </Dropdown>
      </div>
      <div>
        <div className="goal-big">{f.duration(goal.current)}</div>
        <div className="muted small">
          {done ? <span className="badge good">{t("goalDone")}</span> : null} {t("goalProgress", { current: f.percent(pct), target: f.duration(goal.seconds) })}{" "}
          {goal.period === "day" ? t("perDay") : t("perWeek")}
        </div>
      </div>
      <div className="meter" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className="meter-fill" style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="goal-history" aria-hidden="true">
        {goal.history.map((h) => (
          <div
            key={h.start}
            className={!h.counts ? "skip" : h.seconds >= goal.seconds ? "met" : ""}
            style={{ height: `${Math.max(4, (h.seconds / max) * 100)}%` }}
            title={`${goal.period === "day" ? f.longDate(h.start) : f.mediumDate(h.start)}: ${f.duration(h.seconds)}`}
          />
        ))}
      </div>
      <div className="goal-meta">
        {goal.streak > 0 ? (
          <>
            <Flame size={14} />
            {goal.period === "day" ? t("streak", { n: goal.streak }) : t("streakWeeks", { n: goal.streak })}
          </>
        ) : (
          t("noStreak")
        )}
      </div>
    </section>
  );
}

function GoalDialog({ goal, onClose, onSaved }: { goal: Goal | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useSettings();
  const [period, setPeriod] = useState<Goal["period"]>(goal?.period ?? "day");
  const [hours, setHours] = useState(goal ? Math.floor(goal.seconds / 3600) : 2);
  const [minutes, setMinutes] = useState(goal ? Math.round((goal.seconds % 3600) / 60) : 0);
  const [scope, setScope] = useState<Goal["dimension"] | "all">(goal?.dimension ?? "all");
  const [value, setValue] = useState(goal?.value ?? "");
  const [weekdaysOnly, setWeekdaysOnly] = useState(goal?.weekdaysOnly ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Suggestions from the last year.
  const year = useApi<Summary>(scope !== "all" ? "/app/stats?range=last_12_months" : null).data;
  const suggestions = scope !== "all" && year ? year.breakdowns[scope!].map((i) => i.name).filter(Boolean) : [];

  return (
    <Dialog title={goal ? t("editGoal") : t("newGoal")} onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const body = {
            period,
            seconds: hours * 3600 + minutes * 60,
            dimension: scope === "all" ? null : scope,
            value: scope === "all" ? null : value.trim(),
            weekdaysOnly,
          };
          try {
            await api(goal ? `/app/goals/${goal.id}` : "/app/goals", { method: goal ? "PUT" : "POST", body });
            onSaved();
            onClose();
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <div className="segmented" role="group" style={{ alignSelf: "flex-start" }}>
          <button type="button" className={period === "day" ? "active" : ""} onClick={() => setPeriod("day")}>
            {t("goalDaily")}
          </button>
          <button type="button" className={period === "week" ? "active" : ""} onClick={() => setPeriod("week")}>
            {t("goalWeekly")}
          </button>
        </div>
        <div className="field-row">
          <label className="field">
            {t("hours")}
            <input type="number" min={0} max={period === "day" ? 23 : 167} value={hours} onChange={(e) => setHours(Math.max(0, Number(e.target.value)))} />
          </label>
          <label className="field">
            {t("minutes")}
            <input type="number" min={0} max={59} step={5} value={minutes} onChange={(e) => setMinutes(Math.max(0, Math.min(59, Number(e.target.value))))} />
          </label>
        </div>
        <label className="field">
          {t("goalScope")}
          <select value={scope ?? "all"} onChange={(e) => setScope(e.target.value as Goal["dimension"] | "all")}>
            {SCOPES.map((s) => (
              <option key={s.id ?? "all"} value={s.id ?? "all"}>
                {t(s.label)}
              </option>
            ))}
          </select>
        </label>
        {scope !== "all" && (
          <>
            <input className="text-field" value={value} onChange={(e) => setValue(e.target.value)} list="goal-values" required aria-label={t("goalScope")} />
            <datalist id="goal-values">
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </>
        )}
        {period === "day" && (
          <label className="checkbox">
            <input type="checkbox" checked={weekdaysOnly} onChange={(e) => setWeekdaysOnly(e.target.checked)} />
            <span>
              {t("weekdaysOnly")} <span className="muted small">· {t("weekdaysOnlyHint")}</span>
            </span>
          </label>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="text-button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="primary-button" disabled={busy || hours * 60 + minutes < 1}>
            {goal ? t("save") : t("create")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
