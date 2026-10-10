// Usage profiles (SPEC §7.1) and the rule that matches an event's `applies_when` against them
// (SPEC §7.3 step 5; used by M4's fan-out). Profiles use the same three dimensions as M2's
// applies_when: hosting, use, tier.
import type { CatalogEntry } from "../catalog/catalog";
import { HOSTING_VALUES, TIER_VALUES, USE_VALUES, type Profile } from "../db/schema";
import type { AppliesWhen } from "../llm/schemas";

export type Dimension = keyof Profile;
export const DIMENSIONS: Dimension[] = ["hosting", "use", "tier"];

export const QUESTIONS: Record<Dimension, { label: string; options: { value: string; label: string }[] }> = {
  hosting: { label: "How do you run it?", options: [{ value: "hosted", label: "Hosted (their cloud)" }, { value: "self_hosted", label: "Self-hosted" }] },
  use: { label: "Commercial or personal?", options: [{ value: "commercial", label: "Commercial" }, { value: "personal", label: "Personal" }] },
  tier: { label: "Free tier or paid?", options: [{ value: "free", label: "Free tier" }, { value: "paid", label: "Paid plan" }] },
};

const ALLOWED: Record<Dimension, readonly string[]> = { hosting: HOSTING_VALUES, use: USE_VALUES, tier: TIER_VALUES };

/** The questions a dep is asked: its catalog entry's usage_questions; packages and runtimes get "commercial?" only. */
export function questionsFor(entry: Pick<CatalogEntry, "usage_questions"> | null | undefined): Dimension[] {
  if (!entry) return ["use"];
  const q = entry.usage_questions ?? [];
  const dims: Dimension[] = [];
  if (q.includes("hosted") || q.includes("self_hosted")) dims.push("hosting");
  if (q.includes("commercial")) dims.push("use");
  if (q.includes("tier")) dims.push("tier");
  return dims;
}

/** Reads a profile from form fields `<prefix>hosting` etc. Blank or unknown values are left out (unknown). */
export function profileFromForm(form: Record<string, unknown>, dims: Dimension[] = DIMENSIONS, prefix = ""): Profile {
  const p: Record<string, string> = {};
  for (const d of dims) {
    const v = form[`${prefix}${d}`];
    if (typeof v === "string" && ALLOWED[d].includes(v)) p[d] = v;
  }
  return p as Profile;
}

/**
 * What we assume about a dep: its own answers, else the project's defaults, for the questions
 * that apply to it. Anything else stays unknown.
 */
export function effectiveProfile(dep: Profile, projectDefault: Profile, dims: Dimension[]): Profile {
  const p: Record<string, string> = {};
  for (const d of dims) {
    const v = dep[d] ?? projectDefault[d];
    if (v) p[d] = v;
  }
  return p as Profile;
}

export type Match = "affected" | "not_affected" | "unknown";

/**
 * Rules only, no LLM (SPEC §7.3 step 5). Each dimension the event restricts (a non-empty list)
 * must contain the profile's value. A known value outside the list → not affected. A restricted
 * dimension the profile does not answer → unknown, which fan-out treats as affected ("assume
 * affected", SPEC §7.1). No restriction at all → affected.
 */
export function matchProfile(appliesWhen: AppliesWhen | null | undefined, profile: Profile): Match {
  if (!appliesWhen) return "affected";
  let unknown = false;
  for (const d of DIMENSIONS) {
    const allowed = appliesWhen[d] as string[] | undefined;
    if (!allowed || allowed.length === 0) continue;
    const v = profile[d];
    if (v === undefined) unknown = true;
    else if (!allowed.includes(v)) return "not_affected";
  }
  return unknown ? "unknown" : "affected";
}

export function describeProfile(p: Profile): string {
  const parts = DIMENSIONS.filter((d) => p[d]).map((d) => QUESTIONS[d].options.find((o) => o.value === p[d])!.label.toLowerCase());
  return parts.length ? parts.join(", ") : "not set";
}
