// LLM budget guard (SPEC §7.4): the daily run emails the admins when the last 7 days of LLM calls
// cost more than LLM_WEEKLY_BUDGET_USD; above twice that, classify steps pause (deferred, not
// failed). Summarise keeps running: it only follows a classified post or a detected change.
import { gt, sql } from "drizzle-orm";
import type { Ctx } from "../context";
import { llmCalls } from "../db/schema";
import { DAY, HOUR } from "../util";

/** How long a paused classify step waits before checking again. */
export const PAUSE_RECHECK_MS = 6 * HOUR;

export async function weeklyLlmCost(ctx: Ctx): Promise<number> {
  const row = await ctx.db
    .select({ usd: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` })
    .from(llmCalls)
    .where(gt(llmCalls.createdAt, ctx.clock.now() - 7 * DAY))
    .get();
  return row?.usd ?? 0;
}

export type BudgetState = { cost: number; budget: number; over: boolean; paused: boolean };

export async function budgetState(ctx: Ctx): Promise<BudgetState> {
  const cost = await weeklyLlmCost(ctx);
  const budget = ctx.config.llmWeeklyBudgetUsd;
  return { cost, budget, over: cost > budget, paused: cost > 2 * budget };
}

/** Daily: tell the admins when the budget is exceeded. One email per admin per day. */
export async function checkBudget(ctx: Ctx): Promise<BudgetState> {
  const s = await budgetState(ctx);
  if (!s.over) return s;
  const date = new Date(ctx.clock.now()).toISOString().slice(0, 10);
  const subject = `[Stackquake] LLM spend $${s.cost.toFixed(2)} in 7 days (budget $${s.budget.toFixed(2)})`;
  const text = [
    `LLM calls cost $${s.cost.toFixed(2)} over the last 7 days, above the weekly budget of $${s.budget.toFixed(2)} (LLM_WEEKLY_BUDGET_USD).`,
    s.paused
      ? `That is more than twice the budget, so classify steps are paused until the 7-day cost falls below $${(2 * s.budget).toFixed(2)}. Summarise keeps running.`
      : `Classify steps pause if it passes $${(2 * s.budget).toFixed(2)}.`,
    `Per-call costs: ${ctx.config.appOrigin}/admin`,
  ].join("\n\n");
  for (const to of ctx.config.adminEmails) await ctx.mailer.send({ to, subject, text, idempotencyKey: `budget-${date}-${to}` });
  return s;
}
