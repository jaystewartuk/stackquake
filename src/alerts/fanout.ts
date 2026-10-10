// Fan-out (SPEC §7.3 step 5): when an event is published, match it against every dep linked to its
// source, rules only. `affected` and `unknown` become alerts; `not_affected` becomes a suppressed
// alert for the digest. Chunked: each step handles FANOUT_CHUNK deps and reschedules itself, so
// an event that touches thousands of deps never runs in one invocation.
import { eq, sql } from "drizzle-orm";
import { CATALOG } from "../catalog/entries";
import type { Ctx } from "../context";
import { catalogSources, events, jobs, type HeldReason, type Job, type Profile } from "../db/schema";
import type { StepResult } from "../jobs/runner";
import { enqueue } from "../jobs/queue";
import type { AppliesWhen, Note } from "../llm/schemas";
import { DIMENSIONS, effectiveProfile, matchProfile, questionsFor, type Match } from "../stack/profile";
import { depName } from "../web/stack-view";
import { isUrgent } from "./urgency";

export const FANOUT_CHUNK = 200;

export const fanoutKey = (eventId: number) => `fanout:${eventId}`;

/** Queues fan-out for a newly published event (auto-publish or admin approval). Idempotent. */
export async function enqueueFanout(ctx: Ctx, eventId: number): Promise<void> {
  await enqueue(ctx, { kind: "fanout", eventId, dedupeKey: fanoutKey(eventId) });
}

const ENTRIES = new Map(CATALOG.map((e) => [e.id, e]));

interface DepRow {
  id: number;
  catalog_id: string | null;
  ecosystem: string | null;
  package: string | null;
  eol_product: string | null;
  profile: string;
  muted_until: number | null;
  project_name: string;
  default_profile: string;
  user_id: number;
  email_immediate: number;
  has_slack: number;
}

const RANK: Record<Match, number> = { affected: 2, unknown: 1, not_affected: 0 };

const PHRASES: Record<string, string> = { hosted: "hosted", self_hosted: "self-hosted", commercial: "commercially", personal: "for personal use", free: "on the free tier", paid: "on a paid plan" };
const usage = (p: Profile, dims = DIMENSIONS) => dims.filter((d) => p[d]).map((d) => PHRASES[p[d]!]).join(", ");

/** "Affects you because: …" (or the "we assume it does" sentence for an unknown profile). */
export function becauseText(match: Match, name: string, project: string, appliesWhen: AppliesWhen | null, profile: Profile): string {
  if (match === "unknown") return `We don't know how you use ${name}, so we assume it does.`;
  const restricted = DIMENSIONS.filter((d) => (appliesWhen?.[d]?.length ?? 0) > 0);
  if (match === "not_affected") {
    const off = restricted.filter((d) => profile[d] && !appliesWhen![d].includes(profile[d] as never));
    return `It only applies to use ${off.map((d) => appliesWhen![d].map((v) => PHRASES[v]).join(" or ")).join(", ")}, and you use ${name} ${usage(profile, off)} in ${project}.`;
  }
  if (!restricted.length) return `you use ${name} in ${project}, and the change applies to everyone who uses it.`;
  return `you use ${name} ${usage(profile, restricted)} in ${project}, which the change applies to.`;
}

/**
 * For an event from a feed several catalog entries share (the Cloudflare blog), a catalog dep only
 * matches when its entry's keyword filter appears in the event; otherwise every Workers user would
 * hear about every D1 post.
 */
function filterMatches(filter: string[] | null | undefined, hay: string): boolean {
  return !filter?.length || filter.some((w) => hay.includes(w.toLowerCase()));
}

