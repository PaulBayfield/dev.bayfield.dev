import { useApi } from "../../lib/hooks";
import { useSettings } from "../../lib/settings";
import { PageHeader, Row } from "./common";

interface Statistics {
  you: {
    heartbeats: string;
    last24h: string;
    first: string | null;
    last: string | null;
    seconds: number;
    projects: number;
    languages: number;
    editors: number;
    machines: number;
    days: number;
    keys: number;
    sessions: number;
  };
  server: null | {
    users: number;
    activeUsers: number;
    heartbeats: string;
    last24h: string;
    lastHour: string;
    rollupRows: string;
    dbSize: string;
    heartbeatsSize: string;
    rollupSize: string;
    postgres: string;
    node: string;
    uptimeSeconds: number;
    memoryMb: number;
    version: string;
    perUser: { id: string; heartbeats: string; last: string | null }[];
  };
}

export function StatisticsPage() {
  const { t, f } = useSettings();
  const { data, error } = useApi<Statistics>("/app/statistics");
  const n = (v: string | number) => f.number(Number(v));
  const bytes = (v: string) => {
    const b = Number(v);
    return b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
  };
  const uptime = (s: number) => (s >= 86400 ? t("daysN", { n: Math.floor(s / 86400) }) : s >= 3600 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 60)} min`);
  // The relative part only while it says something the date doesn't ("3 h ago"); past a month it's the date again.
  const when = (d: string | null) =>
    !d ? "—" : Date.now() - Date.parse(d) < 30 * 86400_000 ? `${f.mediumDate(d.slice(0, 10))} · ${f.relative(d, t)}` : f.mediumDate(d.slice(0, 10));

  if (error) return <p className="error-text">{error}</p>;
  if (!data) return <div className="skeleton" style={{ height: 320 }} />;
  const { you, server } = data;

  return (
    <>
      <PageHeader title={t("statistics")} hint={t("statisticsHint")} />
      <section className="settings-rows">
        <h3>{t("yourData")}</h3>
        <Row label={t("heartbeatsLabel")} hint={t("heartbeatsHint")}>
          <span className="stat-cell">{n(you.heartbeats)}</span>
        </Row>
        <Row label={t("last24h")}>
          <span className="stat-cell">{n(you.last24h)}</span>
        </Row>
        <Row label={t("codingTime")}>
          <span className="stat-cell">{f.duration(you.seconds)}</span>
        </Row>
        <Row label={t("firstHeartbeat")}>
          <span className="stat-cell">{when(you.first)}</span>
        </Row>
        <Row label={t("lastHeartbeat")}>
          <span className="stat-cell">{when(you.last)}</span>
        </Row>
        <Row label={t("activeDays")}>
          <span className="stat-cell">{n(you.days)}</span>
        </Row>
        <Row label={`${t("projects")} · ${t("languages")} · ${t("editors")} · ${t("machines")}`}>
          <span className="stat-cell">
            {n(you.projects)} · {n(you.languages)} · {n(you.editors)} · {n(you.machines)}
          </span>
        </Row>
        <Row label={`${t("apiKeys")} · ${t("sessions")}`}>
          <span className="stat-cell">
            {n(you.keys)} · {n(you.sessions)}
          </span>
        </Row>
      </section>

      {server && (
        <>
          <section className="settings-rows">
            <h3>{t("serverStats")}</h3>
            <Row label={t("users")} hint={t("activeUsersHint", { n: server.activeUsers })}>
              <span className="stat-cell">{n(server.users)}</span>
            </Row>
            <Row label={t("heartbeatsLabel")}>
              <span className="stat-cell">{n(server.heartbeats)}</span>
            </Row>
            <Row label={t("last24h")} hint={t("lastHourHint", { n: n(server.lastHour) })}>
              <span className="stat-cell">{n(server.last24h)}</span>
            </Row>
            <Row label={t("rollupRows")} hint={t("rollupHint")}>
              <span className="stat-cell">{n(server.rollupRows)}</span>
            </Row>
            <Row label={t("databaseSize")} hint={t("databaseSizeHint", { heartbeats: bytes(server.heartbeatsSize), rollup: bytes(server.rollupSize) })}>
              <span className="stat-cell">{bytes(server.dbSize)}</span>
            </Row>
            <Row label={t("runtime")} hint={`PostgreSQL ${server.postgres} · Node ${server.node} · ${server.memoryMb} MB`}>
              <span className="stat-cell">{t("upFor", { time: uptime(server.uptimeSeconds) })}</span>
            </Row>
          </section>
          <section>
            <h3>{t("heartbeatsPerUser")}</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("username")}</th>
                  <th className="num">{t("heartbeatsLabel")}</th>
                  <th className="num">{t("lastHeartbeat")}</th>
                </tr>
              </thead>
              <tbody>
                {server.perUser.map((u) => (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td className="num">{n(u.heartbeats)}</td>
                    <td className="num muted">{u.last ? f.relative(u.last, t) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
