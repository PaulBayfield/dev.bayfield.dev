// The weekly email: last week's coding time, compared with the week before.
// Sent on the first day of the user's week, from 8:00 their time, when SMTP_URL is set.

import nodemailer from "nodemailer";
import { sql } from "./db.ts";
import { PUBLIC_URL, mail } from "./config.ts";
import { goalProgress, listGoals } from "./goals.ts";
import { addDays, localDate, startOfWeek, summary } from "./stats.ts";
import type { User } from "./users.ts";

const transport = mail ? nodemailer.createTransport(mail.url) : null;

const STRINGS = {
  en: {
    subject: "Your week in code: {total}",
    title: "Your week in code",
    total: "Total",
    average: "Daily average",
    bestDay: "Best day",
    vsLast: "{delta} vs the week before",
    projects: "Projects",
    languages: "Languages",
    goals: "Goals",
    goalMet: "met",
    goalMissed: "missed",
    nothing: "No coding time recorded last week.",
    open: "Open DevTime",
    footer: "You get this because weekly reports are on in DevTime's settings.",
    test: "(test)",
    allCoding: "All coding",
    perDay: "/day",
    perWeek: "/week",
  },
  fr: {
    subject: "Votre semaine de code : {total}",
    title: "Votre semaine de code",
    total: "Total",
    average: "Moyenne par jour",
    bestDay: "Meilleur jour",
    vsLast: "{delta} par rapport à la semaine précédente",
    projects: "Projets",
    languages: "Langages",
    goals: "Objectifs",
    goalMet: "atteint",
    goalMissed: "manqué",
    nothing: "Aucun temps de code enregistré la semaine dernière.",
    open: "Ouvrir DevTime",
    footer: "Vous recevez cet e-mail car les rapports hebdomadaires sont activés dans les réglages de DevTime.",
    test: "(test)",
    allCoding: "Tout le code",
    perDay: "/jour",
    perWeek: "/sem.",
  },
};

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function bars(title: string, items: { name: string; seconds: number }[], total: number) {
  if (!items.length) return "";
  const rows = items
    .slice(0, 5)
    .map((i) => {
      const pct = total ? Math.max(2, Math.round((i.seconds / total) * 100)) : 0;
      return `<tr>
        <td style="padding:4px 12px 4px 0;font-size:14px;color:#37352f;white-space:nowrap">${esc(i.name || "Unknown")}</td>
        <td style="padding:4px 0;width:100%"><div style="height:8px;border-radius:4px;background:#2f9e74;width:${pct}%"></div></td>
        <td style="padding:4px 0 4px 12px;font-size:13px;color:#787774;white-space:nowrap;text-align:right">${formatDuration(i.seconds)}</td>
      </tr>`;
    })
    .join("");
  return `<h3 style="margin:24px 0 8px;font-size:13px;color:#787774;font-weight:600">${title}</h3><table style="width:100%;border-collapse:collapse">${rows}</table>`;
}

