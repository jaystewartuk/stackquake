// Builders for alert tests: users with deps, published events, a mocked Resend API and a runner
// loop that settles every job except polls.
import { eq, sql } from "drizzle-orm";
import { enqueueFanout } from "../src/alerts/fanout";
import type { Ctx } from "../src/context";
import { deps, events, jobs, projects, users, type Dep, type Event, type NewEvent, type Profile, type User } from "../src/db/schema";
import { runTick } from "../src/jobs/runner";
import type { Note } from "../src/llm/schemas";
import { ResendMailer } from "../src/platform/resend";
import { linkSources, upsertDeps } from "../src/stack/deps";
import { MINUTE } from "../src/util";
import type { FixtureHttp, testCtx } from "./helpers";

type T = ReturnType<typeof testCtx>;

export async function addUser(ctx: Ctx, email: string, over: Partial<typeof users.$inferInsert> = {}): Promise<User> {
  const [u] = await ctx.db.insert(users).values({ email, createdAt: ctx.clock.now(), ...over }).returning();
  return u;
}

/** A new project for the user with one dep (a catalog entry or a package), linked to its sources. */
export async function addDep(ctx: Ctx, userId: number, what: { catalogId?: string; npm?: string }, profile: Profile = {}, defaultProfile: Profile = {}): Promise<Dep> {
  const [p] = await ctx.db.insert(projects).values({ userId, name: `Project of ${userId}`, defaultProfile, createdAt: ctx.clock.now() }).returning();
  const [d] = await upsertDeps(
    ctx,
    p.id,
    [{ depKey: what.catalogId ? `catalog:${what.catalogId}` : `npm:${what.npm}`, catalogId: what.catalogId ?? null, ecosystem: what.npm ? "npm" : null, package: what.npm ?? null, versionSpec: null, eolProduct: null, eolCycle: null, foundIn: [], rank: null }],
    what.catalogId ? "manual" : "import",
  );
  await linkSources(ctx, [d]);
  if (Object.keys(profile).length) await ctx.db.update(deps).set({ profile }).where(eq(deps.id, d.id));
  return (await ctx.db.select().from(deps).where(eq(deps.id, d.id)).get())!;
}

export const note = (over: Partial<Note> = {}): Note => ({
  material: true,
  kind: "license",
  title: "Licence moves to SSPL",
  what_changed: "New versions are under the SSPL.",
  quote: '"license": "SSPL-1.0"',
  effective_date: null,
  applies_when: { hosting: [], use: [], tier: [] },
  who_is_not_affected: null,
  options: [{ catalog_id: "valkey", name: "Valkey", why: "BSD-licensed fork", effort: "low" }],
  uncertain: [],
  confidence: 0.95,
  ...over,
});

let seq = 0;

/** A published event on the source, with fan-out queued (as publishing does). */
export async function publish(ctx: Ctx, sourceId: number, over: Partial<NewEvent> & { note?: Note } = {}): Promise<Event> {
  const n = over.note ?? note({ kind: (over.kind as Note["kind"]) ?? "license" });
  const [e] = await ctx.db
    .insert(events)
    .values({
      sourceId,
      kind: n.kind,
      detectedAt: ctx.clock.now(),
      publishedAt: ctx.clock.now(),
      status: "published",
      confidence: n.confidence,
      title: n.title,
      quote: n.quote,
      quoteUrl: "https://example.com/source",
      appliesWhen: n.applies_when,
      effectiveDate: n.effective_date,
      dedupeKey: `test-${++seq}-${ctx.clock.now()}`,
      ...over,
      note: n,
    })
    .returning();
  await enqueueFanout(ctx, e.id);
  return e;
}

export async function sourceId(ctx: Ctx, kind: string, key: string): Promise<number> {
  const [r] = await ctx.db.all<{ id: number }>(sql`SELECT id FROM sources WHERE kind = ${kind} AND key = ${key}`);
  if (!r) throw new Error(`no source ${kind} ${key}`);
  return r.id;
}

/** Runs ticks until no job but polls is left, moving the clock past deferrals and backoff. */
export async function settle(t: T, maxTicks = 60, step = 6 * MINUTE, strict = true): Promise<void> {
  await t.ctx.db.delete(jobs).where(eq(jobs.kind, "poll"));
  for (let i = 0; i < maxTicks; i++) {
    const r = await runTick(t.ctx);
    if (r.claimed === 0) {
      const left = (await t.ctx.db.select().from(jobs).all()).filter((j) => j.parkedAt === null && j.kind !== "poll");
      if (!left.length) return;
      t.clock.set(Math.max(t.clock.now() + step, Math.min(...left.map((j) => j.runAfter))));
    }
    await t.ctx.db.delete(jobs).where(eq(jobs.kind, "poll"));
  }
  if (strict) throw new Error("jobs did not settle");
}

export interface SentMail {
  key: string | null;
  body: { from: string; to: string[]; subject: string; text: string; html?: string; headers?: Record<string, string> };
}

/**
 * A stand-in for POST https://api.resend.com/emails that honours Idempotency-Key like Resend: a
 * repeated key is answered without sending again. `requests` counts every call.
 */
export function mockResend(http: FixtureHttp) {
  const sent: SentMail[] = [];
  const keys = new Set<string>();
  let requests = 0;
  let failNext: number | null = null;
  http.set("https://api.resend.com/emails", async (req) => {
    requests++;
    if (req.headers.get("authorization") !== "Bearer re_test") return new Response('{"statusCode":401}', { status: 401 });
    if (failNext !== null) {
      const status = failNext;
      failNext = null;
      return new Response(JSON.stringify({ statusCode: status, name: "error", message: "failure for the test" }), { status });
    }
    const key = req.headers.get("idempotency-key");
    if (key && keys.has(key)) return Response.json({ id: "already" });
    if (key) keys.add(key);
    sent.push({ key, body: await req.json() });
    return Response.json({ id: `email_${sent.length}` });
  });
  return {
    sent,
    get requests() {
      return requests;
    },
    failWith(status: number) {
      failNext = status;
    },
    mailer: Object.assign(new ResendMailer({ apiKey: "re_test", from: "Stackquake <alerts@stackquake.com>", http: http.fetch }), {
      /** For test/web.ts lastToken(): the magic-link email goes through the mock too. */
      last: () => sent[sent.length - 1]?.body,
    }),
  };
}
