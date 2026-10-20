import { useMemo, useState, type CSSProperties } from "react";
import { api, query as qs, type Dimension, type Goal, type Item, type Summary } from "../lib/api";
import { useApp } from "../lib/app";
import { editorColor, languageColor } from "../lib/colors";
import { invalidate, useApi } from "../lib/hooks";
import { filtersOf, previousRange, rangeParams } from "../lib/range";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { Breakdown, Heatmap, Legend, RhythmGrid, TimeChart, TimeTable, bucketize } from "./charts";
import { Dialog, Dropdown, useToast } from "./common";
import { BarChart, MoreHorizontal, Pencil, Table, Terminal, X } from "./icons";
import { Toolbar } from "./Toolbar";

const DIM_LABEL: Record<Dimension, StringKey> = {
  project: "project",
  language: "language",
  editor: "editor",
  operatingSystem: "operatingSystem",
  machine: "machine",
  branch: "branch",
  category: "category",
};

interface Props {
  /** Set on a project's page. */
  project?: string;
}

export function Dashboard({ project }: Props) {
  const { t, f } = useSettings();
  const { query, setQuery, navigate, projectColor, rankedProjects, me, projects, openSettings } = useApp();
  const range = rangeParams(query);
  const filters = { ...filtersOf(query), ...(project !== undefined ? { project } : {}) };
  const params = { ...range, ...filters };

  const stats = useApi<Summary>(`/app/stats${qs(params)}`);
  const s = stats.data;
  const prevRange = s && range.range !== "all_time" ? previousRange(s.from, s.to) : null;
  const prev = useApi<Summary>(prevRange ? `/app/stats${qs({ ...prevRange, ...filters })}` : null).data;
  const heat = useApi<{ date: string; seconds: number }[]>(`/app/activity${qs(filters)}`).data;
  const rhythm = useApi<number[][]>(`/app/rhythm${qs(params)}`).data;
  const files = useApi<Item[]>(project !== undefined ? `/app/projects/${encodeURIComponent(project)}/files${qs({ ...range, ...filtersOf(query) })}` : null).data;
  const goals = useApi<Goal[]>(project === undefined ? "/app/goals" : null).data;

  const [table, setTable] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const chart = useMemo(() => (s ? bucketize(s.days, me.weekStart) : null), [s, me.weekStart]);
  // Stack the projects that have colours, in colour order; within a project page there's only one.
  const series = project !== undefined ? [project] : rankedProjects;

  const pick = (dim: Dimension) => (name: string) => {
    if (dim === "project" && project === undefined) return navigate({ name: "project", project: name }, { ...query });
    setQuery({ [dim]: name });
  };
  const activeFilters = (Object.entries(filtersOf(query)) as [Dimension, string][]).filter(([d]) => !(project !== undefined && d === "project"));

  const noDataEver = projects !== undefined && projects.length === 0;

  const title =
    project !== undefined ? (
      <>
        <button className="crumb" onClick={() => navigate({ name: "projects" })}>
          {t("projects")}
        </button>
        <span className="crumb-sep">/</span>
        <span className="project-dot" style={{ "--c": projectColor(project) } as CSSProperties} />
        <span>{project || t("unknown")}</span>
      </>
    ) : (
      t("dashboard")
    );

  return (
    <>
      <Toolbar title={title} loading={stats.loading} range>
        {project !== undefined && project !== "" && (
          <Dropdown button={(_, toggle) => <button className="icon-button" aria-label="More" onClick={toggle}><MoreHorizontal /></button>}>
            {(close) => (
              <button
                onClick={() => {
                  close();
                  setRenaming(true);
                }}
              >
                <span>{t("rename")}</span>
                <Pencil size={14} />
              </button>
            )}
          </Dropdown>
        )}
      </Toolbar>
      <div className="content">
        <div className="page">
          {activeFilters.length > 0 && (
            <div className="filter-bar">
              {activeFilters.map(([d, v]) => (
                <span key={d} className="filter-chip">
                  {t(DIM_LABEL[d])}: <b>{v || t("unknown")}</b>
                  <button className="icon-button" aria-label={t("removeFilter")} onClick={() => setQuery({ [d]: undefined })}>
                    <X size={12} />
                  </button>
                </span>
              ))}
              {activeFilters.length > 1 && (
                <button className="link-button" onClick={() => setQuery(Object.fromEntries(activeFilters.map(([d]) => [d, undefined])))}>
                  {t("clearFilters")}
                </button>
              )}
            </div>
          )}

          {noDataEver && project === undefined ? (
            <div className="card">
              <div className="empty-state">
                <Terminal size={32} />
                <h2>{t("noDataYet")}</h2>
                <p>{t("noDataYetHint")}</p>
                <button className="primary-button" onClick={() => openSettings("editors")}>
                  {t("setUpEditor")}
                </button>
              </div>
            </div>
          ) : !s ? (
            stats.error ? (
              <div className="card">
                <p className="error-text">{stats.error}</p>
                <button className="text-button" onClick={stats.reload}>
                  {t("retry")}
                </button>
              </div>
            ) : (
              <>
                <div className="skeleton" style={{ height: 96 }} />
                <div className="skeleton" style={{ height: 300 }} />
              </>
            )
          ) : (
            <>
              <Overview summary={s} previous={prev} />

              {goals && goals.length > 0 && activeFilters.length === 0 && <GoalStrip goals={goals} />}

              <section className="card">
                <div className="card-head">
                  <span className="card-title">
                    {chart?.granularity === "month" ? t("timePerMonth") : chart?.granularity === "week" ? t("timePerWeek") : t("timePerDay")}
                  </span>
                  <div className="segmented" role="group">
                    <button className={!table ? "active" : ""} onClick={() => setTable(false)} title={t("showChart")} aria-label={t("showChart")}>
                      <BarChart size={14} />
                    </button>
                    <button className={table ? "active" : ""} onClick={() => setTable(true)} title={t("showTable")} aria-label={t("showTable")}>
                      <Table size={14} />
                    </button>
                  </div>
                </div>
                {project === undefined && s.breakdowns.project.length > 1 && (
                  <Legend items={legendItems(s.breakdowns.project, series)} colorOf={projectColor} onPick={pick("project")} />
                )}
                {chart &&
                  (table ? (
                    <TimeTable buckets={chart.buckets} granularity={chart.granularity} />
                  ) : (
                    <TimeChart
                      buckets={chart.buckets}
                      granularity={chart.granularity}
                      series={series}
                      colorOf={projectColor}
                      onPick={(b) => setQuery({ range: undefined, from: b.from, to: b.to })}
                    />
                  ))}
              </section>

              <div className="grid">
                {project === undefined ? (
                  <Panel className="span-6" title={t("projects")}>
                    <Breakdown items={s.breakdowns.project} colorOf={projectColor} onPick={pick("project")} />
                  </Panel>
                ) : (
                  <Panel className="span-6" title={t("branches")}>
                    <Breakdown items={s.breakdowns.branch} onPick={pick("branch")} />
                  </Panel>
                )}
                <Panel className="span-6" title={t("languages")}>
                  <Breakdown items={s.breakdowns.language} colorOf={languageColor} onPick={pick("language")} />
                </Panel>
                <Panel className="span-4" title={t("editors")}>
                  <Breakdown items={s.breakdowns.editor} colorOf={editorColor} onPick={pick("editor")} limit={5} />
                </Panel>
                <Panel className="span-4" title={t("categories")}>
                  <Breakdown items={s.breakdowns.category} onPick={pick("category")} limit={5} />
                </Panel>
                <Panel className="span-4" title={t("operatingSystems")}>
                  <Breakdown items={s.breakdowns.operatingSystem} onPick={pick("operatingSystem")} limit={5} />
                </Panel>
                <Panel className="span-6" title={t("machines")}>
                  <Breakdown items={s.breakdowns.machine} onPick={pick("machine")} limit={5} />
                </Panel>
                {project === undefined ? (
                  <Panel className="span-6" title={t("branches")}>
                    <Breakdown items={s.breakdowns.branch} onPick={pick("branch")} limit={5} />
                  </Panel>
                ) : (
                  <Panel className="span-6" title={t("files")}>
                    <FileList files={files} project={project} />
                  </Panel>
                )}
              </div>

              {heat && (
                <section className="card">
                  <div className="card-head">
                    <span className="card-title">{t("activity")}</span>
                    <span className="card-hint">{t("activityHint", { total: f.duration(heat.reduce((sum, d) => sum + d.seconds, 0)) })}</span>
                  </div>
                  <Heatmap days={heat} weekStart={me.weekStart} onPick={(day) => setQuery({ range: undefined, from: day, to: day })} />
                </section>
              )}

              {rhythm && s.total > 0 && (
                <section className="card">
                  <div className="card-head">
                    <span className="card-title">{t("rhythm")}</span>
                    <span className="card-hint">{t("rhythmHint")}</span>
                  </div>
                  <RhythmGrid grid={rhythm} weekStart={me.weekStart} />
                </section>
              )}
            </>
          )}
        </div>
      </div>
      {renaming && project !== undefined && <RenameDialog project={project} onClose={() => setRenaming(false)} />}
    </>
  );
}

