# Prompt 01: implement M1 (watcher engine)

Saved 2026-10-10. Paste this into a new Claude Code session in this repo (Sonnet 5.5 · high, or Opus 5.5).

---

Read SPEC.md in full, then implement milestone M1 only (§12): the watcher engine.
No LLM calls, no web UI, no auth, no email, no deploy. Those are later milestones.

## Scope (from SPEC.md §4, §5, §6, §7.2, §11)
1. Project scaffold: a Cloudflare Worker in TypeScript with Hono, Drizzle (SQLite dialect)
   on D1, R2 for snapshot bodies, Vitest with `@cloudflare/vitest-pool-workers`.
   `wrangler.jsonc` with D1 and R2 bindings and the two cron triggers. Nothing deployed:
   local `wrangler dev` only.
2. Portability interfaces from §4.3: `Db`, `BlobStore`, `Scheduler`, `Clock`. Production
   implementations on D1 and R2. Test implementations in memory.
3. Schema and migrations for the tables M1 needs: `sources`, `snapshots`, `events` (created
   by deterministic detectors only, status `pending_llm`), `jobs`, plus `catalog` loading.
4. Source kinds: `npm`, `pypi`, `github_repo`, `eol`, `feed`, `page`. `crates` and `go` can
   wait. For each, a fetcher, a normaliser and a comparator, as in §5. Respect the
   politeness rules (User-Agent, robots.txt for page/feed, conditional requests, 1 request
   per host per tick, backoff, `blocked` state).
5. Job runner (§7.2): claim with a lock, idempotent steps, retry with backoff, park after
   5 failures. Cron `*/5` runs a tick, daily cron schedules due polls and prunes.
6. Deterministic events: npm/PyPI licence change or deprecation, GitHub archived/licence
   change/transfer, EOL date set or moved earlier. Feed items and page diffs are stored as
   `pending_llm` events with before/after text for M2 to process.
7. `catalog/` with 10 starter YAML entries in the §5.1 format: cloudflare-workers, deno,
   bun, nodejs, vercel, supabase, bitwarden, vaultwarden, redis, terraform. Verify every
   URL and CSS selector by fetching it. Tell me which feeds or pages block automated
   fetches.
8. CLI: `npm run poll -- <source-id|catalog-id>` polls once locally and prints the result,
   and `npm run poll -- --all` polls every starter source.

## Done when
- Unit tests in SPEC §11 for normalisation, job runner (including the concurrent-lock
  test), dedupe and fixture-based deterministic events pass. `npm test` and `tsc` are clean.
- `npm run poll -- --all` run twice in a row produces **zero** changes on the second run
  (no false positives from timestamps or tracking parameters).
- A measurement of CPU time per cron tick under `wrangler dev --test-scheduled` with
  `JOBS_PER_TICK=10`, reported to me, with a note if anything approaches 10 ms.

Run `git init` first if this is not yet a repo (it should be). Work on a branch
`m1-watchers`, commit in logical steps, and stop when M1 is done. Finish with a short
summary: what was built, test results, which sources were blocked, and any deviations
from the spec.
