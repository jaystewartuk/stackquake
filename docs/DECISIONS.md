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

## M2: event pipeline (2026-10-10)

### LLM
- **Model split as decided before M2**, each step its own setting (wrangler vars):
  `LLM_MODEL_CLASSIFY` and `LLM_MODEL_SUMMARISE` = `claude-haiku-5-5`,
  `LLM_MODEL_SUMMARISE_HIGH` = `claude-opus-5-5` for `license`, `eol` and `acquisition` notes.
  Effort is explicit: `low` for classify, `medium` for summarise. Adaptive thinking (the
  default on both) is sent explicitly. `fallbacks: "default"` (beta
  `server-side-fallback-2026-07-01`) only on Opus; Haiku 5.5 has no server-side fallback.
- **Which model writes a note.** When the kind is known before summarising (deterministic
  events, classified feed items) and is high-stakes, the note goes straight to the high-stakes
  model instead of Haiku first: the Haiku call would always be thrown away. Haiku runs first
  only when the kind is not yet known (page diffs, and posts classified as a lower-stakes
  kind); if its material note turns out high-stakes, the note is written again on the
  high-stakes model.
- **SDK kept.** `@anthropic-ai/sdk` 0.133 adds no measurable CPU per tick: pipeline ticks
  (classify, summarise, both through the SDK's request and response handling against a local
  stub) measured 3.0 to 6.7 ms. Bundle: 214 KB gzipped.
- Structured outputs for both calls; every output is also checked in code (`src/llm/schemas.ts`)
  for what the API schema cannot say (confidence in 0..1, `YYYY-MM[-DD]` dates). Invalid output
  or `max_tokens` is retried; API errors are retried by the job runner. After 4 attempts the
  event goes to `pending_review` with the reason. `stop_reason: "refusal"` goes straight to
  `pending_review`, never retried.
- Prompt caching: the system prompt (about 1,300 tokens, above the 512-token minimum) and the
  product context are separate cached blocks; the fetched text comes last, inside tags, and the
  system prompt says it is untrusted data.
- Every call writes `llm_calls` (purpose, model, tokens including cache reads and writes, cost,
  event, outcome). Prices are in `src/llm/llm.ts`; when a fallback served part of a request,
  each model in `usage.iterations` is priced at its own rate. The weekly budget guard (SPEC
  §7.4) is M4 work, as SPEC §12 places it.

### Deviations in the LLM output shapes
- `applies_when` is `{hosting: [...], use: [...], tier: [...]}` (empty list = any) instead of
  free-form JSON: structured outputs need closed objects, and lists of enums are easy to
  match against `deps.profile` in M4.
- The summarise output adds `kind`, `confidence` and `material` to SPEC §7.4's shape; options
  carry a `name` and a nullable `catalog_id` (so "pin the current version" can be an option).
- A feed item the classifier passed but whose note says `material: false` and kind `other` is
  rejected (a second opinion), like a non-material page diff. SPEC only rejects page diffs.
- Effective dates may be `YYYY-MM` when the source only gives a month ("another year").
- Confidence rubric in the prompt: it is about what the note claims, not what the source leaves
  out (that goes in `uncertain`). Without this, Opus scored explicit announcements and even a
  registry licence change at 0.85 to 0.88, below the 0.9 auto-publish bar.
- When a source announces several changes, the note covers the one that affects most users of
  the product (Deno: the runtime, not Deno Deploy).

### Pipeline
- New job kinds `fetch_post`, `classify`, `summarise`. A new event queues its first step when it
  is recorded (feed → `fetch_post`, everything else → `summarise`); the daily run re-queues any
  `pending_llm` event that lost its job. Each step checks the event is still `pending_llm` first,
  writes its result, then queues the next step, so retries and duplicate jobs do nothing.
- Gate tokens: one LLM step per tick (`#llm`); `summarise` also takes `HEAVY` (quote check over
  up to 200 KB); `fetch_post` takes the post's host and `HEAVY`.
- `fetch_post` runs when the feed's text is under 2,000 characters. Markdown first, then the
  HTML's `article`, `main` or `body`; robots.txt and our User-Agent as for every fetch. The text
  is stored as `post/<sha256>` in R2. If the post is blocked or keeps failing, the pipeline
  carries on with the feed text and says so in `review_reason`.
