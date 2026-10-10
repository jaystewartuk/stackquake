// A scripted `Llm` for tests: answers each purpose from a queue or a function, and records
// every request.
import type { Llm, LlmRequest, LlmResponse, Purpose } from "./llm";

export type FakeAnswer = LlmResponse | ((req: LlmRequest) => LlmResponse);

export const fakeUsage = { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };

export const json = (value: unknown, model = "fake-model"): LlmResponse => ({ type: "json", value, model, usage: fakeUsage });
export const refusal = (category: string | null = "general_harms"): LlmResponse => ({ type: "refusal", category, explanation: "declined", model: "fake-model", usage: fakeUsage });

export class FakeLlm implements Llm {
  readonly requests: LlmRequest[] = [];
  private readonly answers: Record<Purpose, FakeAnswer[]> = { classify: [], summarise: [] };
  /** Used when a purpose's queue is empty. */
  defaults: Partial<Record<Purpose, FakeAnswer>> = {};

  on(purpose: Purpose, ...answers: FakeAnswer[]): this {
    this.answers[purpose].push(...answers);
    return this;
  }

  calls(purpose?: Purpose): LlmRequest[] {
    return purpose ? this.requests.filter((r) => r.purpose === purpose) : this.requests;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(req);
    const answer = this.answers[req.purpose].shift() ?? this.defaults[req.purpose];
    if (!answer) throw new Error(`FakeLlm: no answer queued for ${req.purpose}`);
    const res = typeof answer === "function" ? answer(req) : answer;
    return { ...res, model: res.model === "fake-model" ? req.model : res.model };
  }
}
