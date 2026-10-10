// Delivery of immediate alerts (SPEC §7.3 step 6, §7.5): email through the Mailer, plus Slack
// when the user has a webhook. One job per alert. The rate limit is one atomic UPDATE (D1 runs
// statements one at a time), so two deliveries for the same user can never both take the 3rd slot.
//
// Never twice: each target records its own timestamp, so a retry skips what already went out.
// Email carries an Idempotency-Key, so a send whose result was lost is dropped by Resend on retry.
// A Slack post has no such key: one that started and never recorded a result is not repeated.
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Ctx } from "../context";
import { alerts, channels, deps, events, sources, users, type Alert, type Channel, type Job } from "../db/schema";
import type { StepResult } from "../jobs/runner";
import type { Note } from "../llm/schemas";
import { MailError } from "../ports";
import { DAY, errorMessage } from "../util";
import { subjectName } from "../web/events-view";
import { depName } from "../web/stack-view";
import { linkUrl, signLink } from "./links";
import { renderAlertEmail, renderAlertSlack, type AlertLinks, type AlertView } from "./render";
import { decrypt } from "./secretbox";
import { postSlack } from "./slack";
import { IMMEDIATE_PER_DAY } from "./urgency";

/** Takes one of the user's immediate slots for the last 24 hours, or returns false. */
export async function claimSlot(ctx: Ctx, a: Pick<Alert, "id" | "userId">): Promise<boolean> {
  const now = ctx.clock.now();
  const rows = await ctx.db.all<{ id: number }>(sql`
    UPDATE alerts SET claimed_at = ${now}
    WHERE id = ${a.id} AND claimed_at IS NULL
      AND (SELECT count(*) FROM alerts WHERE user_id = ${a.userId} AND claimed_at > ${now - DAY}) < ${IMMEDIATE_PER_DAY}
    RETURNING id`);
  return rows.length > 0;
}

/** Everything needed to render an alert. */
export async function alertView(ctx: Ctx, alertId: number): Promise<{ alert: Alert; view: AlertView; published: boolean } | null> {
  const row = await ctx.db
    .select({ alert: alerts, event: events, sourceKind: sources.kind, sourceKey: sources.key })
    .from(alerts)
    .innerJoin(events, eq(events.id, alerts.eventId))
    .innerJoin(sources, eq(sources.id, events.sourceId))
    .where(eq(alerts.id, alertId))
    .get();
  if (!row) return null;
  const dep = await ctx.db.select().from(deps).where(eq(deps.id, row.alert.depId)).get();
  const e = row.event;
  const origin = ctx.config.appOrigin;
  const links: AlertLinks = {};
  const secret = ctx.config.linkSecret;
  if (secret) {
    const now = ctx.clock.now();
    links.useful = linkUrl(origin, await signLink(secret, "useful", alertId, now));
    links.notRelevant = linkUrl(origin, await signLink(secret, "not_relevant", alertId, now));
    if (dep) links.mute = linkUrl(origin, await signLink(secret, "mute", alertId, now));
  }
  return {
    alert: row.alert,
    published: e.status === "published",
    view: {
      name: dep ? depName(dep) : subjectName({ catalogId: e.catalogId, sourceKind: row.sourceKind, sourceKey: row.sourceKey }),
      event: { id: e.id, kind: e.kind, title: e.title, quote: e.quote, quoteUrl: e.quoteUrl, effectiveDate: e.effectiveDate, note: e.note as Note | null },
      because: row.alert.because,
      links,
      eventUrl: `${origin}/events/${e.id}`,
    },
  };
}

export async function userFooter(ctx: Ctx, userId: number, digestOnlyLink: boolean) {
  const secret = ctx.config.linkSecret;
  return {
    settingsUrl: `${ctx.config.appOrigin}/app/settings`,
    digestOnly: secret && digestOnlyLink ? linkUrl(ctx.config.appOrigin, await signLink(secret, "digest_only", userId, ctx.clock.now())) : undefined,
  };
}

