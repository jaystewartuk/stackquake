// M2 event pipeline steps (SPEC §7.3): fetch_post → classify (feed items) → summarise → review
// gate. Each step is its own job, checks the event's state first (so a retry or a duplicate job
// does nothing), writes its result, then queues the next step.
import { and, eq, inArray } from "drizzle-orm";
import { budgetState, PAUSE_RECHECK_MS } from "../alerts/budget";
import { enqueueFanout } from "../alerts/fanout";
import type { Ctx } from "../context";
import { catalog, events, sources, type Event, type Job, type JobKind, type Source, type SourceKind } from "../db/schema";
import type { HostGate, StepResult } from "../jobs/runner";
import { enqueue } from "../jobs/queue";
import { callLlm, type LlmResponse } from "../llm/llm";
import { CLASSIFY_SYSTEM, classifyInput, productContext, SUMMARISE_SYSTEM, summariseInput, type ProductContext, type SummariseSource } from "../llm/prompts";
import { CLASSIFY_SCHEMA, SUMMARISE_SCHEMA, validateClassification, validateNote, type Classification, type Note } from "../llm/schemas";
import { HEAVY, hostOf } from "../sources/http";
import { errorMessage } from "../util";
import { claimSemanticKey, markDuplicate } from "./dedupe";
import { CLASSIFY_MIN_CONFIDENCE, HIGH_STAKES_KINDS, reviewGate } from "./gate";
import { EXCERPT_CHARS, fetchPostText, getText, putText } from "./post";
import { quoteFound } from "./quote";

/** Gate token: one LLM step per tick keeps the tick's wall time and CPU bounded. */
export const LLM = "#llm";
/** Attempts (claims) before a failing LLM step stops retrying and hands the event to review. */
export const MAX_LLM_ATTEMPTS = 4;
/** SPEC §7.4: the first ~6k tokens of the post. */
export const CLASSIFY_TEXT_CHARS = 24_000;
export const SUMMARISE_TEXT_CHARS = 40_000;

/** First pipeline step for a new event. */
export function firstStep(sourceKind: SourceKind): JobKind {
  return sourceKind === "feed" ? "fetch_post" : "summarise";
}

export const stepKey = (kind: JobKind, eventId: number) => `${kind}:${eventId}`;

export async function enqueueStep(ctx: Ctx, kind: JobKind, eventId: number): Promise<void> {
  await enqueue(ctx, { kind, eventId, dedupeKey: stepKey(kind, eventId) });
}

async function loadEvent(ctx: Ctx, job: Job): Promise<{ event: Event; source: Source } | null> {
  if (job.eventId === null) return null;
  const event = await ctx.db.select().from(events).where(eq(events.id, job.eventId)).get();
  if (!event || event.status !== "pending_llm") return null;
  const source = await ctx.db.select().from(sources).where(eq(sources.id, event.sourceId)).get();
  return source ? { event, source } : null;
}

async function toReview(ctx: Ctx, eventId: number, reason: string, extra: Partial<Event> = {}): Promise<StepResult> {
  await ctx.db
    .update(events)
    .set({ ...extra, status: "pending_review", reviewReason: reason.slice(0, 1_000) })
    .where(and(eq(events.id, eventId), eq(events.status, "pending_llm")));
  return { type: "done" };
}

/** A failed LLM call: retry through the runner, then give the event to a person. */
async function llmFailure(ctx: Ctx, job: Job, eventId: number, what: string): Promise<StepResult> {
  if (job.attempts < MAX_LLM_ATTEMPTS) throw new Error(what);
  return toReview(ctx, eventId, `${job.kind} failed ${job.attempts} times: ${what}`);
}

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function product(ctx: Ctx, event: Event, source: Source): Promise<ProductContext> {
  if (!event.catalogId) return { id: null, name: source.kind === "npm" || source.kind === "pypi" ? `${source.key} (${source.kind})` : source.key, alternatives: [] };
  const row = await ctx.db.select().from(catalog).where(eq(catalog.id, event.catalogId)).get();
  const data = row?.data as { alternatives?: string[]; category?: string } | undefined;
  const altIds = data?.alternatives ?? [];
  const names = new Map(
    altIds.length ? (await ctx.db.select({ id: catalog.id, name: catalog.name }).from(catalog).where(inArray(catalog.id, altIds)).all()).map((r) => [r.id, r.name]) : [],
  );
  return { id: event.catalogId, name: row?.name ?? event.catalogId, category: data?.category, alternatives: altIds.map((id) => ({ id, name: names.get(id) ?? null })) };
}

