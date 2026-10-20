// What every page of the signed-in app can reach: the user, navigation, project colours, settings.

import { createContext, useContext } from "react";
import type { Me, ProjectRow, ServerInfo } from "./api";
import type { Route } from "./router";

export type SettingsPage =
  | "profile"
  | "preferences"
  | "security"
  | "editors"
  | "data"
  | "sharing"
  | "reports"
  | "statistics"
  | "shortcuts"
  | "users"
  | "about";

export interface AppContextValue {
  me: Me;
  setMe: (me: Me) => void;
  server: ServerInfo | undefined;
  route: Route;
  query: Record<string, string>;
  navigate: (route: Route, query?: Record<string, string>) => void;
  setQuery: (patch: Record<string, string | undefined>, replace?: boolean) => void;
  /** All projects, most recently active first. */
  projects: ProjectRow[] | undefined;
  reloadProjects: () => void;
  projectColor: (name: string) => string;
  /** Projects in colour-slot order (all-time rank), for stacking. */
  rankedProjects: string[];
  openSettings: (page?: SettingsPage) => void;
  signOut: () => void;
  sidebarVisible: boolean;
  toggleSidebar: () => void;
  /** The filters panel on the right (dashboard and project pages). */
  panelVisible: boolean;
  togglePanel: () => void;
  openSearch: () => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error("useApp outside the app");
  return v;
}
