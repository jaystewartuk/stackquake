# Implementation decisions

Decisions made while building, and where the code deviates from SPEC.md. Newest milestone last.
Read this after SPEC.md; where they disagree, this file wins.

## M1: watcher engine (2026-10-10)

### Hosting: Workers Free plan for the MVP
- The owner chose to stay on the Free plan (10 ms CPU per invocation). Workers Paid is the
  fallback if `exceededCpu` shows up on more than 1% of invocations after deploy (SPEC §4.2).
- `JOBS_PER_TICK` defaults to **3**, not 10.
- `HostGate` hands out per-tick tokens: one per **website** host (politeness) and one `HEAVY`
  token, so at most one page poll, feed poll or diff step runs per tick. Rate-limited APIs
  (npm, PyPI, GitHub, endoflife.date) take no token. Any new CPU-heavy step must take `HEAVY`.
- Claims count attempts and move `run_after` to that attempt's backoff, so a step killed by the
  CPU limit (no result recorded) still backs off and is parked after 6 claims. A claimed job
  with attempts ≥ 2 runs alone; the rest of its batch is handed back first, so a CPU-killer
  cannot take healthy jobs down with it.
- Poll handlers never throw into the runner: fetch or parse errors become a source-level retry
  with `sources.last_error`. The daily run revives poll jobs parked for more than a day.
- Feeds poll every **2 h** (SPEC: 1 h). Still well inside G1's 24 h.
- Measured with `npm run measure:cpu` (DevTools profiler, an over-estimate): steady-state ticks
  4–9 ms, ticks that include an HTML page (Deno pricing, Redis licences) 12–16 ms, first catalog
  sync about 55 ms once, daily run afterwards about 2 ms.

### Sources
- R2 holds the **normalised** body of each snapshot (`snap/<sha256>`, gzip), not the raw
  response; otherwise every poll would write a new body. GitHub licence texts are kept as
  `license/<git blob sha>`.
- Pages send `Accept: text/markdown` first. Cloudflare docs, Vercel docs and Supabase answer
  with Markdown; the CSS selector then does not apply (front matter is stripped). HTML is
  streamed into HTMLRewriter and parsing stops when a unique selector (`main`, `article`, `#id`)
  closes. Each HTML text node becomes its own line, so sentences split at inline tags; the
  quote check must normalise whitespace (it does per SPEC §7.3).
- The 200 KB cap applies to extracted text; raw HTML is capped at 5 MB. Feeds are read up to
  1 MB (newest items first; Vercel's Atom feed is 3.7 MB).
- The first poll of a source is a baseline and creates no events, except the EOL 90-day reminder.
  More than 25 new feed items at once means the feed's IDs changed: re-baseline, no events.
- A GitHub poll is two API calls (repo, then a conditional licence call). Set `GITHUB_TOKEN` in
  production; unauthenticated GitHub allows 60 requests per hour.
- PyPI "deprecated" means the `Development Status :: 7 - Inactive` classifier, or the release
  that was latest at the previous poll is now fully yanked (read from `releases`; `info` always
  describes the latest non-yanked release). PEP 792 project status is only in the Simple API
  and is not checked.
- A GitHub transfer is an event of kind `other`.
- All outbound requests time out after 20 s.

- The daily cron runs at **06:07** (SPEC: 06:00), off the 5-minute grid, so pruning never
  overlaps a tick. Pruning also keeps any body referenced in the last 24 h.
- Changing a page's selector, `exclude` or `ignore` in the catalog re-baselines that source
  (clears `etag`, `last_modified`, `last_sha`) instead of producing a fake diff.
- `wrangler.jsonc` has a build command that generates `src/catalog/catalog.gen.json`, so a
  plain `wrangler dev`/`deploy` always ships the current catalog.

### Events (what M2 receives)
- Every M1 event has `status = pending_llm`.
- Deterministic events (npm/PyPI licence and deprecation, GitHub archived/licence/transfer, EOL
  set, moved earlier or within 90 days) have a real `kind` and title, `before_text`/`after_text`
  where useful, and `quote` only when the source has verbatim text (npm deprecation message).
- New feed items: `kind = other`, `title` = post title, `quote_url` = post link, `after_text` =
  the feed's item text (up to 8 KB; may be only an excerpt).
- Page diffs: `kind = other`, `title = "Page changed: <url>"`, `before_text`/`after_text` =
  changed lines with 2 lines of context, separated by `…`.
- `dedupe_key` = sha256(catalog_id or `source:<id>`, kind, normalised title). Raw feed and page
  events use a per-item key; M2 must recompute the semantic key after classifying.
  Transitions that can recur (licence A → B, deprecated, archived, transferred) add the month of
  detection to the key, so the same transition months later is a new event.
- `events.catalog_id` is set when exactly one catalog entry uses the source.

### Schema additions beyond SPEC §6
`catalog`, `catalog_sources` (per-entry feed `filter`), `robots`; `sources.last_sha`,
`last_state`, `block_strikes`, `last_error`; `events.catalog_id`; `jobs.payload`, `dedupe_key`,
`parked_at`.

### Tooling
- Tests use `@cloudflare/vitest-plugin` (the renamed `@cloudflare/vitest-pool-workers`) with
  Vitest 4.1. `.npmrc` sets `legacy-peer-deps` to work around an npm 10 resolver bug.
- `npm run poll -- <source-id|catalog-id|kind:key|--all> [--show] [--json]` runs inside
  `wrangler dev` with persistent local state (`.wrangler/state`) via dev-only `/__dev` routes
  (enabled by `DEV_ROUTES=1`, localhost only). `GITHUB_TOKEN` in the environment is passed through.
- Not built yet: the Node entry point (`src/node.ts`, SPEC §4.3).

### Sources that block automated fetches
- hashicorp.com (blog feed, licence FAQ): Vercel Security Checkpoint, even on robots.txt.
- github.com `*.atom` (release feeds): disallowed by robots.txt; not in the catalog.

## Before M2 (2026-10-10)
- **LLM: Haiku with Opus for high-stakes notes** (owner's decision, cost). Classify: Haiku 5.5.
  Summarise: Haiku 5.5, except notes for `license`, `eol` and `acquisition`, which use Opus 5.5.
  Each is its own setting, so moving a step is config only. The golden set decides whether the
  split holds. Estimated LLM cost: about $0.50/month now, about $2 at 40+ entries (all-Opus
  would be $3–5 and $12–20). The review gate (quote found verbatim, confidence ≥ 0.9,
  deterministic kinds only) keeps auto-published notes correct.
- **Positioning: services first** (2026-10-10). Package licence/deprecation alerts are easy for
  GitHub, Snyk or Socket to copy, so they are not the selling point. SPEC §2 now has a
  Positioning section; §7.1 and the M3/M5 rows make the service picker the main onboarding path
  (repo import pre-fills it) and weight catalog growth toward hosted services.