export async function sendWeeklyReport(user: User, opts: { test?: boolean } = {}) {
  if (!transport || !mail || !user.email) return;
  const t = STRINGS[user.language] ?? STRINGS.en;
  const thisWeek = startOfWeek(localDate(user.timezone), user.weekStart);
  const from = addDays(thisWeek, -7);
  const [week, before, goals] = await Promise.all([
    summary(user, from, thisWeek, {}),
    summary(user, addDays(from, -7), from, {}),
    listGoals(user.id).then((list) => Promise.all(list.map((g) => goalProgress(user, g)))),
  ]);

  const locale = user.language === "fr" ? "fr-FR" : "en-GB";
  const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { weekday: "long", timeZone: "UTC" });
  const best = week.days.reduce((a, b) => (b.total > a.total ? b : a), week.days[0]);
  const deltaPct = before.total > 0 ? Math.round(((week.total - before.total) / before.total) * 100) : null;
  const total = formatDuration(week.total);

  const stat = (label: string, value: string, sub = "") =>
    `<td style="padding:0 16px 0 0;vertical-align:top">
      <div style="font-size:12px;color:#787774">${label}</div>
      <div style="font-size:20px;font-weight:600;color:#37352f">${value}</div>
      ${sub ? `<div style="font-size:12px;color:#787774">${sub}</div>` : ""}
    </td>`;

  // A weekly goal's last finished week is the one before the current; a daily goal's are the last 7 days.
  const goalRows = goals
    .map((g) => {
      const name = g.dimension ? `${g.value}` : t.allCoding;
      const hit =
        g.period === "week"
          ? (g.history.at(-2)?.seconds ?? 0) >= g.seconds
          : g.history.slice(-8, -1).filter((h) => h.counts && h.seconds >= g.seconds).length;
      const label = typeof hit === "boolean" ? (hit ? t.goalMet : t.goalMissed) : `${hit} / ${g.history.slice(-8, -1).filter((h) => h.counts).length}`;
      return `<tr><td style="padding:3px 0;font-size:14px;color:#37352f">${esc(name)} · ${formatDuration(g.seconds)}${g.period === "day" ? t.perDay : t.perWeek}</td><td style="text-align:right;font-size:13px;color:#787774">${label}</td></tr>`;
    })
    .join("");

  const html = `<!doctype html><html><body style="margin:0;background:#f8f8f7;font-family:Inter,'Segoe UI',system-ui,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e3e2e0">
      <img src="${PUBLIC_URL}/apple-touch-icon.png" width="40" height="40" alt="" style="border-radius:9px">
      <h1 style="margin:16px 0 4px;font-size:22px;color:#37352f">${t.title} ${opts.test ? t.test : ""}</h1>
      <p style="margin:0 0 20px;font-size:13px;color:#787774">${from} → ${addDays(thisWeek, -1)}</p>
      ${
        week.total === 0
          ? `<p style="font-size:14px;color:#37352f">${t.nothing}</p>`
          : `<table style="border-collapse:collapse"><tr>
              ${stat(t.total, total, deltaPct === null ? "" : t.vsLast.replace("{delta}", `${deltaPct >= 0 ? "+" : ""}${deltaPct}%`))}
              ${stat(t.average, formatDuration(week.total / 7))}
              ${stat(t.bestDay, dayName(best.date), formatDuration(best.total))}
            </tr></table>
            ${bars(t.projects, week.breakdowns.project, week.total)}
            ${bars(t.languages, week.breakdowns.language, week.total)}
            ${goalRows ? `<h3 style="margin:24px 0 8px;font-size:13px;color:#787774;font-weight:600">${t.goals}</h3><table style="width:100%">${goalRows}</table>` : ""}`
      }
      <p style="margin:28px 0 0"><a href="${PUBLIC_URL}/?range=last_week" style="display:inline-block;background:#2f9e74;color:#fff;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:14px;font-weight:500">${t.open}</a></p>
    </div>
    <p style="font-size:12px;color:#a5a4a1;text-align:center;margin-top:16px">${t.footer}</p>
  </div></body></html>`;

  await transport.sendMail({
    from: mail.from,
    to: user.email,
    subject: t.subject.replace("{total}", total),
    html,
    text: `${t.title}\n${from} → ${addDays(thisWeek, -1)}\n\n${t.total}: ${total}\n${week.breakdowns.project
      .slice(0, 5)
      .map((p) => `- ${p.name || "Unknown"}: ${formatDuration(p.seconds)}`)
      .join("\n")}\n\n${PUBLIC_URL}`,
  });
}

/** Checks every 15 minutes who's due a report (first day of their week, 8:00 or later, not sent this week). */
export function startReportScheduler() {
  if (!transport) return;
  const tick = async () => {
    const users = await sql<User[]>`SELECT * FROM users WHERE weekly_report AND email IS NOT NULL`;
    for (const user of users) {
      const now = new Date();
      const today = localDate(user.timezone, now);
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: user.timezone, hour: "numeric", hourCycle: "h23" }).format(now));
      const weekStart = startOfWeek(today, user.weekStart);
      if (today !== weekStart || hour < 8) continue;
      // Sent already since this week began (some margin either side of midnight is fine).
      if (user.lastReportAt && now.getTime() - user.lastReportAt.getTime() < 6 * 24 * 60 * 60_000) continue;
      try {
        await sendWeeklyReport(user);
        await sql`UPDATE users SET last_report_at = now() WHERE id = ${user.id}`;
      } catch (e) {
        console.error(`Weekly report for ${user.id} failed`, e);
      }
    }
  };
  setInterval(() => void tick().catch((e) => console.error("Report scheduler", e)), 15 * 60_000);
  void tick().catch((e) => console.error("Report scheduler", e));
}
