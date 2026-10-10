// Claude API implementation of `Llm` (SPEC §7.4), using @anthropic-ai/sdk.
// - Structured outputs (`output_config.format`), adaptive thinking, explicit effort.
// - The system prompt and the catalog context come first, each marked for prompt caching;
//   the fetched text comes last.
// - `fallbacks: "default"` only for models that support server-side refusal fallbacks
//   (Opus 5.5 here); Haiku 5.5 has none, so a refusal there is returned as is.
import Anthropic from "@anthropic-ai/sdk";
import type { Llm, LlmRequest, LlmResponse, LlmUsage } from "./llm";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function supportsFallback(model: string): boolean {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
}

export class AnthropicLlm implements Llm {
  private readonly client: Anthropic;

  constructor(apiKey: string, opts: { baseURL?: string; fetch?: typeof fetch } = {}) {
    // One SDK retry; the job runner owns longer backoff. Opus at medium effort can take a while.
    this.client = new Anthropic({ apiKey, maxRetries: 1, timeout: 180_000, ...opts });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const fallback = supportsFallback(req.model);
    const msg = await this.client.beta.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: req.effort, format: { type: "json_schema", schema: req.schema } },
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: req.context, cache_control: { type: "ephemeral" } },
            { type: "text", text: req.input },
          ],
        },
      ],
      ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    });

    const usage = toUsage(msg.usage, msg.model);
    if (msg.stop_reason === "refusal") {
      const d = msg.stop_details;
      return { type: "refusal", category: d?.category ?? null, explanation: d?.explanation ?? null, model: msg.model, usage };
    }
    if (msg.stop_reason === "max_tokens") return { type: "incomplete", reason: "max_tokens", model: msg.model, usage };
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text.trim()) return { type: "incomplete", reason: `no text (stop_reason ${msg.stop_reason})`, model: msg.model, usage };
    try {
      return { type: "json", value: JSON.parse(text), model: msg.model, usage };
    } catch {
      return { type: "incomplete", reason: "output is not JSON", model: msg.model, usage };
    }
  }
}

type SdkUsage = Anthropic.Beta.BetaUsage;

function toUsage(u: SdkUsage, served: string): LlmUsage {
  const usage: LlmUsage = {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
  // With a fallback, each model that ran is billed at its own rates.
  if (u.iterations?.some((it) => it.type === "fallback_message")) {
    usage.byModel = u.iterations.map((it) => ({
      model: ("model" in it && it.model) || served,
      inputTokens: it.input_tokens,
      outputTokens: it.output_tokens,
      cacheReadTokens: it.cache_read_input_tokens ?? 0,
      cacheWriteTokens: it.cache_creation_input_tokens ?? 0,
    }));
  }
  return usage;
}
