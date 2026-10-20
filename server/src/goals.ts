// Daily / weekly coding goals and how they're going.

import { COLUMN, sql } from "./db.ts";
import { addDays, localDate, startOfWeek } from "./stats.ts";
import type { User } from "./users.ts";

export interface Goal {
  id: string;
  period: "day" | "week";
  seconds: number;
  dimension: "project" | "language" | "editor" | "category" | null;
  value: string | null;
  weekdaysOnly: boolean;
}

export interface GoalProgress extends Goal {
  /** Seconds so far in the current day / week. */
  current: number;
  /** Past periods, oldest first, the current one last. */
  history: { start: string; seconds: number; counts: boolean }[];
  /** Consecutive past periods (current excluded unless already met) that met the goal. */
  streak: number;
}

const isWeekday = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};

export async function listGoals(userId: string): Promise<Goal[]> {
  return sql<Goal[]>`
    SELECT id::text, period, seconds, dimension, value, weekdays_only FROM goals WHERE user_id = ${userId} ORDER BY created_at`;
}

export async function goalProgress(user: User, goal: Goal): Promise<GoalProgress> {
  const today = localDate(user.timezone);
  const periods = goal.period === "day" ? 30 : 12;
  const first = goal.period === "day" ? addDays(today, -(periods - 1)) : addDays(startOfWeek(today, user.weekStart), -7 * (periods - 1));
  const scope = goal.dimension ? sql`AND ${sql(COLUMN[goal.dimension])} = ${goal.value ?? ""}` : sql``;
  const rows = await sql<{ day: string; seconds: number }[]>`
    SELECT day::text, sum(seconds)::float8 AS seconds FROM daily_stats
    WHERE user_id = ${user.id} AND day >= ${first}::date ${scope}
    GROUP BY day`;
  const byDay = new Map(rows.map((r) => [r.day, r.seconds]));

  const history: GoalProgress["history"] = [];
  for (let i = 0; i < periods; i++) {
    if (goal.period === "day") {
      const day = addDays(first, i);
      history.push({ start: day, seconds: byDay.get(day) ?? 0, counts: !goal.weekdaysOnly || isWeekday(day) });
    } else {
      const start = addDays(first, 7 * i);
      let seconds = 0;
      for (let d = 0; d < 7; d++) seconds += byDay.get(addDays(start, d)) ?? 0;
      history.push({ start, seconds, counts: true });
    }
  }

  const current = history[history.length - 1].seconds;
  let streak = current >= goal.seconds ? 1 : 0;
  for (let i = history.length - 2; i >= 0; i--) {
    const h = history[i];
    if (!h.counts) continue;
    if (h.seconds < goal.seconds) break;
    streak++;
  }
  return { ...goal, current, history, streak };
}
