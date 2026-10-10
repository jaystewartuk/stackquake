// Event creation with dedupe (SPEC §6 events.dedupe_key, §7.3 step 1).
import { eq } from "drizzle-orm";
import type { Ctx } from "../context";
import { events, type EventKind } from "../db/schema";
import type { DetectedChange } from "../sources/types";
import { sha256Hex, truncate } from "../util";

export const MAX_EVENT_TEXT = 8_000;

export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9.+\->]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * sha256 of (scope, kind, normalised title). The scope is the catalog entry when there is one,
 * so the same announcement seen through a feed, a page and a registry becomes one event.
 */
export function dedupeKey(scope: string, kind: EventKind, title: string): Promise<string> {
  return sha256Hex(`${scope}\n${kind}\n${normaliseTitle(title)}`);
}

export interface RecordInput {
  sourceId: number;
  /** Catalog entry, or null for sources outside the catalog (scope is then the source). */
  catalogId: string | null;
  change: DetectedChange;
}

/** Inserts a pending_llm event unless one with the same dedupe key exists. */
export async function recordEvent(ctx: Ctx, { sourceId, catalogId, change }: RecordInput): Promise<{ id: number; created: boolean }> {
  const scope = catalogId ?? `source:${sourceId}`;
  const base = change.dedupeTitle ?? change.title;
  const key = await dedupeKey(scope, change.kind, change.repeatable ? `${base} ${new Date(ctx.clock.now()).toISOString().slice(0, 7)}` : base);
  const inserted = await ctx.db
    .insert(events)
    .values({
      sourceId,
      catalogId,
      kind: change.kind,
      detectedAt: ctx.clock.now(),
      effectiveDate: change.effectiveDate ?? null,
      status: "pending_llm",
      title: truncate(change.title, 300),
      quote: change.quote ?? null,
      quoteUrl: change.quoteUrl,
      beforeText: change.beforeText ? truncate(change.beforeText, MAX_EVENT_TEXT) : null,
      afterText: change.afterText ? truncate(change.afterText, MAX_EVENT_TEXT) : null,
      dedupeKey: key,
    })
    .onConflictDoNothing({ target: events.dedupeKey })
    .returning({ id: events.id });
  if (inserted.length) return { id: inserted[0].id, created: true };
  const existing = await ctx.db.select({ id: events.id }).from(events).where(eq(events.dedupeKey, key)).get();
  return { id: existing!.id, created: false };
}
