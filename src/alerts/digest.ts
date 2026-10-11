// Weekly digest (SPEC §7.5): on each user's digest_day the daily run queues one digest job per
// user. The digest carries alerts held for it, plus a count of changes that didn't affect the user
// (suppressed alerts). It is sent only if something affects the user, or when no digest has gone
// out yet this calendar month ("all quiet" once a month, not every week).
//
// Idempotent: the step first stamps the alerts it will carry with the digest's day (digest_at), so
// a retry renders the same set and reuses the same Idempotency-Key.
import { and, eq, sql } from "drizzle-orm";
import type { Ctx } from "../context";
import { alerts, users, type Job } from "../db/schema";
import type { StepResult } from "../jobs/runner";
import { DAY } from "../util";
import { alertView, userFooter } from "./deliver";
import { renderDigest, type AlertView } from "./render";

export const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY;
const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Daily: one digest job for each user whose digest day (UTC) is today. */
export async function enqueueDigests(ctx: Ctx): Promise<void> {
  const now = ctx.clock.now();
  const day = dayStart(now);
  await ctx.db.run(sql`
    INSERT INTO jobs (kind, payload, run_after, attempts, dedupe_key)
    SELECT 'digest', json_object('userId', id, 'day', ${day}), ${now}, 0, 'digest:' || id || ':' || ${isoDay(day)}
    FROM users WHERE digest_day = ${new Date(now).getUTCDay()} AND (last_digest_at IS NULL OR last_digest_at < ${day})
    ON CONFLICT (dedupe_key) DO NOTHING`);
}

/** The send/skip rule: something that affects the user, or the first digest this month. */
export function shouldSendDigest(held: number, lastDigestAt: number | null, day: number): boolean {
  return held > 0 || lastDigestAt === null || monthOf(lastDigestAt) !== monthOf(day);
}

export async function digestStep(ctx: Ctx, job: Job): Promise<StepResult> {
  const p = job.payload as { userId?: number; day?: number } | null;
  if (!p?.userId || !p.day) return { type: "done" };
  const { userId, day } = p;
  const user = await ctx.db.select().from(users).where(eq(users.id, userId)).get();
  if (!user || (user.lastDigestAt !== null && user.lastDigestAt >= day)) return { type: "done" };

  const carried = () => ctx.db.select().from(alerts).where(and(eq(alerts.userId, userId), eq(alerts.digestAt, day))).orderBy(alerts.id).all();
  let list = await carried();
  if (!list.length) {
    await ctx.db.run(sql`
      UPDATE alerts SET digest_at = ${day}
      WHERE user_id = ${userId} AND digest_at IS NULL
        AND ((status = 'queued' AND channel = 'digest') OR status = 'suppressed')
        AND event_id IN (SELECT id FROM events WHERE status = 'published')`);
    list = await carried();
  }
  const held: AlertView[] = [];
  const suppressed: { name: string; title: string; eventUrl: string }[] = [];
  for (const a of list) {
    const v = await alertView(ctx, a.id);
    if (!v?.published) continue;
    if (a.status === "suppressed") suppressed.push({ name: v.view.name, title: v.view.event.title, eventUrl: v.view.eventUrl });
    else if (a.status === "queued") held.push(v.view);
  }

  if (!shouldSendDigest(held.length, user.lastDigestAt, day)) {
    // Nothing to say: suppressed changes wait for the next digest that goes out.
    await ctx.db.update(alerts).set({ digestAt: null }).where(and(eq(alerts.userId, userId), eq(alerts.digestAt, day)));
    return { type: "done" };
  }

  const [counts] = await ctx.db.all<{ deps: number; projects: number }>(sql`
    WITH owners AS (SELECT ${userId} AS id UNION SELECT tm.owner_id FROM team_members tm JOIN users o ON o.id = tm.owner_id
                    WHERE tm.user_id = ${userId} AND tm.joined_at IS NOT NULL AND o.plan = 'team')
    SELECT (SELECT count(*) FROM deps d JOIN projects p ON p.id = d.project_id WHERE p.user_id IN (SELECT id FROM owners)) AS deps,
           (SELECT count(*) FROM projects WHERE user_id IN (SELECT id FROM owners)) AS projects`);
  const mail = renderDigest({ held, suppressed, watching: counts }, await userFooter(ctx, userId, false));
  await ctx.mailer.send({ to: user.email, ...mail, idempotencyKey: `digest-${userId}-${isoDay(day)}` });
  const now = ctx.clock.now();
  await ctx.db.update(alerts).set({ status: "sent", sentAt: now }).where(and(eq(alerts.userId, userId), eq(alerts.digestAt, day), eq(alerts.status, "queued")));
  await ctx.db.update(users).set({ lastDigestAt: now }).where(eq(users.id, userId));
  return { type: "done" };
}
