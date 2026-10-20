import { useMemo, useState, type CSSProperties } from "react";
import { useApp } from "../lib/app";
import { useSettings } from "../lib/settings";
import { Folder, Search } from "./icons";
import { Toolbar } from "./Toolbar";

type SortKey = "name" | "lastDay" | "recent" | "seconds";

export function ProjectsPage() {
  const { t, f } = useSettings();
  const { projects, navigate, projectColor } = useApp();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "lastDay", desc: true });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (projects ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
    const dir = sort.desc ? -1 : 1;
    return [...list].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const cmp = typeof av === "number" ? av - (bv as number) : String(av).localeCompare(String(bv));
      return cmp * dir || b.seconds - a.seconds;
    });
  }, [projects, search, sort]);

  const header = (key: SortKey, label: string, className = "") => (
    <th
      className={className}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))}
      aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}
    >
      {label} {sort.key === key ? (sort.desc ? "↓" : "↑") : ""}
    </th>
  );

  return (
    <>
      <Toolbar title={t("projects")}>
        <div className="search-field">
          <Search size={14} />
          <input className="text-field" placeholder={t("searchProjects")} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t("searchProjects")} />
        </div>
      </Toolbar>
      <div className="content">
        <div className="page">
          {!projects ? (
            <div className="skeleton" style={{ height: 320 }} />
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <Folder size={32} />
              <p>{t("noProjects")}</p>
            </div>
          ) : (
            <table className="project-table">
              <thead>
                <tr>
                  {header("name", t("project"))}
                  {header("lastDay", t("lastActive"), "hide-mobile")}
                  {header("recent", t("last30Short"), "num")}
                  {header("seconds", t("totalTime"), "num")}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.name} onClick={() => navigate({ name: "project", project: p.name }, { range: "all_time" })}>
                    <td>
                      <span className="project-name">
                        <span className="project-dot" style={{ "--c": projectColor(p.name) } as CSSProperties} />
                        <span>{p.name || t("unknown")}</span>
                      </span>
                    </td>
                    <td className="hide-mobile muted">{f.mediumDate(p.lastDay)}</td>
                    <td className="num muted">{p.recent > 0 ? f.duration(p.recent) : "—"}</td>
                    <td className="num">{f.duration(p.seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
