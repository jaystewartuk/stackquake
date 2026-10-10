# Model and Effort Guide for Building Stackquake

Model choice in Claude Code for implementing `SPEC.md`. These are judgment calls, not benchmarked results.

## Minimum
- **Lowest workable setting:** Sonnet 5.5 at `medium` effort.
- **Judgment-heavy work (M2 prompts and evals):** use Opus 5.5 at `high`.
- **Not suitable:**
  - Haiku 5.5 is too weak for building this, even though it may be good enough to *run* the classifier (SPEC §14 Q2).
  - Fable 5.1 is more than this needs.

## Per milestone
| Milestone | Model / effort | Why |
|---|---|---|
| M1 watcher engine, job runner | Sonnet 5.5 · high | Idempotent jobs, locking in SQLite and the 10 ms CPU budget are easy to get subtly wrong. |
| **M2 classify, summarise, quote check, golden set** | **Opus 5.5 · high** | The product's value is accurate, quoted notes. Prompt design and eval judgement matter most here. |
| M3 web app, auth, repo import | Sonnet 5.5 · medium | Standard Hono and Drizzle work; manifest parsers are well covered by fixtures. |
| M4 alerts, digest, budget guard | Sonnet 5.5 · medium | Routine, with clear tests. |
| M5 GitHub App, deploy, DNS | Sonnet 5.5 · medium | Mostly configuration. DNS changes are made through Chrome and need your approval. |
| M6 billing, landing page | Sonnet 5.5 · medium | Same pattern as Beckon M7. |

## Notes
- **Simplest option.** Opus 5.5 costs twice as much as Sonnet 5.5 per token ($4/$20 vs $2/$10 per million input/output tokens). Running Opus 5.5 at its default `medium` for everything, and `high` for M1 and M2, is reasonable.
- **Running the evals costs real money.** `npm run eval` calls the live API. One golden-set run on Opus 5.5 is roughly $0.10–0.50.
- **Review M2 whichever model builds it.** If Sonnet built it, run `/code-review high` on Opus 5.5 before moving on.

## How to run it
- Switch models with `/model` in Claude Code.
- Give the model `SPEC.md` up front.
- Work one milestone per session, using that milestone's "done when" as the stop condition.
