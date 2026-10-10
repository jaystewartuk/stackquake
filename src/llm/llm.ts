// The LLM port (SPEC §7.4). Steps talk to `Llm`; production uses the Claude API
// (src/llm/anthropic.ts), tests use FakeLlm (src/llm/fake.ts). Every call goes through
// `callLlm`, which records tokens and cost in llm_calls.
import type { Ctx } from "../context";
import { llmCalls } from "../db/schema";

export type Purpose = "classify" | "summarise";
export type Effort = "low" | "medium" | "high";

export interface LlmRequest {
  purpose: Purpose;
  model: string;
  effort: Effort;
  /** Fixed instructions. Sent first and cached. */
  system: string;
  /** Stable per catalog entry (name, alternatives). Sent next and cached. */
  context: string;
  /** Per-event text, including the untrusted fetched text. Always last. */
  input: string;
  /** JSON schema for structured output. */
  schema: Record<string, unknown>;
  maxTokens: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Per-model split when a server-side fallback served part of the request. */
  byModel?: { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }[];
}

export type LlmResponse =
  | { type: "json"; value: unknown; model: string; usage: LlmUsage }
  /** stop_reason "refusal": the event goes to review, never retried automatically. */
  | { type: "refusal"; category: string | null; explanation: string | null; model: string; usage: LlmUsage }
  /** Hit max_tokens, no text, or text that is not JSON. */
  | { type: "incomplete"; reason: string; model: string; usage: LlmUsage };

export interface Llm {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** USD per million tokens: input, output, 5-minute cache write, cache read. */
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5, 0.125, 0.01],
  "claude-sonnet-5-5": [2, 10, 2.5, 0.2],
  "claude-opus-5-5": [4, 20, 5, 0.2],
  "claude-opus-5": [5, 25, 6.25, 0.5],
  "claude-opus-4-8": [5, 25, 6.25, 0.5],
};
/** Unknown models (a fallback we did not expect) are priced like the dearest one we use. */
const UNKNOWN_PRICE = PRICES["claude-opus-5"];

export function priceOf(model: string): [number, number, number, number] {
  return PRICES[model] ?? PRICES[model.replace(/-\d{8}$/, "")] ?? UNKNOWN_PRICE;
}

export function costUsd(model: string, usage: LlmUsage): number {
  const parts = usage.byModel?.length ? usage.byModel : [{ model, ...usage }];
  let total = 0;
  for (const p of parts) {
    const [i, o, w, r] = priceOf(p.model);
    total += (p.inputTokens * i + p.outputTokens * o + p.cacheWriteTokens * w + p.cacheReadTokens * r) / 1_000_000;
  }
  return total;
}

/** Calls the model and records the call. API errors propagate (the job runner retries). */
export async function callLlm(ctx: Ctx, req: LlmRequest, eventId: number | null): Promise<LlmResponse> {
  const res = await ctx.llm.complete(req);
  await ctx.db.insert(llmCalls).values({
    purpose: req.purpose,
    model: res.model,
    inputTokens: res.usage.inputTokens,
    outputTokens: res.usage.outputTokens,
    cacheReadTokens: res.usage.cacheReadTokens,
    cacheWriteTokens: res.usage.cacheWriteTokens,
    costUsd: costUsd(res.model, res.usage),
    eventId,
    outcome: res.type === "json" ? "ok" : res.type,
    createdAt: ctx.clock.now(),
  });
  return res;
}
