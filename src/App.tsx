import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Me, type ProjectRow, type ServerInfo } from "./lib/api";
import { AppContext, type AppContextValue, type SettingsPage } from "./lib/app";
import { projectPalette } from "./lib/colors";
import { MOBILE_QUERY, invalidate, useApi, useMediaQuery } from "./lib/hooks";
import { shiftRange } from "./lib/range";
import { useRouter } from "./lib/router";
import { SettingsProvider, useSettings } from "./lib/settings";
import { ToastProvider } from "./components/common";
import { Sidebar } from "./components/Sidebar";
import { SignIn } from "./components/SignIn";
import { Dashboard } from "./components/Dashboard";
import { ProjectsPage } from "./components/ProjectsPage";
import { GoalsPage } from "./components/GoalsPage";
import { PublicProfile } from "./components/PublicProfile";
import { SettingsDialog } from "./components/SettingsDialog";
import { FilterPanel } from "./components/FilterPanel";
import { SearchDialog } from "./components/SearchDialog";

export default function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </SettingsProvider>
  );
}

function Root() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  // Set by the server when single sign-on fails (it redirects back with ?signin_error=…).
  const [signinError] = useState(() => new URLSearchParams(location.search).get("signin_error"));

  const loadMe = useCallback(() => {
    api<Me>("/auth/me").then(setMe, (e) => (e instanceof ApiError && e.status === 401 ? setMe(null) : setMe(null)));
  }, []);

  useEffect(() => {
    if (router.route.name === "profile") return;
    loadMe();
  }, [loadMe, router.route.name]);

  useEffect(() => {
    if (signinError) router.setQuery({ signin_error: undefined }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any API call answering 401 means the session ended (expired, signed out elsewhere).
  useEffect(() => {
    const onSignedOut = () => setMe(null);
    window.addEventListener("devtime:signed-out", onSignedOut);
    return () => window.removeEventListener("devtime:signed-out", onSignedOut);
  }, []);

  if (router.route.name === "profile") return <PublicProfile user={router.route.user} />;
  if (me === undefined) return <div className="splash" />;
  if (me === null) return <SignIn error={signinError} onSignedIn={loadMe} />;
  return <Shell me={me} setMe={setMe} router={router} onSignedOut={() => setMe(null)} />;
}

function Shell({ me, setMe, router, onSignedOut }: { me: Me; setMe: (me: Me) => void; router: ReturnType<typeof useRouter>; onSignedOut: () => void }) {
  const { settings, update, dark, lang } = useSettings();
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [drawer, setDrawer] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(() => {
    const p = new URLSearchParams(location.search).get("settings");
    return p ? (p as SettingsPage) : null;
  });
  const server = useApi<ServerInfo>("/app/server").data;
  const projectsReq = useApi<ProjectRow[]>("/app/projects", true);

  useEffect(() => {
    if (new URLSearchParams(location.search).has("settings")) router.setQuery({ settings: undefined }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The weekly email is written in the language the app uses.
  useEffect(() => {
    void api("/app/profile", { method: "PATCH", body: { language: lang } }).catch(() => {});
  }, [lang]);

  // Colours follow all-time rank, so a project keeps its colour across ranges and filters.
  const rankedProjects = useMemo(
    () => [...(projectsReq.data ?? [])].sort((a, b) => b.seconds - a.seconds).map((p) => p.name),
    [projectsReq.data],
  );
  const palette = useMemo(() => projectPalette(rankedProjects, dark), [rankedProjects, dark]);

  // Close the drawers when navigating on phones.
  useEffect(() => {
    setDrawer(false);
    setMobilePanel(false);
  }, [router.route]);

  const r = router.route;
  const ranged = r.name === "dashboard" || r.name === "project";
  const sidebarVisible = mobile ? drawer : settings.sidebar;
  const panelVisible = ranged && (mobile ? mobilePanel : settings.panel);
  const toggleSidebar = () => (mobile ? setDrawer((d) => !d) : update({ sidebar: !settings.sidebar }));
  const togglePanel = () => (mobile ? setMobilePanel((p) => !p) : update({ panel: !settings.panel }));

  const value: AppContextValue = {
    me,
    setMe,
    server,
    route: r,
    query: router.query,
    navigate: router.navigate,
    setQuery: router.setQuery,
    projects: projectsReq.data,
    reloadProjects: () => {
      invalidate("/app/");
      projectsReq.reload();
    },
    projectColor: (name) => palette.get(name) ?? "var(--text-faint)",
    rankedProjects: rankedProjects.slice(0, 8),
    openSettings: (page) => setSettingsPage(page ?? "profile"),
    signOut: () => {
      void api("/auth/logout", { method: "POST" }).finally(() => {
        invalidate();
        onSignedOut();
      });
    },
    sidebarVisible,
    toggleSidebar,
    panelVisible,
    togglePanel,
    openSearch: () => setSearchOpen(true),
  };

  // The same keys as Calendar and Notes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = !!target.closest?.("input, textarea, select, [contenteditable]");
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      if (ctrl && !e.altKey && !e.shiftKey && (k === "b" || k === "\\")) {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (ctrl && !e.altKey && k === "k") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (ctrl && !e.altKey && e.key === ",") {
        e.preventDefault();
        setSettingsPage((p) => p ?? "profile");
        return;
      }
      if (ctrl && !e.altKey && k === "." && ranged) {
        e.preventDefault();
        togglePanel();
        return;
      }

      // Single keys: not while typing, in a dialog, or with modifiers.
      if (ctrl || e.altKey || inField || settingsPage || searchOpen) return;
      if (document.querySelector(".dialog-backdrop, .picker")) return;
      const range = (id: string) => router.setQuery({ range: id, from: undefined, to: undefined });
      const shift = (dir: 1 | -1) => {
        const next = shiftRange(router.query, me, dir);
        if (next) router.setQuery({ range: undefined, ...next });
      };

      if (k === "\\") toggleSidebar();
      else if (k === "/") setSearchOpen(true);
      else if (k === "escape" && mobile && (drawer || mobilePanel)) {
        setDrawer(false);
        setMobilePanel(false);
      } else if (!ranged) return;
      else if (k === ".") togglePanel();
      else if (k === "t") range("today");
      else if (k === "j" || k === "n" || k === "arrowright") shift(1);
      else if (k === "k" || k === "p" || k === "arrowleft") shift(-1);
      else if (k === "w") range("week");
      else if (k === "m") range("month");
      else if (k === "y") range("year");
      else if (k === "a") range("all_time");
      else if (k === "7") range("last_7_days");
      else if (k === "3") range("last_30_days");
      else if (k === "1") range("last_12_months");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <AppContext.Provider value={value}>
      <div className="app">
        {sidebarVisible && (
          <>
            {mobile && <div className="sidebar-backdrop" onClick={() => setDrawer(false)} />}
            <Sidebar />
          </>
        )}
        <main className="main">
          {r.name === "projects" ? <ProjectsPage /> : r.name === "project" ? <Dashboard project={r.project} /> : r.name === "goals" ? <GoalsPage /> : <Dashboard />}
        </main>
        {panelVisible && (
          <>
            {mobile && <div className="sidebar-backdrop" onClick={() => setMobilePanel(false)} />}
            <FilterPanel project={r.name === "project" ? r.project : undefined} />
          </>
        )}
      </div>
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
      {settingsPage && <SettingsDialog page={settingsPage} onClose={() => setSettingsPage(null)} />}
    </AppContext.Provider>
  );
}
