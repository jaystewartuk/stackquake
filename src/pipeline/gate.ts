// The review gate (SPEC §7.3 step 4).
import type { EventKind } from "../db/schema";

/** Kinds that may be published without a person looking at them. */
export const AUTO_PUBLISH_KINDS: ReadonlySet<EventKind> = new Set(["license", "eol", "deprecated", "archived"]);
export const AUTO_PUBLISH_CONFIDENCE = 0.9;
/** Classifier output below this, or kind "other", is rejected (kept for audit). */
export const CLASSIFY_MIN_CONFIDENCE = 0.7;
/** Notes for these kinds are written by the LLM_MODEL_SUMMARISE_HIGH model. */
export const HIGH_STAKES_KINDS: ReadonlySet<EventKind> = new Set(["license", "eol", "acquisition"]);

export type GateDecision = { status: "published"; reason: null } | { status: "pending_review"; reason: string };

export function reviewGate(i: { kind: EventKind; confidence: number; quoteFound: boolean }): GateDecision {
  const why: string[] = [];
  if (!i.quoteFound) why.push("quote not found in the source");
  if (!AUTO_PUBLISH_KINDS.has(i.kind)) why.push(`kind ${i.kind} always needs review`);
  if (i.confidence < AUTO_PUBLISH_CONFIDENCE) why.push(`confidence ${i.confidence.toFixed(2)} < ${AUTO_PUBLISH_CONFIDENCE}`);
  return why.length ? { status: "pending_review", reason: why.join("; ") } : { status: "published", reason: null };
}
