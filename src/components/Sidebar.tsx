import { useRef, type CSSProperties } from "react";
import { useApp } from "../lib/app";
import { useSettings } from "../lib/settings";
import { Folder, Home, PanelLeft, Search, Target } from "./icons";

const MIN_W = 200;
const MAX_W = 480;
const DEFAULT_W = 248;

/** Same layout as Calendar's and Notes' sidebars: toggle and search on top, then the pages. */
export function Sidebar() {
  const { t, f, settings } = useSettings();
  const { route, navigate, projects, projectColor, toggleSidebar, openSearch } = useApp();
  const recent = (projects ?? []).filter((p) => p.name).slice(0, 12);

  return (
    <aside className="sidebar" style={{ "--sidebar-w": `${settings.sidebarWidth}px` } as CSSProperties}>
      <ResizeHandle />
      <div className="sidebar-top">
        <button className="icon-button" title={`${t("toggleSidebar")} (Ctrl+B)`} aria-label={t("toggleSidebar")} onClick={toggleSidebar}>
          <PanelLeft />
        </button>
        <div className="toolbar-spacer" />
        <button className="icon-button" title={`${t("search")} (Ctrl+K)`} aria-label={t("search")} onClick={openSearch}>
          <Search />
        </button>
      </div>

      <nav className="sidebar-nav">
        <button className={`sidebar-row${route.name === "dashboard" ? " active" : ""}`} onClick={() => navigate({ name: "dashboard" })}>
          <Home />
          <span className="row-label">{t("dashboard")}</span>
        </button>
        <button className={`sidebar-row${route.name === "projects" ? " active" : ""}`} onClick={() => navigate({ name: "projects" })}>
          <Folder />
          <span className="row-label">{t("projects")}</span>
        </button>
        <button className={`sidebar-row${route.name === "goals" ? " active" : ""}`} onClick={() => navigate({ name: "goals" })}>
          <Target />
          <span className="row-label">{t("goals")}</span>
        </button>
      </nav>

      {/* Only the project list scrolls; the header and pages stay put. */}
      <div className="sidebar-scroll">
        {recent.length > 0 && (
          <div className="sidebar-group">
            <div className="sidebar-group-title">{t("recentProjects")}</div>
            {recent.map((p) => (
              <button
                key={p.name}
                className={`sidebar-row${route.name === "project" && route.project === p.name ? " active" : ""}`}
                onClick={() => navigate({ name: "project", project: p.name })}
                title={p.name}
              >
                <span className="project-dot" style={{ "--c": projectColor(p.name) } as CSSProperties} />
                <span className="row-label">{p.name}</span>
                <span className="row-meta">{f.duration(p.recent, "short")}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

/** Drag the right edge to resize; double-click to reset. */
function ResizeHandle() {
  const { update } = useSettings();
  const drag = useRef<{ x: number; w: number; aside: HTMLElement } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(MAX_W, Math.max(MIN_W, w)));
  return (
    <div
      className="sidebar-resize"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const aside = e.currentTarget.parentElement!;
        drag.current = { x: e.clientX, w: aside.getBoundingClientRect().width, aside };
        e.currentTarget.setPointerCapture(e.pointerId);
        document.documentElement.classList.add("resizing-sidebar");
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) d.aside.style.setProperty("--sidebar-w", `${clamp(d.w + e.clientX - d.x)}px`);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        document.documentElement.classList.remove("resizing-sidebar");
        update({ sidebarWidth: clamp(d.w + e.clientX - d.x) });
      }}
      onDoubleClick={() => update({ sidebarWidth: DEFAULT_W })}
    />
  );
}
