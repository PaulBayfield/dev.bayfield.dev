// Address-bar routing: the path picks the page, the query string holds the range and filters,
// so every view can be bookmarked and shared.

import { useCallback, useEffect, useState } from "react";

export type Route =
  | { name: "dashboard" }
  | { name: "projects" }
  | { name: "project"; project: string }
  | { name: "goals" }
  | { name: "profile"; user: string };

export function parseRoute(path: string): Route {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/").map(decodeURIComponent);
  if (parts[0] === "projects" && parts[1] !== undefined) return { name: "project", project: parts.slice(1).join("/") };
  if (parts[0] === "projects") return { name: "projects" };
  if (parts[0] === "goals") return { name: "goals" };
  if (parts[0] === "u" && parts[1]) return { name: "profile", user: parts[1] };
  return { name: "dashboard" };
}

export function routePath(r: Route): string {
  switch (r.name) {
    case "projects":
      return "/projects";
    case "project":
      return `/projects/${encodeURIComponent(r.project)}`;
    case "goals":
      return "/goals";
    case "profile":
      return `/u/${encodeURIComponent(r.user)}`;
    default:
      return "/";
  }
}

const readQuery = () => Object.fromEntries(new URLSearchParams(location.search));

export function useRouter() {
  const [state, setState] = useState(() => ({ route: parseRoute(location.pathname), query: readQuery() }));

  useEffect(() => {
    const onPop = () => setState({ route: parseRoute(location.pathname), query: readQuery() });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** Goes to a page; the range carries over unless `query` says otherwise. */
  const navigate = useCallback((route: Route, query?: Record<string, string>) => {
    setState((s) => {
      const q = query ?? (s.query.range || s.query.from ? pick(s.query, ["range", "from", "to"]) : {});
      const search = new URLSearchParams(q).toString();
      history.pushState(null, "", routePath(route) + (search ? `?${search}` : ""));
      return { route, query: q };
    });
    document.querySelector(".content")?.scrollTo(0, 0);
  }, []);

  /** Changes the query string of the current page (range, filters) without a new history entry per keystroke. */
  const setQuery = useCallback((patch: Record<string, string | undefined>, replace = false) => {
    setState((s) => {
      const q = { ...s.query };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete q[k];
        else q[k] = v;
      }
      const search = new URLSearchParams(q).toString();
      history[replace ? "replaceState" : "pushState"](null, "", location.pathname + (search ? `?${search}` : ""));
      return { ...s, query: q };
    });
  }, []);

  return { route: state.route, query: state.query, navigate, setQuery };
}

function pick(q: Record<string, string>, keys: string[]) {
  return Object.fromEntries(Object.entries(q).filter(([k]) => keys.includes(k)));
}