function Panel({ title, className, children }: { title: string; className: string; children: React.ReactNode }) {
  return (
    <section className={`card ${className}`}>
      <div className="card-head">
        <span className="card-title">{title}</span>
      </div>
      {children}
    </section>
  );
}

/** Coloured projects with their totals, then everything else as one "Other" entry. */
function legendItems(items: Item[], series: string[]) {
  const shown = items.filter((i) => series.includes(i.name));
  const other = items.filter((i) => !series.includes(i.name)).reduce((sum, i) => sum + i.seconds, 0);
  shown.sort((a, b) => series.indexOf(a.name) - series.indexOf(b.name));
  return other > 0 ? [...shown, { name: "\0other", seconds: other }] : shown;
}

function Overview({ summary, previous }: { summary: Summary; previous: Summary | undefined }) {
  const { t, f } = useSettings();
  const elapsed = summary.days.length || 1;
  const active = summary.days.filter((d) => d.total > 0);
  const best = summary.days.reduce((a, b) => (b.total > a.total ? b : a), summary.days[0]);
  const delta = previous && previous.total > 0 ? (summary.total - previous.total) / previous.total : null;

  return (
    <section className="overview">
      <div>
        <div className="hero-label">{t("codingTime")}</div>
        <div className="hero-number">{f.duration(summary.total)}</div>
        <div className="hero-delta">
          {delta === null ? (
            previous ? t("noPrevious") : " "
          ) : (
            <span>
              <span className={delta >= 0 ? "delta-up" : "delta-down"}>
                {delta >= 0 ? "▲" : "▼"} {f.percent(Math.abs(delta))}
              </span>{" "}
              {t("vsPrevious")}
            </span>
          )}
        </div>
      </div>
      {summary.days.length > 1 && (
        <>
          <div className="stat">
            <span className="stat-label">{t("dailyAverage")}</span>
            <span className="stat-value">{f.duration(summary.total / elapsed)}</span>
            <span className="stat-sub">
              {active.length ? `${f.duration(summary.total / active.length)} / ${t("activeDays").toLowerCase()}` : " "}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">{t("activeDays")}</span>
            <span className="stat-value">
              {active.length} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>/ {summary.days.length}</span>
            </span>
            <span className="stat-sub">{f.percent(active.length / elapsed)}</span>
          </div>
          {best && best.total > 0 && (
            <div className="stat">
              <span className="stat-label">{t("bestDay")}</span>
              <span className="stat-value">{f.duration(best.total)}</span>
              <span className="stat-sub">{f.longDate(best.date)}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function GoalStrip({ goals }: { goals: Goal[] }) {
  const { t, f } = useSettings();
  const { navigate } = useApp();
  return (
    <section className="card" style={{ cursor: "pointer" }} onClick={() => navigate({ name: "goals" })}>
      <div className="card-head">
        <span className="card-title">{t("goals")}</span>
      </div>
      <div className="grid" style={{ gap: 12 }}>
        {goals.slice(0, 3).map((g) => (
          <div key={g.id} className="goal-row span-4">
            <div className="goal-row-head">
              <span>
                {g.value ?? t("goalScopeAll")} · <span className="muted">{g.period === "day" ? t("perDay") : t("perWeek")}</span>
              </span>
              <span className="muted tabular">{t("goalProgress", { current: f.duration(g.current), target: f.duration(g.seconds) })}</span>
            </div>
            <div className="meter" role="progressbar" aria-valuenow={Math.round((g.current / g.seconds) * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="meter-fill" style={{ width: `${Math.min(100, (g.current / g.seconds) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FileList({ files, project }: { files: Item[] | undefined; project: string }) {
  const { t, f } = useSettings();
  const [all, setAll] = useState(false);
  if (!files) return <div className="skeleton" style={{ height: 120 }} />;
  if (files.length === 0) return <p className="empty-card">{t("noData")}</p>;
  // Show paths from the project folder on when it's in there.
  const short = (path: string) => {
    const norm = path.replace(/\\/g, "/");
    const i = project ? norm.toLowerCase().lastIndexOf(`/${project.toLowerCase()}/`) : -1;
    return i >= 0 ? norm.slice(i + project.length + 2) : norm;
  };
  const shown = all ? files : files.slice(0, 10);
  return (
    <div className="file-list">
      {shown.map((file) => {
        const p = short(file.name);
        const slash = p.lastIndexOf("/");
        return (
          <div key={file.name} className="file-row" title={file.name}>
            <span className="file-path">
              <bdi>
                {slash >= 0 && <span className="dir">{p.slice(0, slash + 1)}</span>}
                {p.slice(slash + 1)}
              </bdi>
            </span>
            <span className="breakdown-value">
              <b>{f.duration(file.seconds)}</b>
            </span>
          </div>
        );
      })}
      {files.length > 10 && (
        <button className="link-button breakdown-more" onClick={() => setAll((a) => !a)}>
          {all ? t("showLess") : t("showAll", { n: files.length })}
        </button>
      )}
    </div>
  );
}

function RenameDialog({ project, onClose }: { project: string; onClose: () => void }) {
  const { t } = useSettings();
  const { navigate, reloadProjects, projects, query } = useApp();
  const toast = useToast();
  const [name, setName] = useState(project);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={t("renameProject")} onClose={onClose}>
      <p className="dialog-text">{t("renameHint")}</p>
      <form
        className="dialog-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api(`/app/projects/${encodeURIComponent(project)}/rename`, { body: { to: name.trim() } });
            invalidate("/app/");
            reloadProjects();
            toast(t("projectRenamed"));
            onClose();
            navigate({ name: "project", project: name.trim() }, query);
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <label className="field">
          {t("newName")}
          <input className="text-field" value={name} onChange={(e) => setName(e.target.value)} list="project-names" autoFocus />
          <datalist id="project-names">
            {projects?.filter((p) => p.name && p.name !== project).map((p) => <option key={p.name} value={p.name} />)}
          </datalist>
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="text-button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="primary-button" disabled={busy || !name.trim() || name.trim() === project}>
            {t("save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