async function slackChannel(ctx: Ctx, userId: number): Promise<Channel | undefined> {
  if (!ctx.config.channelKey) return undefined;
  return ctx.db.select().from(channels).where(and(eq(channels.userId, userId), eq(channels.kind, "slack"), sql`${channels.verifiedAt} IS NOT NULL`)).get();
}

const setAlert = (ctx: Ctx, id: number, values: Partial<Alert>) => ctx.db.update(alerts).set(values).where(eq(alerts.id, id));

export async function deliverStep(ctx: Ctx, job: Job): Promise<StepResult> {
  const alertId = Number((job.payload as { alertId?: number } | null)?.alertId);
  const loaded = Number.isInteger(alertId) ? await alertView(ctx, alertId) : null;
  if (!loaded) return { type: "done" };
  const { alert: a, view } = loaded;
  if (a.status !== "queued" || a.channel === "digest") return { type: "done" };
  if (!loaded.published) {
    // An admin rejected the event after it was published: say nothing.
    await setAlert(ctx, a.id, { status: "failed", error: "event withdrawn before delivery" });
    return { type: "done" };
  }

  // Rate limit (SPEC §7.5): the 4th immediate alert in 24 hours waits for the digest.
  if (a.claimedAt === null && !(await claimSlot(ctx, a))) {
    await ctx.db.update(alerts).set({ channel: "digest", held: "rate_limit" }).where(and(eq(alerts.id, a.id), isNull(alerts.claimedAt)));
    return { type: "done" };
  }

  const user = await ctx.db.select().from(users).where(eq(users.id, a.userId)).get();
  if (!user) return { type: "done" };
  const slack = await slackChannel(ctx, user.id);
  if (!user.emailImmediate && !slack) {
    // Turned off immediate email (and has no Slack) since fan-out: give the slot back.
    await setAlert(ctx, a.id, { channel: "digest", held: "digest_only", claimedAt: null });
    return { type: "done" };
  }

  const errors: string[] = [];
  let delivered = a.emailedAt !== null || a.slackAt !== null;

  if (user.emailImmediate && a.emailedAt === null) {
    const mail = renderAlertEmail(view, await userFooter(ctx, user.id, true));
    try {
      await ctx.mailer.send({ to: user.email, ...mail, idempotencyKey: `alert-${a.id}`, headers: listUnsubscribe(mail.text) });
      await setAlert(ctx, a.id, { emailedAt: ctx.clock.now() });
      delivered = true;
    } catch (e) {
      if (!(e instanceof MailError && e.permanent)) throw e;
      errors.push(errorMessage(e));
    }
  }

  if (slack && a.slackAt === null) {
    if (a.slackTryAt !== null) {
      errors.push("an earlier Slack post did not record its result; not repeated");
    } else {
      await setAlert(ctx, a.id, { slackTryAt: ctx.clock.now() });
      const r = await postSlack(ctx, await decrypt(ctx.config.channelKey!, slack.webhookUrlEnc), renderAlertSlack(view));
      if (r.ok) {
        await setAlert(ctx, a.id, { slackAt: ctx.clock.now() });
        delivered = true;
      } else {
        // A definite failure: nothing was posted, so a retry is safe.
        await setAlert(ctx, a.id, { slackTryAt: null });
        await ctx.db.update(channels).set({ lastError: r.error }).where(eq(channels.id, slack.id));
        if (!r.permanent) throw new Error(r.error);
        errors.push(r.error);
      }
    }
  }

  const now = ctx.clock.now();
  await setAlert(ctx, a.id, delivered ? { status: "sent", sentAt: now, error: errors.join("; ") || null } : { status: "failed", error: errors.join("; ").slice(0, 1_000) });
  return { type: "done" };
}

/** The "only send me the digest" link as a List-Unsubscribe header, when the body has one. */
function listUnsubscribe(text: string): Record<string, string> | undefined {
  const m = /Only send me the weekly digest: (\S+)/.exec(text);
  return m ? { "List-Unsubscribe": `<${m[1]}>` } : undefined;
}
