// Ctrl+K / "/": the same command palette as Calendar's and Notes'. Jumps to a project, a page,
// a settings page, or filters by a language / editor seen in the last year.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Summary } from "../lib/api";
import { useApp, type SettingsPage } from "../lib/app";
import { languageColor } from "../lib/colors";
import { useApi } from "../lib/hooks";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { Folder, Gear, Home, Search, Target } from "./icons";

interface Result {
  key: string;
  section: StringKey;
  title: string;
  extra?: string;
  icon: ReactNode;
  run: () => void;
}

const SETTINGS: { id: SettingsPage; label: StringKey }[] = [
  { id: "profile", label: "profile" },
  { id: "preferences", label: "preferences" },
  { id: "security", label: "security" },
  { id: "editors", label: "editorsAndKeys" },
  { id: "data", label: "data" },
  { id: "sharing", label: "sharing" },
  { id: "reports", label: "reports" },
  { id: "statistics", label: "statistics" },
  { id: "shortcuts", label: "shortcuts" },
];

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const { t, f } = useSettings();
  const { projects, projectColor, navigate, openSettings, query: current } = useApp();
  const year = useApi<Summary>("/app/stats?range=last_12_months").data;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();

  const results = useMemo(() => {
    const keep = (title: string) => !q || title.toLowerCase().includes(q);
    const done = (fn: () => void) => () => {
      onClose();
      fn();
    };
    const out: Result[] = [];
    const pages: [StringKey, ReactNode, () => void][] = [
      ["dashboard", <Home size={16} />, () => navigate({ name: "dashboard" })],
      ["projects", <Folder size={16} />, () => navigate({ name: "projects" })],
      ["goals", <Target size={16} />, () => navigate({ name: "goals" })],
    ];
    for (const [label, icon, run] of pages) if (keep(t(label))) out.push({ key: `page:${label}`, section: "pages", title: t(label), icon, run: done(run) });
    for (const p of (projects ?? []).filter((p) => p.name && keep(p.name)).slice(0, q ? 20 : 6)) {
      out.push({
        key: `project:${p.name}`,
        section: "projects",
        title: p.name,
        extra: `${f.duration(p.seconds)} · ${f.mediumDate(p.lastDay)}`,
        icon: <span className="project-dot" style={{ "--c": projectColor(p.name) } as CSSProperties} />,
        run: done(() => navigate({ name: "project", project: p.name })),
      });
    }
    if (q) {
      for (const l of (year?.breakdowns.language ?? []).filter((l) => l.name && keep(l.name)).slice(0, 8)) {
        out.push({
          key: `language:${l.name}`,
          section: "languages",
          title: l.name,
          extra: f.duration(l.seconds),
          icon: <span className="project-dot" style={{ "--c": languageColor(l.name) } as CSSProperties} />,
          run: done(() => navigate({ name: "dashboard" }, { ...pickRange(current), language: l.name })),
        });
      }
      for (const s of SETTINGS.filter((s) => keep(t(s.label)))) {
        out.push({ key: `settings:${s.id}`, section: "settings", title: t(s.label), icon: <Gear size={16} />, run: done(() => openSettings(s.id)) });
      }
    }
    return out;
  }, [q, projects, year, t, f, navigate, openSettings, projectColor, onClose, current]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(".search-result.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let lastSection: StringKey | null = null;
  return (
    <div className="dialog-backdrop search-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-dialog" role="dialog" aria-label={t("search")}>
        <div className="search-input-row">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            placeholder={t("searchPlaceholder")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") setActive((i) => Math.min(results.length - 1, i + 1));
              else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
              else if (e.key === "Enter" && results[active]) results[active].run();
              else return;
              e.preventDefault();
              e.stopPropagation();
            }}
          />
        </div>
        <div className="search-results" ref={listRef}>
          {results.length === 0 && <p className="search-empty">{t("noResults")}</p>}
          {results.map((r, i) => {
            const header = r.section !== lastSection ? <div className="search-section">{t(r.section)}</div> : null;
            lastSection = r.section;
            return (
              <div key={r.key}>
                {header}
                <button className={`search-result${i === active ? " active" : ""}`} onMouseEnter={() => setActive(i)} onClick={r.run}>
                  <span className="search-result-icon">{r.icon}</span>
                  <span className="search-result-text">
                    <span className="search-result-title">{r.title}</span>
                  </span>
                  {r.extra && <span className="search-result-when">{r.extra}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function pickRange(q: Record<string, string>) {
  return Object.fromEntries(Object.entries(q).filter(([k]) => k === "range" || k === "from" || k === "to"));
}