export async function fanoutStep(ctx: Ctx, job: Job): Promise<StepResult> {
  if (job.eventId === null) return { type: "done" };
  const event = await ctx.db.select().from(events).where(eq(events.id, job.eventId)).get();
  if (!event || event.status !== "published") return { type: "done" };
  const after = Number((job.payload as { after?: number } | null)?.after ?? 0);
  const now = ctx.clock.now();

  const rows = await ctx.db.all<DepRow>(sql`
    SELECT d.id, d.catalog_id, d.ecosystem, d.package, d.eol_product, d.profile, d.muted_until,
           p.name AS project_name, p.default_profile, p.user_id, u.email_immediate,
           EXISTS (SELECT 1 FROM channels c WHERE c.user_id = p.user_id AND c.verified_at IS NOT NULL) AS has_slack
    FROM dep_sources ds
    JOIN deps d ON d.id = ds.dep_id
    JOIN projects p ON p.id = d.project_id
    JOIN users u ON u.id = p.user_id
    WHERE ds.source_id = ${event.sourceId} AND d.id > ${after}
    ORDER BY d.id
    LIMIT ${FANOUT_CHUNK + 1}`);
  const more = rows.length > FANOUT_CHUNK;
  const chunk = more ? rows.slice(0, FANOUT_CHUNK) : rows;

  const links = event.catalogId ? [] : await ctx.db.select().from(catalogSources).where(eq(catalogSources.sourceId, event.sourceId)).all();
  const shared = links.length > 1;
  const note = event.note as Note | null;
  const hay = `${event.title}\n${note?.what_changed ?? ""}\n${event.quote ?? ""}`.toLowerCase();
  const urgent = isUrgent(event, now);
  const appliesWhen = event.appliesWhen as AppliesWhen | null;

  // One alert per user and event: the dep that matches best.
  const best = new Map<number, { row: DepRow; match: Match; profile: Profile }>();
  for (const r of chunk) {
    if (r.muted_until !== null && r.muted_until > now) continue;
    if (shared && r.catalog_id && !filterMatches(links.find((l) => l.catalogId === r.catalog_id)?.filter, hay)) continue;
    const entry = r.catalog_id ? ENTRIES.get(r.catalog_id) : undefined;
    const profile = effectiveProfile(JSON.parse(r.profile) as Profile, JSON.parse(r.default_profile) as Profile, questionsFor(entry));
    const match = matchProfile(appliesWhen, profile);
    const prev = best.get(r.user_id);
    if (!prev || RANK[match] > RANK[prev.match]) best.set(r.user_id, { row: r, match, profile });
  }

  const values = [...best.values()].map(({ row, match, profile }) => {
    const name = depName({ catalogId: row.catalog_id, ecosystem: row.ecosystem, package: row.package, eolProduct: row.eol_product }, row.catalog_id ? ENTRIES.get(row.catalog_id) : undefined);
    let channel: "email" | "slack" | "digest" = "digest";
    let held: HeldReason | null = null;
    if (match !== "not_affected") {
      if (!urgent) held = "not_urgent";
      else if (row.email_immediate) channel = "email";
      else if (row.has_slack) channel = "slack";
      else held = "digest_only";
    }
    return {
      user: row.user_id,
      dep: row.id,
      channel,
      status: match === "not_affected" ? "suppressed" : "queued",
      match,
      because: becauseText(match, name, row.project_name, appliesWhen, profile),
      held,
    };
  });

  if (values.length) {
    // A user whose deps straddle two chunks may first get a suppressed alert; a later affected dep
    // upgrades it, as long as no digest has carried it yet.
    await ctx.db.run(sql`
      INSERT INTO alerts (user_id, event_id, dep_id, channel, status, match, because, held, created_at)
      SELECT json_extract(value, '$.user'), ${event.id}, json_extract(value, '$.dep'), json_extract(value, '$.channel'),
             json_extract(value, '$.status'), json_extract(value, '$.match'), json_extract(value, '$.because'),
             json_extract(value, '$.held'), ${now}
      FROM json_each(${JSON.stringify(values)}) WHERE true
      ON CONFLICT (user_id, event_id) DO UPDATE SET
        dep_id = excluded.dep_id, channel = excluded.channel, status = excluded.status,
        match = excluded.match, because = excluded.because, held = excluded.held
      WHERE alerts.status = 'suppressed' AND excluded.status = 'queued' AND alerts.digest_at IS NULL`);
    await enqueueDeliveries(ctx, event.id);
  }

  if (more) {
    await ctx.db.update(jobs).set({ payload: { after: chunk[chunk.length - 1].id } }).where(eq(jobs.id, job.id));
    return { type: "reschedule", at: now };
  }
  return { type: "done" };
}

/** One deliver job per immediate alert still queued (idempotent; also the daily repair). */
export async function enqueueDeliveries(ctx: Ctx, eventId?: number): Promise<void> {
  await ctx.db.run(sql`
    INSERT INTO jobs (kind, event_id, payload, run_after, attempts, dedupe_key)
    SELECT 'deliver', event_id, json_object('alertId', id), ${ctx.clock.now()}, 0, 'deliver:' || id
    FROM alerts WHERE status = 'queued' AND channel <> 'digest' ${eventId === undefined ? sql`` : sql`AND event_id = ${eventId}`}
    ON CONFLICT (dedupe_key) DO NOTHING`);
}

