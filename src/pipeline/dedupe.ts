// Semantic dedupe (M2): once an event has a real kind and title, its dedupe key is recomputed
// from (catalog entry, kind, normalised title), so one announcement seen through two feeds, or a
// feed and a page, becomes one event. On a collision the newer event is marked as a duplicate of
// the older one (status `rejected`, `duplicate_of` set) instead of failing on the unique key.
import { eq } from "drizzle-orm";
import type { Ctx } from "../context";
import { events, type Event, type EventKind } from "../db/schema";
import { dedupeKey } from "../watch/events";

/** Raw M1 keys for feed items and page diffs identify the item, not the announcement. */
export const scopeFor = (e: Pick<Event, "catalogId" | "sourceId">) => e.catalogId ?? `source:${e.sourceId}`;

const isOlder = (a: Pick<Event, "id" | "detectedAt">, b: Pick<Event, "id" | "detectedAt">) => a.detectedAt < b.detectedAt || (a.detectedAt === b.detectedAt && a.id < b.id);

/**
 * Gives `event` the semantic key for (kind, title). Returns the id of the older event it
 * duplicates, or null. Safe to repeat.
 */
export async function claimSemanticKey(ctx: Ctx, event: Event, kind: EventKind, title: string): Promise<number | null> {
  const key = await dedupeKey(scopeFor(event), kind, title);
  if (key === event.dedupeKey) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const holder = await ctx.db.select().from(events).where(eq(events.dedupeKey, key)).get();
    if (holder && holder.id !== event.id) {
      // The older event keeps the key. A published holder always keeps it.
      if (holder.status === "published" || isOlder(holder, event)) return holder.id;
      await ctx.db
        .update(events)
        .set({ dedupeKey: `dup:${holder.id}`, status: "rejected", duplicateOf: event.id, reviewReason: `duplicate of event ${event.id}` })
        .where(eq(events.id, holder.id));
    }
    try {
      await ctx.db.update(events).set({ dedupeKey: key }).where(eq(events.id, event.id));
      event.dedupeKey = key;
      return null;
    } catch (e) {
      // Another step took the key between the read and the write: look again.
      if (attempt === 1 || !/UNIQUE/i.test(`${String(e)} ${String((e as { cause?: unknown }).cause ?? "")}`)) throw e;
    }
  }
  return null;
}

export async function markDuplicate(ctx: Ctx, eventId: number, of: number): Promise<void> {
  await ctx.db.update(events).set({ status: "rejected", duplicateOf: of, reviewReason: `duplicate of event ${of}` }).where(eq(events.id, eventId));
}
