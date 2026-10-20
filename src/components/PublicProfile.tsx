import { useEffect, useMemo } from "react";
import type { Dimension, PublicProfile as Profile } from "../lib/api";
import { editorColor, languageColor } from "../lib/colors";
import { useApi } from "../lib/hooks";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { Breakdown, Heatmap, TimeChart, bucketize } from "./charts";
import { Avatar } from "./common";

const PANELS: { dim: Dimension; label: StringKey }[] = [
  { dim: "language", label: "languages" },
  { dim: "project", label: "projects" },
  { dim: "editor", label: "editors" },
  { dim: "operatingSystem", label: "operatingSystems" },
  { dim: "machine", label: "machines" },
];

export function PublicProfile({ user }: { user: string }) {
  const { t, f } = useSettings();
  const { data, error } = useApi<Profile>(`/public/users/${encodeURIComponent(user)}`);

  useEffect(() => {
    document.title = data ? `${data.name} · DevTime` : "DevTime";
  }, [data]);

  const chart = useMemo(
    () => (data?.daily ? bucketize(data.daily.map((d) => ({ date: d.date, total: d.total, projects: { [t("codingTime")]: d.total } })), 1) : null),
    [data, t],
  );

  return (
    <div className="public">
      <div className="page">
        {error ? (
          <div className="empty-state">
            <img src="/favicon.svg" alt="" width={56} height={56} />
            <p>{t("notShared")}</p>
          </div>
        ) : !data ? (
          <div className="skeleton" style={{ height: 300 }} />
        ) : (
          <>
            <header className="public-head">
              <Avatar name={data.name} size={48} />
              <div>
                <h1 style={{ fontSize: 22 }}>{t("publicTitle", { name: data.name })}</h1>
                <p className="muted small">{data.days ? t("publicRange", { n: data.days }) : t("allTime")}</p>
              </div>
            </header>
            <section className="overview">
              <div>
                <div className="hero-label">{t("codingTime")}</div>
                <div className="hero-number">{f.duration(data.total)}</div>
              </div>
              <div className="stat">
                <span className="stat-label">{t("dailyAverage")}</span>
                <span className="stat-value">{f.duration(data.total / Math.max(1, data.spanDays))}</span>
              </div>
            </section>
            {chart && (
              <section className="card">
                <div className="card-head">
                  <span className="card-title">{chart.granularity === "day" ? t("timePerDay") : t("timePerWeek")}</span>
                </div>
                <TimeChart buckets={chart.buckets} granularity={chart.granularity} series={[t("codingTime")]} colorOf={() => "var(--brand)"} />
              </section>
            )}
            <div className="grid">
              {PANELS.filter((p) => data.breakdowns[p.dim]).map((p) => (
                <section key={p.dim} className="card span-6">
                  <div className="card-head">
                    <span className="card-title">{t(p.label)}</span>
                  </div>
                  <Breakdown
                    items={data.breakdowns[p.dim]!}
                    colorOf={p.dim === "language" ? languageColor : p.dim === "editor" ? editorColor : undefined}
                    limit={6}
                  />
                </section>
              ))}
            </div>
            {data.activity && (
              <section className="card">
                <div className="card-head">
                  <span className="card-title">{t("activity")}</span>
                  <span className="card-hint">{t("activityHint", { total: f.duration(data.activity.reduce((s, d) => s + d.seconds, 0)) })}</span>
                </div>
                <Heatmap days={data.activity} weekStart={1} />
              </section>
            )}
            <p className="muted small" style={{ textAlign: "center" }}>
              {t("memberSince", { date: f.mediumDate(data.memberSince.slice(0, 10)) })}
            </p>
          </>
        )}
        <a className="public-footer" href="/">
          <img src="/favicon.svg" alt="" />
          {t("poweredBy")}
        </a>
      </div>
    </div>
  );
}