- Classify gets the first 24,000 characters (about 6k tokens) of the post. The feed's own
  publication date is not stored, so the prompt gives the date first seen.
- **Quote check** (`src/pipeline/quote.ts`): the quote must appear in the event's stored source
  texts (post, both page snapshots, or the registry field text) after removing all whitespace,
  unifying typographic quotes and dashes, and dropping Markdown links, emphasis and list or
  heading markers. Whitespace is removed entirely, not just collapsed, because HTML extraction
  splits "See <a>docs</a>." into "See \ndocs\n.". Quotes under 8 characters never count.
- Registry events: `archived` and repository transfers now carry the field text
  (`"archived": true`, `"full_name": …`) so they have something to quote. Registry events keep
  their detected kind; the note can only refine `other`.
- **Semantic dedupe** (`src/pipeline/dedupe.ts`): feed and page events get a new dedupe key
  from (catalog entry, kind, normalised title) after classify (post title) and after summarise
  (note title). On a collision the newer event becomes `rejected` with `duplicate_of` set; if
  the older one arrives second and the holder is not published, they swap (the holder's key
  becomes `dup:<id>`). Registry events keep their M1 keys, which already dedupe npm against
  GitHub; a blog post and a registry event about the same change are not merged.
- Page-diff events store both snapshot keys in `events.source_keys`. Snapshot pruning can in
  principle remove them later; by then the event has long been summarised.

### Admin
- `/admin` is off unless `ADMIN_TOKEN` (at least 16 characters) is set. Login sets a signed
  session cookie (HMAC with the token, 7 days, HttpOnly, Secure, SameSite=Strict,
  Path=/admin); every form carries a CSRF token derived from the session. Hono JSX escapes all
  text; source links render only for http(s) URLs.
- Approve needs a note and a quote (refused or failed events must be edited first). Edit saves
  the fields and publishes; the quote check is re-run and stored, but a person's approval can
  publish a quote that is not found (SPEC: never *auto*-published).

### Catalog
- Bitwarden gets its forum's announcements feed
  (`community.bitwarden.com/c/announcements/72.rss`): the 2026-10-09 licence change was posted
  there, not on the blog. The forum served our bot this time.

### Golden set and eval
- `testdata/golden/` (see its README): 13 cases, the 8 required by SPEC §11 (case 8 as 5 posts)
  plus one: the Cloudflare Observability post, first picked as a routine post, moves existing
  Workers logs to volume-based pricing from 2026-12-01. The classifier caught it; the label was
  wrong.
- `npm run eval` replays each case through the real watchers and steps (only HTTP is a fixture)
  against the live model, inside workerd like the tests.
- Results with the default split: passed in 5 of 6 runs (before the multi-change rule, one run
  dated the Deno note 2027-04, the Deno Deploy shutdown; 2 of 2 runs after it passed). Every
  run: no false positive among the 7 no-event cases, every deal change found with the right
  kind, every quote found verbatim; precision and recall 1.00 for each kind.
  About $0.09 per run (Opus notes are $0.011 to $0.05 each, 90% of the cost).
- All-Haiku (`LLM_MODEL_SUMMARISE_HIGH=claude-haiku-5-5`), 3 runs: same detection and quotes;
  one run's npm licence note scored 0.80, so it waited for review instead of auto-publishing
  (the safe failure). About $0.009 per run. Notes read about as well as Opus's; Opus's were
  slightly fuller (for example Bitwarden's direct downloads), not more correct. **Opus is not
  measurably better on this set.** It costs about $0.03 per high-stakes note, so at a few such
  notes a month it is under $1; keep it for now and revisit with more high-stakes cases.
- Eval spend while building M2: about $0.70.

### CPU (`npm run measure:cpu`, two runs, profiler estimate)
- Pipeline ticks (fetch_post with a 66 KB HTML post, extract_diff, classify, summarise against
  local stubs): 3.0 to 6.7 ms.
- Steady-state poll ticks are unchanged from M1 (same script on `main`): median about 6 ms,
  ticks with an HTML page or a large feed 11 to 21 ms on both branches (M1 recorded 12 to
  16 ms). This is the existing M1 risk, not new: watch `exceededCpu` after deploy (M5) and move
  to Workers Paid if it passes 1% of invocations.
- First daily run (catalog sync of 10 entries, 43 sources) about 45 ms, once.
