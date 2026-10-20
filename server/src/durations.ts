// Keeps `heartbeats.duration` and `daily_stats` up to date.
//
// A heartbeat's duration is the gap to the user's next counted heartbeat, if it's shorter than
// their timeout and on the same local day; otherwise 0. This is wakapi's rule, so imported
// history adds up to the same totals.

import { EXCLUDED, sql } from "./db.ts";

/** One recompute at a time per user, so overlapping ingests can't interleave. */
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(userId) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => {});
  queues.set(userId, tail);
  void tail.then(() => queues.get(userId) === tail && queues.delete(userId));
  return run;
}

/** Bumped whenever a user's numbers change, so cached stats can tell they're stale. */
const versions = new Map<string, number>();
export const statsVersion = (userId: string) => versions.get(userId) ?? 0;
const bump = (userId: string) => versions.set(userId, statsVersion(userId) + 1);

/**
 * Recomputes durations from `from` on (everything when null), then the daily rollup from that day.
 * Starts at the last heartbeat before `from`: its duration depends on the one that follows.
 */
export function recompute(userId: string, from: Date | null): Promise<void> {
  return serialized(userId, async () => {
    const [user] = await sql<{ timezone: string; heartbeatTimeout: number }[]>`
      SELECT timezone, heartbeat_timeout FROM users WHERE id = ${userId}`;
    if (!user) return;
    // null: from the very beginning.
    let lower: Date | null = null;
    if (from) {
      const [prev] = await sql<{ t: Date | null }[]>`
        SELECT max(time) AS t FROM heartbeats
        WHERE user_id = ${userId} AND time < ${from} AND NOT ${EXCLUDED}`;
      lower = prev?.t ?? from;
    }

    await sql`
      WITH base AS (
        SELECT id, time, lead(time) OVER (ORDER BY time, id) AS next
        FROM heartbeats
        WHERE user_id = ${userId} AND time >= coalesce(${lower}::timestamptz, '-infinity') AND NOT ${EXCLUDED}
      ), calc AS (
        SELECT id,
          CASE
            WHEN next IS NULL THEN 0
            WHEN next - time >= make_interval(secs => ${user.heartbeatTimeout}) THEN 0
            WHEN (time AT TIME ZONE ${user.timezone})::date <> (next AT TIME ZONE ${user.timezone})::date THEN 0
            ELSE extract(epoch FROM next - time)
          END AS d
        FROM base
      )
      UPDATE heartbeats h SET duration = calc.d
      FROM calc
      WHERE h.id = calc.id AND h.duration <> calc.d`;

    await rollup(userId, user.timezone, lower);
  });
}

/** Rebuilds all of a user's `daily_stats` (after renaming or merging projects, durations unchanged). */
export function rebuildRollup(userId: string): Promise<void> {
  return serialized(userId, async () => {
    const [user] = await sql<{ timezone: string }[]>`SELECT timezone FROM users WHERE id = ${userId}`;
    if (user) await rollup(userId, user.timezone, null);
  });
}

async function rollup(userId: string, tz: string, lower: Date | null) {
  await sql.begin(async (tx) => {
    const [{ day }] = await tx<{ day: string }[]>`
      SELECT ((coalesce(${lower}::timestamptz, '-infinity') AT TIME ZONE ${tz})::date)::text AS day`;
    await tx`DELETE FROM daily_stats WHERE user_id = ${userId} AND day >= ${day}::text::date`;
    await tx`
      INSERT INTO daily_stats (user_id, day, project, language, editor, operating_system, machine, branch, category, seconds, heartbeats)
      SELECT user_id, (time AT TIME ZONE ${tz})::date, project, language, editor, operating_system, machine, branch, category,
             sum(duration), count(*)
      FROM heartbeats
      WHERE user_id = ${userId}
        AND time >= (${day}::text::date::timestamp AT TIME ZONE ${tz})
        AND NOT ${EXCLUDED}
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9`;
  });
  bump(userId);
}
