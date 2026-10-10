import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      ANTHROPIC_API_KEY?: string;
      /** Eval only (vitest.eval.config.ts). */
      GOLDEN?: { cases: unknown[]; files: Record<string, string> };
      EVAL_OPTIONS?: { models: { classify: string; summarise: string; summariseHigh: string }; only: string; repeat: number };
    }
  }
}
