// Builders for alert tests: users with deps, published events, a mocked SES API and a runner
// loop that settles every job except polls.
import { env } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import { enqueueFanout } from "../src/alerts/fanout";
import type { Ctx } from "../src/context";
import { deps, events, jobs, projects, users, type Dep, type Event, type NewEvent, type Profile, type User } from "../src/db/schema";
import { runTick } from "../src/jobs/runner";
import type { Note } from "../src/llm/schemas";
import { d1Db } from "../src/platform/cloudflare";
import { IdempotentMailer } from "../src/platform/idempotent";
import { FakeClock } from "../src/platform/memory";
import { DEFAULT_FROM, SesMailer } from "../src/platform/ses";
import type { Mail } from "../src/ports";
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
  body: { from: string; to: string[]; subject: string; text: string; html?: string; headers?: Record<string, string> };
}

interface SesBody {
  FromEmailAddress: string;
  Destination: { ToAddresses: string[] };
  Content: { Simple: { Subject: { Data: string }; Body: { Text: { Data: string }; Html?: { Data: string } }; Headers?: { Name: string; Value: string }[] } };
}

export const SES_URL = "https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails";

/**
 * A stand-in for SES's POST /v2/email/outbound-emails behind the production wiring: SesMailer
 * wrapped in IdempotentMailer, so a repeated key is recorded in mail_sends and not sent again.
 * `sent` is what SES accepted, `requests` counts every send the app attempted. Pass the returned
 * `clock` to testCtx so mail_sends rows carry the test's time.
 */
export function mockSes(http: FixtureHttp) {
  const sent: SentMail[] = [];
  let requests = 0;
  let failNext: { status: number; type: string } | null = null;
  const clock = new FakeClock();
  http.set(SES_URL, async (req) => {
    if (!req.headers.get("authorization")?.startsWith("AWS4-HMAC-SHA256 Credential=AKIATEST/")) return new Response('{"message":"bad credentials"}', { status: 403, headers: { "x-amzn-errortype": "UnrecognizedClientException" } });
    if (failNext) {
      const { status, type } = failNext;
      failNext = null;
      return new Response(JSON.stringify({ message: "failure for the test" }), { status, headers: { "x-amzn-errortype": type } });
    }
    const b = (await req.json()) as SesBody;
    const { Subject, Body, Headers } = b.Content.Simple;
    sent.push({
      body: {
        from: b.FromEmailAddress,
        to: b.Destination.ToAddresses,
        subject: Subject.Data,
        text: Body.Text.Data,
        ...(Body.Html ? { html: Body.Html.Data } : {}),
        ...(Headers ? { headers: Object.fromEntries(Headers.map((h) => [h.Name, h.Value])) } : {}),
      },
    });
    return Response.json({ MessageId: `m-${sent.length}` });
  });
  const ses = new SesMailer({ accessKeyId: "AKIATEST", secretAccessKey: "secret", from: DEFAULT_FROM, http: http.fetch });
  const idempotent = new IdempotentMailer(ses, d1Db(env.DB), clock);
  return {
    sent,
    clock,
    get requests() {
      return requests;
    },
    /** The next request fails with this status and SES error type (default: InternalFailure for 5xx, else MessageRejected). */
    failWith(status: number, type = status >= 500 ? "InternalFailure" : "MessageRejected") {
      failNext = { status, type };
    },
    mailer: {
      send(mail: Mail) {
        requests++;
        return idempotent.send(mail);
      },
      /** For test/web.ts lastToken(): the magic-link email goes through the mock too. */
      last: () => sent[sent.length - 1]?.body,
    },
  };
}

/** Idempotency keys recorded in mail_sends, oldest first. */
export async function sentKeys(ctx: Ctx): Promise<string[]> {
  return (await ctx.db.all<{ key: string }>(sql`SELECT key FROM mail_sends ORDER BY sent_at, rowid`)).map((r) => r.key);
}
