import { describe, expect, it } from "vitest";
import type { Profile } from "../src/db/schema";
import type { AppliesWhen } from "../src/llm/schemas";
import { effectiveProfile, matchProfile, profileFromForm, questionsFor } from "../src/stack/profile";

const HOSTING = ["hosted", "self_hosted", undefined] as const;
const USE = ["commercial", "personal", undefined] as const;
const TIER = ["free", "paid", undefined] as const;

function every(): Profile[] {
  const out: Profile[] = [];
  for (const hosting of HOSTING) for (const use of USE) for (const tier of TIER) out.push({ ...(hosting && { hosting }), ...(use && { use }), ...(tier && { tier }) });
  return out;
}

const any: AppliesWhen = { hosting: [], use: [], tier: [] };

describe("matchProfile (M4 fan-out rule, SPEC §7.3 step 5)", () => {
  it("an event with no restriction affects every profile, including the empty one", () => {
    for (const p of every()) expect(matchProfile(any, p)).toBe("affected");
    expect(matchProfile(null, {})).toBe("affected");
  });

  it("a licence change for commercial self-hosters: every one of the 27 profile combinations", () => {
    const aw: AppliesWhen = { hosting: ["self_hosted"], use: ["commercial"], tier: [] };
    const table: [Profile, string][] = every().map((p) => {
      // Spelled out from the scenario: hosted users or personal users are out; a missing answer
      // to either restricted question is unknown; tier is not restricted, so it never matters.
      const out = p.hosting === "hosted" || p.use === "personal";
      const missing = p.hosting === undefined || p.use === undefined;
      return [p, out ? "not_affected" : missing ? "unknown" : "affected"];
    });
    expect(table.filter(([, r]) => r === "affected")).toHaveLength(3); // self_hosted + commercial, any tier
    expect(table.filter(([, r]) => r === "unknown")).toHaveLength(9);
    expect(table.filter(([, r]) => r === "not_affected")).toHaveLength(15);
    for (const [p, expected] of table) expect(matchProfile(aw, p), JSON.stringify(p)).toBe(expected);
  });

  it("a free-tier change: paid users are not affected, unknown tier is unknown", () => {
    const aw: AppliesWhen = { hosting: [], use: [], tier: ["free"] };
    expect(matchProfile(aw, { tier: "free" })).toBe("affected");
    expect(matchProfile(aw, { tier: "paid", hosting: "hosted" })).toBe("not_affected");
    expect(matchProfile(aw, { hosting: "hosted", use: "commercial" })).toBe("unknown");
  });

  it("lists with several values match any of them", () => {
    const aw: AppliesWhen = { hosting: ["hosted", "self_hosted"], use: ["commercial", "personal"], tier: ["free", "paid"] };
    expect(matchProfile(aw, { hosting: "self_hosted", use: "personal", tier: "paid" })).toBe("affected");
    expect(matchProfile(aw, {})).toBe("unknown");
  });

  it("a known mismatch wins over an unknown dimension", () => {
    expect(matchProfile({ hosting: ["self_hosted"], use: ["commercial"], tier: [] }, { use: "personal" })).toBe("not_affected");
  });
});

describe("usage questions and profiles", () => {
  it("asks only the entry's usage_questions", () => {
    expect(questionsFor({ usage_questions: ["hosted", "self_hosted", "commercial"] })).toEqual(["hosting", "use"]);
    expect(questionsFor({ usage_questions: ["self_hosted"] })).toEqual(["hosting"]);
    expect(questionsFor({ usage_questions: ["hosted", "tier"] })).toEqual(["hosting", "tier"]);
    expect(questionsFor({ usage_questions: [] })).toEqual([]);
    expect(questionsFor({})).toEqual([]);
    // Packages and runtimes outside the catalog: commercial or personal only.
    expect(questionsFor(null)).toEqual(["use"]);
  });

  it("defaults from the project, only for the questions that apply", () => {
    const project: Profile = { hosting: "hosted", use: "commercial", tier: "paid" };
    expect(effectiveProfile({}, project, ["hosting", "tier"])).toEqual({ hosting: "hosted", tier: "paid" });
    expect(effectiveProfile({ tier: "free" }, project, ["hosting", "tier"])).toEqual({ hosting: "hosted", tier: "free" });
    expect(effectiveProfile({}, {}, ["hosting"])).toEqual({});
  });

  it("reads profiles from forms, dropping blanks and unknown values", () => {
    expect(profileFromForm({ hosting: "self_hosted", use: "", tier: "gold" })).toEqual({ hosting: "self_hosted" });
    expect(profileFromForm({ d7_hosting: "hosted", d7_use: "personal", hosting: "self_hosted" }, ["hosting"], "d7_")).toEqual({ hosting: "hosted" });
  });
});
