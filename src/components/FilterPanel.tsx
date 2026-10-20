// The side panel on the right (like Calendar's event panel): every value of every dimension in the
// current range, to filter the page by. Toggled with "." or the button at the end of the toolbar.

import { useState, type CSSProperties } from "react";
import { query as qs, type Dimension, type Summary } from "../lib/api";
import { useApp } from "../lib/app";
import { editorColor, languageColor } from "../lib/colors";
import { useApi } from "../lib/hooks";
import { filtersOf, rangeParams } from "../lib/range";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { Check, Search, X } from "./icons";

const SECTIONS: { dim: Dimension; label: StringKey }[] = [
  { dim: "project", label: "projects" },
  { dim: "language", label: "languages" },
  { dim: "editor", label: "editors" },
  { dim: "category", label: "categories" },
  { dim: "branch", label: "branches" },
  { dim: "operatingSystem", label: "operatingSystems" },
  { dim: "machine", label: "machines" },
];

const LIMIT = 6;

export function FilterPanel({ project }: { project?: string }) {
  const { t } = useSettings();
  const { query, setQuery, togglePanel } = useApp();
  // Values come from the whole range (on a project page, that project), not narrowed by the other
  // filters: picking a language shouldn't hide the other languages you might switch to.
  const base = { ...rangeParams(query), ...(project !== undefined ? { project } : {}) };
  const { data } = useApi<Summary>(`/app/stats${qs(base)}`);
  const active = filtersOf(query);
  const activeDims = (Object.keys(active) as Dimension[]).filter((d) => !(project !== undefined && d === "project"));

  return (
    <aside className="panel">
      <div className="panel-header">
        <span className="panel-label">{t("filters")}</span>
        <div className="toolbar-spacer" />
        {activeDims.length > 0 && (
          <button className="link-button" onClick={() => setQuery(Object.fromEntries(activeDims.map((d) => [d, undefined])))}>
            {t("clearFilters")}
          </button>
        )}
        <button className="icon-button" aria-label={t("close")} title={`${t("close")} (.)`} onClick={togglePanel}>
          <X />
        </button>
      </div>
      <div className="panel-body">
        {!data ? (
          <div className="skeleton" style={{ height: 240 }} />
        ) : (
          SECTIONS.filter((s) => !(project !== undefined && s.dim === "project")).map((s) => (
            <FilterSection
              key={s.dim}
              dim={s.dim}
              title={t(s.label)}
              items={data.breakdowns[s.dim]}
              value={active[s.dim]}
              onChange={(v) => setQuery({ [s.dim]: v })}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function FilterSection({
  dim,
  title,
  items,
  value,
  onChange,
}: {
  dim: Dimension;
  title: string;
  items: { name: string; seconds: number }[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const { t, f } = useSettings();
  const { projectColor } = useApp();
  const [all, setAll] = useState(false);
  const [search, setSearch] = useState("");
  if (items.length === 0) return null;
  const colorOf = dim === "project" ? projectColor : dim === "language" ? languageColor : dim === "editor" ? editorColor : null;
  const q = search.trim().toLowerCase();
  const matching = q ? items.filter((i) => (i.name || t("unknown")).toLowerCase().includes(q)) : items;
  // The active value stays visible even past the limit.
  let shown = all || q ? matching : matching.slice(0, LIMIT);
  if (value !== undefined && !shown.some((i) => i.name === value)) {
    const hit = items.find((i) => i.name === value);
    if (hit) shown = [hit, ...shown];
  }

  return (
    <section className="panel-section">
      <div className="panel-subtitle">{title}</div>
      {items.length > LIMIT && (
        <div className="search-field small">
          <Search size={13} />
          <input className="text-field" placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={`${t("search")}: ${title}`} />
        </div>
      )}
      <div className="filter-options">
        {shown.map((i) => {
          const on = value === i.name;
          return (
            <button key={i.name} className={`filter-option${on ? " active" : ""}`} aria-pressed={on} onClick={() => onChange(on ? undefined : i.name)}>
              {colorOf ? <span className="project-dot" style={{ "--c": colorOf(i.name) } as CSSProperties} /> : <span className="filter-check">{on && <Check size={12} />}</span>}
              <span className="filter-name">{i.name || t("unknown")}</span>
              <span className="filter-time">{f.duration(i.seconds, "short")}</span>
            </button>
          );
        })}
      </div>
      {!q && matching.length > LIMIT && (
        <button className="link-button" style={{ alignSelf: "flex-start" }} onClick={() => setAll((a) => !a)}>
          {all ? t("showLess") : t("showAll", { n: matching.length })}
        </button>
      )}
    </section>
  );
}