/** The full source texts stored for this event (post, page snapshots). */
async function storedTexts(ctx: Ctx, event: Event): Promise<string[]> {
  const out: string[] = [];
  for (const key of event.sourceKeys ?? []) {
    const t = await getText(ctx, key);
    if (t) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// fetch_post

export async function fetchPostStep(ctx: Ctx, job: Job, gate: HostGate): Promise<StepResult> {
  const loaded = await loadEvent(ctx, job);
  if (!loaded) return { type: "done" };
  const { event, source } = loaded;
  const next = async () => {
    await enqueueStep(ctx, "classify", event.id);
    return { type: "done" } as const;
  };
  if (source.kind !== "feed" || event.sourceKeys?.length || event.classification) return next();
  const url = event.quoteUrl;
  const feedText = event.afterText ?? "";
  if (feedText.length >= EXCERPT_CHARS || !/^https?:\/\//i.test(url) || url === source.url) return next();
  if (!gate.take([hostOf(url), HEAVY])) return { type: "defer" };

  const r = await fetchPostText(ctx, url);
  if (r.type === "ok") {
    const key = await putText(ctx, r.text);
    await ctx.db.update(events).set({ sourceKeys: [key] }).where(eq(events.id, event.id));
    return next();
  }
  // Temporary trouble: let the runner back off and retry a couple of times.
  if (r.type === "retry" && job.attempts < 3) throw new Error(`fetch post: ${r.reason}`);
  // Blocked, too large, empty, or still failing: carry on with the feed's text.
  await ctx.db.update(events).set({ reviewReason: `post not fetched (${r.reason}); using the feed text` }).where(eq(events.id, event.id));
  return next();
}

// ---------------------------------------------------------------------------------------------
// classify

async function postText(ctx: Ctx, event: Event): Promise<string> {
  const stored = await storedTexts(ctx, event);
  return stored[0] ?? event.afterText ?? "";
}

export async function classifyStep(ctx: Ctx, job: Job, gate: HostGate): Promise<StepResult> {
  const loaded = await loadEvent(ctx, job);
  if (!loaded) return { type: "done" };
  const { event, source } = loaded;
  if (event.classification) {
    await enqueueStep(ctx, "summarise", event.id);
    return { type: "done" };
  }
  if (!gate.take([LLM])) return { type: "defer" };
  // SPEC §7.4 budget guard: above twice the weekly budget, classification waits (not a failure).
  // Checked after taking the token, so concurrent steps still claim it in job order.
  if ((await budgetState(ctx)).paused) return { type: "defer", ms: PAUSE_RECHECK_MS };

  const text = (await postText(ctx, event)).slice(0, CLASSIFY_TEXT_CHARS);
  let res: LlmResponse;
  try {
    res = await callLlm(
      ctx,
      {
        purpose: "classify",
        model: ctx.config.models.classify,
        effort: "low",
        system: CLASSIFY_SYSTEM,
        context: productContext(await product(ctx, event, source)),
        input: classifyInput({ title: event.title, url: event.quoteUrl, date: isoDate(event.detectedAt), text }),
        schema: CLASSIFY_SCHEMA,
        maxTokens: 4_000,
      },
      event.id,
    );
  } catch (e) {
    return llmFailure(ctx, job, event.id, `LLM error: ${errorMessage(e)}`);
  }
  if (res.type === "refusal") return toReview(ctx, event.id, `classify: model refused (${res.category ?? "no category"})`);
  if (res.type === "incomplete") return llmFailure(ctx, job, event.id, `classify: ${res.reason}`);
  const v = validateClassification(res.value);
  if (!v.ok) return llmFailure(ctx, job, event.id, `classify output invalid: ${v.errors.join("; ")}`);
  const c: Classification = v.value;

  if (c.kind === "other" || c.confidence < CLASSIFY_MIN_CONFIDENCE) {
    await ctx.db
      .update(events)
      .set({ classification: c, confidence: c.confidence, status: "rejected", reviewReason: `classifier: ${c.kind} (${c.confidence.toFixed(2)})` })
      .where(eq(events.id, event.id));
    return { type: "done" };
  }
  await ctx.db
    .update(events)
    .set({ classification: c, kind: c.kind, confidence: c.confidence, effectiveDate: c.effective_date })
    .where(eq(events.id, event.id));
  const dupOf = await claimSemanticKey(ctx, { ...event, kind: c.kind }, c.kind, event.title);
  if (dupOf !== null) {
    await markDuplicate(ctx, event.id, dupOf);
    return { type: "done" };
  }
  await enqueueStep(ctx, "summarise", event.id);
  return { type: "done" };
}

// ---------------------------------------------------------------------------------------------
// summarise + quote check + review gate

export type Origin = "post" | "page_diff" | "registry";

export const originOf = (source: Source): Origin => (source.kind === "feed" ? "post" : source.kind === "page" ? "page_diff" : "registry");

async function summariseSource(ctx: Ctx, event: Event, origin: Origin): Promise<SummariseSource> {
  if (origin === "post") {
    const c = event.classification as Classification | null;
    return { type: "post", title: event.title, text: (await postText(ctx, event)).slice(0, SUMMARISE_TEXT_CHARS), classification: c ? { kind: c.kind, one_line: c.one_line } : null };
  }
  if (origin === "page_diff") return { type: "page_diff", before: event.beforeText ?? "", after: event.afterText ?? "" };
  return { type: "registry", detected: event.title, before: event.beforeText, after: event.afterText, extra: event.quote };
}

export async function summariseStep(ctx: Ctx, job: Job, gate: HostGate): Promise<StepResult> {
  const loaded = await loadEvent(ctx, job);
  if (!loaded) return { type: "done" };
  const { event, source } = loaded;
  const origin = originOf(source);
  if (origin === "post" && !event.classification) {
    await enqueueStep(ctx, "classify", event.id);
    return { type: "done" };
  }
  if (!gate.take([LLM, HEAVY])) return { type: "defer" };

  const { models } = ctx.config;
  const base = {
    purpose: "summarise" as const,
    effort: "medium" as const,
    system: SUMMARISE_SYSTEM,
    context: productContext(await product(ctx, event, source)),
    input: summariseInput({ kind: event.kind, url: event.quoteUrl, date: isoDate(event.detectedAt), source: await summariseSource(ctx, event, origin) }),
    schema: SUMMARISE_SCHEMA,
    maxTokens: 16_000,
  };
  // Kinds known before the call (deterministic or classified) pick the model up front; a
  // Haiku note that turns out to be high-stakes is written again by the high-stakes model.
  let model = HIGH_STAKES_KINDS.has(event.kind) ? models.summariseHigh : models.summarise;
  let res: LlmResponse;
  try {
    res = await callLlm(ctx, { ...base, model }, event.id);
    if (res.type === "json" && model !== models.summariseHigh) {
      const first = validateNote(res.value);
      const kind = first.ok ? finalKind(event, origin, first.value) : null;
      if (kind && HIGH_STAKES_KINDS.has(kind) && first.ok && first.value.material) {
        model = models.summariseHigh;
        res = await callLlm(ctx, { ...base, model }, event.id);
      }
    }
  } catch (e) {
    return llmFailure(ctx, job, event.id, `LLM error: ${errorMessage(e)}`);
  }
  if (res.type === "refusal") return toReview(ctx, event.id, `summarise: model refused (${res.category ?? "no category"})`);
  if (res.type === "incomplete") return llmFailure(ctx, job, event.id, `summarise: ${res.reason}`);
  const v = validateNote(res.value);
  if (!v.ok) return llmFailure(ctx, job, event.id, `summarise output invalid: ${v.errors.join("; ")}`);
  const note: Note = v.value;

  // A page change that is not material, or a post the note writer finds is no deal change after
  // all (a second opinion on the classifier), is rejected without a note.
  if ((origin === "page_diff" && !note.material) || (origin === "post" && !note.material && note.kind === "other")) {
    const why = origin === "page_diff" ? "page change not material" : "summariser: not a deal change";
    await ctx.db
      .update(events)
      .set({ status: "rejected", confidence: note.confidence, reviewReason: `${why}: ${note.what_changed}`.slice(0, 1_000) })
      .where(eq(events.id, event.id));
    return { type: "done" };
  }

  const kind = finalKind(event, origin, note);
  const corpus = [event.beforeText, event.afterText, ...(origin === "registry" && event.quote ? [event.quote] : []), ...(await storedTexts(ctx, event))];
  const found = quoteFound(note.quote, corpus);
  const decision = reviewGate({ kind, confidence: note.confidence, quoteFound: found });
  const now = ctx.clock.now();

  // Feed and page events get their semantic dedupe key from the note's title.
  if (origin !== "registry") {
    const dupOf = await claimSemanticKey(ctx, event, kind, note.title);
    if (dupOf !== null) {
      await ctx.db
        .update(events)
        .set({ kind, title: note.title.slice(0, 300), note, quote: note.quote, quoteFound: found, confidence: note.confidence, status: "rejected", duplicateOf: dupOf, reviewReason: `duplicate of event ${dupOf}` })
        .where(eq(events.id, event.id));
      return { type: "done" };
    }
  }

  await ctx.db
    .update(events)
    .set({
      kind,
      title: note.title.slice(0, 300),
      note,
      quote: note.quote,
      quoteFound: found,
      effectiveDate: note.effective_date ?? event.effectiveDate,
      appliesWhen: note.applies_when,
      confidence: note.confidence,
      status: decision.status,
      reviewReason: decision.reason,
      publishedAt: decision.status === "published" ? now : null,
    })
    .where(and(eq(events.id, event.id), eq(events.status, "pending_llm")));
  if (decision.status === "published") await enqueueFanout(ctx, event.id);
  return { type: "done" };
}

/** Registry events keep their detected kind; only "other" (a transfer) may be refined. */
function finalKind(event: Event, origin: Origin, note: Note): Event["kind"] {
  return origin === "registry" && event.kind !== "other" ? event.kind : note.kind;
}
