// extract_diff step (SPEC §7.2/§7.3): compare two page snapshots and create a pending_llm
// event when enough text changed (SPEC §5 "Thresholds").
import type { Ctx } from "../context";
import type { Source } from "../db/schema";
import { changedChars, diffLines, excerpts } from "./diff";
import { MAX_EVENT_TEXT, recordEvent } from "./events";
import { catalogLinks, loadSnapshot, scopeOf } from "./poll";

export const MIN_CHANGED_CHARS = 20;

export type DiffOutcome =
  | { type: "event"; eventId: number; created: boolean; changedChars: number }
  | { type: "below_threshold"; changedChars: number }
  | { type: "missing_snapshot" };

export async function extractDiff(ctx: Ctx, source: Source, oldSha: string, newSha: string): Promise<DiffOutcome> {
  const [before, after] = await Promise.all([loadSnapshot(ctx, oldSha), loadSnapshot(ctx, newSha)]);
  if (before === null || after === null) return { type: "missing_snapshot" };
  const hunks = diffLines(before, after);
  const chars = changedChars(hunks);
  if (chars < MIN_CHANGED_CHARS) return { type: "below_threshold", changedChars: chars };
  const { before: beforeText, after: afterText } = excerpts(hunks, MAX_EVENT_TEXT);
  const links = await catalogLinks(ctx, source.id);
  const { id, created } = await recordEvent(ctx, {
    sourceId: source.id,
    catalogId: scopeOf(links),
    change: {
      kind: "other",
      title: `Page changed: ${source.url}`,
      dedupeTitle: `page diff ${source.id} ${oldSha} ${newSha}`,
      quoteUrl: source.url,
      beforeText,
      afterText,
    },
  });
  return { type: "event", eventId: id, created, changedChars: chars };
}
