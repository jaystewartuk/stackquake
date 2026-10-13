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
- Results with the default split, after the confidence rubric: 5 of 6 runs passed (before the
  multi-change rule, one run dated the Deno note 2027-04, the Deno Deploy shutdown; 2 of 2
  runs after it passed). Every one of those runs: no false positive among the 7 no-event cases, every deal change found with the right
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

## M3: web app (2026-10-10)

### Auth and sessions
- **Sessions**: a random 32-byte cookie (`sq_session`, HttpOnly, Secure, SameSite=Lax, Path=/,
  30 days, fixed expiry). D1 stores only its sha256, so a database leak gives no live sessions.
  Sign-in replaces any existing session; sign-out deletes the row.
- **CSRF**: every POST needs `_csrf`. Signed in: the first 32 hex characters of
  sha256("csrf:" + session token), so nothing extra is stored. Before sign-in: a double-submit
  cookie (`sq_csrf`). A POST whose `Origin` header names another origin is refused as well.
- **Magic links**: 32 random bytes, sha256 at rest, 15 minutes, single use (one
  `UPDATE … WHERE used_at IS NULL … RETURNING` claims the link). Opening the link shows a button
  that POSTs the token, so mail scanners that prefetch links cannot use it up. Rate limits: 5 per
  email and 20 per IP per hour, fixed windows in a `rate_limits` table; both are counted on every
  request. The same links confirm an email change (`magic_links.user_id` set).
- **Link origin**: `APP_ORIGIN` if set, else the request origin on localhost, else
  `https://stackquake.com`. Never the Host header of a production request (link-poisoning).
- **GitHub OAuth**: scope `read:user user:email`, `state` in a 10-minute cookie scoped to
  `/auth/github`. Accounts are found by GitHub id first, then linked by the primary verified email
  (GitHub noreply addresses are ignored: they receive no mail). Hidden until `GITHUB_CLIENT_ID`
  and `GITHUB_CLIENT_SECRET` are set; the OAuth app is created in M5 with the deploy (the owner
  provides the id and secret then). Tests use a mocked GitHub.
- **/admin** is for signed-in users whose email is in `ADMIN_EMAILS`; everyone else gets a 404.
  `ADMIN_TOKEN` is gone. New admin views: blocked/failing sources with parked jobs, and catalog
  requests grouped by text.
- **Mailer** port (`src/ports.ts`): `ConsoleMailer` in Workers for now (magic links show up in the
  `wrangler dev` log), `MemoryMailer` in tests. Resend arrives in M4/M5.

### Data model (deviations from SPEC §6)
- `deps.dep_key` (`catalog:<id>`, `<ecosystem>:<package>`, `eol:<product>`) with
  UNIQUE(project_id, dep_key) replaces UNIQUE(project_id, catalog_id, ecosystem, package): SQLite
  treats NULLs as distinct, so the SPEC's key would not deduplicate.
- Also added: `deps.rank` (package importance), `deps.found_in` (manifest paths),
  `deps.created_at`, `sessions.created_at`, `magic_links.user_id/created_at`, and the tables
  `imports`, `rate_limits`, `catalog_requests`.
- A runtime the catalog covers (Node.js from `.nvmrc`, Redis from a compose image) is stored on
  that catalog dep (`eol_product`, `eol_cycle`), so the dashboard shows one "Node.js · version
  20" row. Runtimes the catalog does not cover are `eol` deps of their own.
- **dep_sources is the single source of truth** for what a dep watches: a catalog dep links all
  of its entry's sources (kept in step by `syncCatalog` when an entry changes), plus its own EOL
  cycle source; a package dep links its registry source. M4's fan-out can join dep_sources only.
- Sources created for users' deps have `config.origin = "user"`. The daily run disables them once
  no dep links them; catalog sources that a dep still links are no longer disabled by
  `syncCatalog`.
- EOL sources are per product and cycle (`nodejs@20`), as SPEC §5 says; catalog entries keep their
  product-wide EOL source too.
- Account deletion removes the user, sessions, projects, deps, links, imports (and their jobs),
  catalog requests and magic links. Alerts and channels arrive in M4 and must be added to it.

### Usage profiles
- Stored as `{hosting?, use?, tier?}`, the same dimensions and values as M2's `applies_when`; a
  missing key is unknown.
- `usage_questions` tokens map to questions: `hosted` or `self_hosted` → "hosted or
  self-hosted?", `commercial` → "commercial or personal?", `tier` → "free tier or paid?".
  Packages and runtimes outside the catalog get "commercial or personal?" only.
- A dep's effective profile is its own answer, else the project's default, for the questions that
  apply to it; everything else is unknown.
- `matchProfile` (for M4, tested for all 27 profile combinations): every dimension the event
  restricts must contain the profile's value. A known value outside the list makes the result
  `not_affected`, which beats an unknown dimension. Otherwise an unanswered restricted dimension
  gives `unknown` (fan-out treats it as affected), else `affected`.

### Picker (onboarding, SPEC §2 Positioning)
- `/app/projects/new` leads with "Pick services". Repo import is the second field on the same
  form, and its result opens the picker with the found entries ticked.
- Grouped by category (catalog `category`, now validated against a fixed list), `common: true`
  first. Search by name, id or alias: server-side via `?q=`, and a 10-line inline script filters
  as you type. That script and the import page's `<meta refresh>` are the only client-side code
  (no htmx).
- The form posts the ids it showed (`shown`), so a filtered page never unticks entries it did not
  display. Free text that exactly matches a name or alias adds that entry; anything else becomes a
  `catalog_requests` row (admin view) and is not watched.
- Saving goes to one page of usage questions for every ticked entry that has any, with "Project
  default (…)" preselected; "Skip" is a link.
- **Click path with no repo (under 60 s)**: on the landing page, "Pick what you run on"; sign in
  (email → open link → "Sign in", or "Sign in with GitHub" once configured); "Pick services";
  tick 4–6 entries, typing to filter; "Save and continue"; "Save" or "Skip" on usage. That is
  about 10 clicks plus the email round trip, and the dashboard then shows the stack grouped by
  risk. `test/webapp.test.ts` walks this path.

### Repo import
- **A job, advanced by the progress page.** `imports` holds a small state machine (repo → tree
  (once or twice) → fetch → rank → write). The progress page runs one step per load and refreshes
  every second (`<meta refresh>`, so no JS is needed); the same step is also a job kind (`import`)
  on the runner, which finishes an import whose page was closed, one step per 5-minute tick
  (`HEAVY` token). A lock on the job row (`claimImportJob`) keeps a page load and a tick from
  running the same step. Inline in the request rather than in `waitUntil`: the CPU budget is the
  same, and the page can show the new state at once. A step that keeps killing its invocation
  fails the import after 3 claims instead of spinning.
- Measured: the fixture monorepo imports in 6 page loads; `t3-oss/create-t3-turbo` (live) took
  6 loads and 8 s from paste to picker, refresh waits included. G4 holds.
- **Discovery**: GitHub REST (repo, then non-recursive trees by sha), never the recursive tree,
  whose JSON for a big repo costs more CPU to parse than a whole step may use. It reads the root
  and one level down (SPEC §7.1), plus one more level inside workspace containers (`apps/`,
  `packages/`, `services/` and similar) and `.github/workflows/`. Skipped: `docs`, `examples`,
  `test(s)`, `fixtures`, `node_modules`, `vendor`, build output and other dot-directories. At most
  24 directory listings per step, two listing rounds and 3,000 paths.
- **Manifests**: up to 30, shallowest first, each at most 512 KB, from `raw.githubusercontent.com`
  (it does not count against the API rate limit). Parsers are small line-based readers for every
  file in §7.1. Files that only matter by presence (`wrangler.*`, `vercel.json`, `fly.toml`,
  `netlify.toml`, `render.yaml`, `supabase/config.toml`, `bun.lockb`) are matched by `detect.files`
  and not fetched. `detect` gains `docker` (image names) and `terraform` (provider sources) keys,
  plus `*` globs and directory patterns (`.github/workflows/`).
- **Mapping**: catalog matches use dev dependencies too (`wrangler` is usually one). Packages are
  direct, non-dev, not workspace-internal (by the workspace's own package names), and not covered
  by a catalog entry. Runtime cycles come only from exact pins (`.nvmrc`, `.python-version`,
  Docker tags, `go` directives, Pipfile); ranges like `engines.node >=18` give the product without
  a cycle. With several cycles of one runtime, the oldest wins (it reaches EOL first).
- **Ranking**: npm weekly downloads (bulk endpoint for unscoped names, one call each for up to 20
  scoped ones), then manifest order; only when there are more than 25 packages. PyPI has no
  downloads API, so PyPI packages keep manifest order after ranked npm ones. The top 25 are shown;
  the rest go under "Also watching N more packages".
- **Limits**: 150 watched packages per project (each is an npm/PyPI poll every 6 h). Go, crates,
  gem and composer packages are stored and shown as "not watched yet": M1 has no such source kind.
  GitHub repo sources for packages are not created yet (the npm poll already records
  `repository`; M5 can link them).
- A re-import deletes deps that import added and the repo no longer has; deps the user added by
  hand stay.
- Real repo checked: **t3-oss/create-t3-turbo** (pnpm monorepo: `apps/*`, `packages/*`,
  `tooling/*`). Result: GitHub Actions, Node.js (version 22, from `.nvmrc`), and 48 npm packages
  (zod, react, next, drizzle-orm, expo, trpc…), 25 shown and 23 under "also watching". `catalog:`
  version specs (pnpm catalogs) are stored without a version.
- Unauthenticated GitHub allows 60 requests an hour, about 5 imports; `GITHUB_TOKEN` (already a
  secret for the watchers) is used when set. The GitHub App (M5) replaces it.

### Dashboard and pages
- Risk groups, in order: changed recently (a published event within 90 days), archived or
  deprecated (GitHub `archived`, npm `deprecated`, PyPI inactive), no licence (packages only,
  once polled), single vendor (new catalog flag `single_vendor`), no known risk. Each dep shows
  its latest published event. Loading a dashboard takes 4 queries however many projects.
- Public: `/`, `/catalog` (`?q=` search), `/catalog/{id}` (recent events, what we watch,
  alternatives), `/events` (paged by publication time), `/events/{id}` (note, quote, source link,
  "Summary, not legal advice; read the source."), `/events.rss`. Only `published` events are
  queried. Signed-in pages send `Cache-Control: private, no-store`; every page sends nosniff,
  `X-Frame-Options: DENY` and a strict referrer policy.
- `/pricing` and a real landing page are M6.

### D1 and Free-plan limits found while building
- D1 allows 100 bound parameters per statement. Bulk writes (deps, sources, links, poll jobs)
  pass rows as one JSON parameter expanded with `json_each`: one statement per table however
  many rows, which also keeps a step well under the per-invocation query limit. A 150-package
  import failed on an `IN (…)` read-back before this; `test/import.test.ts` covers it now.
- `scripts/build-catalog.mjs` now writes `catalog.gen.json` only when it changes. `wrangler dev`
  runs it on every rebuild and watches the file, so it reloaded in a loop and killed in-flight
  requests (an M1 bug that only shows with a long-running `wrangler dev`).
- `npm run poll` passes `GITHUB_TOKEN` as `--var`: wrangler ignores the process environment when
  `.dev.vars` exists, so GitHub sources were rate-limited during catalog work.

### CPU (`npm run measure:cpu`, profiler estimate, which over-states)
- Web requests: every page and every import step stays under 8 ms. Dashboard and project page
  (two imported projects, one with 150 packages; 46 KB of HTML) 2.3–3.0 ms; picker 1.4–1.7 ms; dep page 1.3–1.5 ms;
  public pages 0.8–2.4 ms. Import steps 2.8–4.8 ms, except the write step for 150 packages,
  7.9 ms; the write for the fixture monorepo is 4.9 ms. Creating the project 1.4–2.3 ms.
- **Catalog growth raised poll CPU.** Most new sources answer Markdown or are APIs, but a few
  marketing pages are large HTML with no Markdown answer and measured 45–120 ms per poll:
  heroku.com/pricing, docker.com/pricing, firebase.google.com/pricing, the Twilio email-API page
  and aws.amazon.com/lambda/pricing. On the Free plan those polls would be killed every time,
  parked after 6 claims and revived daily, so they were replaced with Markdown docs pages or
  dropped (see "Catalog" below).
- After that, the worst polls are still over 10 ms on a full fetch: sentry.io/pricing,
  twilio.com pricing, posthog.com/pricing and the Fly.io feed at 25–60 ms; Deno, Bitwarden and
  PlanetScale pricing at 17–26 ms. The same sources measured 6–10 ms in another run, when the
  server answered 304 or the profiler sampled differently. This is the M1 risk, now larger.
  **After deploy (M5), check `/admin/sources` for parked polls and `exceededCpu` in Workers
  analytics.** If marketing pages keep getting killed, either drop them or move to Workers Paid
  ($5/month), as SPEC §4.2 already plans.
- First daily run with 37 entries (149 sources): about 180 ms, once. Later daily runs about 3 ms.

### Catalog (37 entries, 27 new; mostly hosted services)
- New: Cloudflare D1, R2 and Workers AI, Netlify, Fly.io, Render, Railway, Neon, PlanetScale,
  Firebase, Heroku, AWS Lambda, Resend, Stripe, Clerk, Auth0, Sentry, PostHog, GitHub Actions,
  OpenAI API, Anthropic API, Python, PostgreSQL, Docker Desktop, MongoDB, Twilio and SendGrid.
  Every source was polled twice with no change. 26 of 37 are hosted services or APIs.
- Dropped or swapped sources: stripe.com/pricing redirects by visitor country, so the text
  depends on where the poll runs (dropped). mongodb.com/pricing renders no text without JS (the
  Atlas free-tier limits doc is watched instead). sendgrid.com/pricing redirects to a Twilio page.
  openai.com/api/pricing answers bots with 403 (developers.openai.com Markdown docs are watched
  instead). Heroku's changelog Atom answers 401. Clerk and Resend have no feed. PlanetScale's
  pricing page carries a "Generated at" timestamp, now ignored.
- Swapped or dropped for CPU (Free plan): heroku.com/pricing became the Dev Center "usage and
  billing" and "eco dyno hours" docs (Markdown); docker.com/pricing became docs.docker.com Hub
  pull limits; the Twilio email-API page became the SendGrid billing docs. firebase.google.com
  pricing and aws.amazon.com/lambda/pricing were dropped: there is no light page with the same
  prices. Each change has a YAML comment with the old URL.
- Detection was narrowed where it was too broad: AWS Lambda no longer matches any use of the
  Terraform AWS provider, or `template.yaml`. Docker Desktop still matches any Dockerfile or
  compose file; users untick it in the picker.

### Checks at the end of M3
- `npm test`: 179 tests pass; `tsc` is clean. `npm run eval` passes with 37 catalog entries
  (one run, $0.10).

## M4: alerts (2026-10-11)

### Data model (deviations from SPEC §6)
- `alerts` keeps SPEC's columns and UNIQUE(user_id, event_id), plus `created_at`, `match`
  (affected | unknown | not_affected), `because` (the "Affects you because" sentence, written
  at fan-out so it does not change when the profile does), `held` (why it waits for the digest:
  not_urgent | rate_limit | digest_only), `claimed_at` (took one of the 3 daily immediate
  slots), `emailed_at`, `slack_at`, `slack_try_at`, `digest_at`, `feedback_at`, `error`.
- `channel` is the route chosen at fan-out: `email` (immediate, plus Slack if connected),
  `slack` (immediate, Slack only: the user turned immediate email off), `digest` (held, and
  every suppressed alert). Delivery records each target separately, so one alert can go to both.
- `channels` adds `hint` (last 4 characters of the webhook URL, to show which one is connected),
  `created_at` and `last_error`. One Slack webhook per user.
- `users.email_immediate` (default on) is the per-user "digest only" switch;
  `users.last_digest_at` drives the first-digest-of-the-month rule.
- Job kinds `fanout`, `deliver` (payload `alertId`) and `digest` (payload `userId`, `day`).

### Fan-out
- Queued when an event is published: by the summarise step (auto-publish), and by the admin's
  approve and edit-and-publish. **Events published before M4 are not fanned out**: nothing is
  deployed yet (M5), and a user who adds a dep later sees its past events on the dep page, not
  as alerts. An admin edit of a published event re-runs fan-out; UNIQUE(user, event) means users
  who already have an alert get nothing new.
- Joins `events.source_id → dep_sources → deps → projects → users` (dep_sources only, as M3
  set up). Muted deps are skipped. The match is `matchProfile(applies_when, effectiveProfile(dep,
  project default, questionsFor(entry)))`; no second matcher.
- **One alert per user and event**, from the dep that matches best (affected > unknown >
  not_affected). A user whose deps straddle two chunks may first get a suppressed alert; a later
  affected dep upgrades it, unless a digest already carried it.
- **Chunked**: 200 deps per step, ordered by dep id, the cursor kept in the job's payload; the
  job reschedules itself until done. Alert rows are written with one `json_each` INSERT per
  chunk (`ON CONFLICT … DO UPDATE … WHERE`), then deliver jobs are queued with one INSERT … SELECT
  over the event's queued immediate alerts (idempotent; the daily run repeats it as a repair).
- **Shared feeds**: an event from a feed several catalog entries use (the Cloudflare blog: Workers,
  D1, R2, Workers AI) has no `catalog_id`. A catalog dep then only matches if its entry's feed
  `filter` keywords appear in the event's title, note or quote, so R2 users do not hear about
  every D1 post. Without this, every shared-feed event alerted every entry's users.

### Urgency and rate limit (SPEC §7.5)
- Immediate: `license`, `free_tier`, `eol` whose effective date is within 180 days or past (a
  `YYYY-MM` date counts from the 1st, the earliest it can mean; no date → digest), and
  `acquisition` when the note or quote says the service ends (shut down, sunset, discontinued,
  end of life/service/support, wind down, will end/stop/close, no longer available…). The note
  has no end-of-service field; a regex over its text avoids changing the summarise schema and
  re-running the golden set. Everything else waits for the digest.
- **Rate limit: 3 immediate alerts per user in any 24 hours** (rolling, not calendar day), checked
  at delivery with one atomic `UPDATE … WHERE (SELECT count(*) … claimed_at > now − 24 h) < 3`,
  so concurrent deliveries for one user cannot both take the third slot. The 4th becomes
  `channel = digest, held = rate_limit`. A user who turned immediate email off and has no Slack
  gets `held = digest_only` at fan-out (or at delivery, if they switched since).

### Delivery: never twice
- One `deliver` job per immediate alert. Email and Slack each record their own timestamp, so a
  retry skips what already went out.
- **Email** sends `Idempotency-Key: alert-<id>` (digests `digest-<user>-<date>`, budget mails
  `budget-<date>-<admin>`). If the invocation dies after Resend accepted the email but before
  `emailed_at` is written, the retry reuses the key and Resend does not send again (24-hour
  window; the runner's backoff totals about 15 hours). A 409 about the key counts as sent.
  429 and 5xx are retried by the runner; other 4xx mark the alert `failed` with the error.
- **Slack** has no idempotency key. `slack_try_at` is written before the POST; a definite failure
  clears it (safe to retry), so a set `slack_try_at` without `slack_at` means the invocation
  died mid-post, and it is **not repeated** (at most once). Slack 4xx (`no_service`,
  `channel_not_found`…) is permanent and stored on the channel as `last_error`; 429/5xx retry.
- An event rejected by the admin after publishing is not delivered (`failed`, "event withdrawn").
- Resend's free tier allows 100 emails a day. Above that, sends fail with 429, are retried for
  about 15 hours and then parked (visible on `/admin/sources`). At the predicted volume (under
  20 events a week, at most 3 immediate alerts per user per day) this is far off; the fix when it
  is not is a paid Resend plan, not code.

### Email and Slack content
- Subject `[Stackquake] {name}: {title}`, where the name is what the user calls the dep (catalog
  entry or package name). Plain-text and HTML parts. Sections in order: title, what changed, the
  quote (blockquote) with its link, takes effect, "Affects you because: …" (or "We don't know how
  you use X, so we assume it does."), not affected, options, what the source doesn't say, "Summary,
  not legal advice; read the source.", then the three one-click links, the full note and email
  settings. All note and source text is HTML-escaped; links render only for http(s).
- Immediate alert emails carry a signed "Only send me the weekly digest" link, also as a
  `List-Unsubscribe` header. No `List-Unsubscribe-Post` (RFC 8058 one-click): it POSTs without our
  CSRF token, and the bulk-sender rules that require it start at 5,000 emails a day.
- Slack: Block Kit (header, what changed, quote with a Source link, affects you, options, a
  context line with the disclaimer and mrkdwn links). Links, not buttons: buttons in an incoming
  webhook message need an app with interactivity. Text is escaped (`&`, `<`, `>`), so a note
  cannot ping `<!channel>`.
- Sender: `MAIL_FROM`, default `Stackquake <alerts@stackquake.com>`. Until stackquake.com's DNS
  records exist (M5), Resend only delivers from `onboarding@resend.dev` to the account owner.

### Signed one-click links
- `/a/{token}`, token = `{u|n|m|d}{id}.{expiry, base-36 seconds}.{HMAC-SHA256}` with the
  `LINK_SECRET` Worker secret: useful, not relevant, mute (alert ids) and digest only (user id).
  30-day expiry. GET shows what will happen and a button; only the POST acts (mail scanners and
  Slack's unfurler fetch links). No sign-in needed: the signature is the authorisation. The POST
  still needs the pre-sign-in CSRF cookie the GET set.
- Without `LINK_SECRET`, alerts go out without the links. Set it in every deployed environment (M5).
- Signed-in users have the same "Useful" / "Not relevant" buttons on the dashboard and dep page
  (`POST /app/alerts/:id/feedback`, scoped to their own alerts).

### Slack channels
- Only `https://hooks.slack.com/services/T…/B…/…` is accepted: exact host, https, no port,
  userinfo, query or fragment, and a path of Slack ids; the stored URL is rebuilt from the parsed
  path. Fetched with `redirect: "manual"`. This is the one place user input becomes a fetch
  target (SPEC §8 SSRF). A test message must succeed before the webhook is saved.
- Encrypted at rest with AES-GCM (`CHANNEL_KEY` secret, 32 bytes base64, random 12-byte IV,
  stored as `v1:` + base64(iv‖ciphertext)). Without `CHANNEL_KEY` the Slack section says it is
  unavailable.
- Slack only gets immediate alerts, not the digest. SPEC §10 puts Slack on the Team plan; M4
  offers it to everyone and M6 enforces plan limits.

### Weekly digest
- The daily run (06:07 UTC) queues a `digest` job for each user whose `digest_day` is today in
  UTC (no time zones yet). The digest carries the user's held alerts and the alerts suppressed
  since the last digest that went out ("N changes we watched that don't affect you", up to 10
  listed).
- **Send rule**: send if anything affects the user, or if no digest has gone out yet this calendar
  month ("all quiet"). A week with only suppressed changes sends nothing; those changes wait for
  the next digest that goes out. (SPEC scenario 4's "no changes that affect you, 3 that don't" is
  therefore the monthly one.)
- Idempotent: the step first stamps the alerts it will carry with the digest's day (`digest_at`),
  so a retry renders the same set under the same Idempotency-Key; alerts that arrive meanwhile
  wait for next week. A skipped digest un-stamps them.

### LLM budget guard (SPEC §7.4)
- `LLM_WEEKLY_BUDGET_USD` (default $10). The daily run sums `llm_calls` over 7 days; above the
  budget it emails each `ADMIN_EMAILS` address (once a day, by Idempotency-Key). Above twice the
  budget, `classify` steps return a deferral of 6 hours (not a failure: attempts are given back,
  nothing is parked), checked after the step takes the LLM token so concurrent steps keep their
  order. `summarise` keeps running. `/admin` shows the 7-day cost against the budget, the paused
  state, and last week's alert counts and feedback (G3).

### Account deletion
- Also deletes the user's alerts, Slack channel, and their pending `deliver` and `digest` jobs.
  Deleting a project or dep keeps the user's alerts (shown as "removed dependency").

### Runner capacity (measured, then decided)
- **The HEAVY token was already oversubscribed before M4.** One HEAVY step per tick is 288 a
  day. The catalog's 35 feeds every 2 h are 420 polls a day and its 50 pages 50 more, all HEAVY,
  before any summarise, diff, post fetch or import step. Feeds were falling behind and every
  deferred HEAVY job wasted a claim. M5 grows the catalog further.
- **A second tick cron**, `3-58/5 * * * *` (minutes 3, 8, 13…, clear of the daily run at :07),
  next to `*/5`. Each Cron Trigger is its own invocation with its own 10 ms CPU budget and its own
  HEAVY token, so this doubles the runner on the Free plan with no code change beyond mapping the
  cron: 576 HEAVY slots and 1,728 general claims a day. Claims are atomic, so overlapping ticks
  never run a job twice. It uses 3 of the account's 5 Free-plan cron triggers. Checked
  2026-10-11: the account's only other Worker, `another-project`, uses 1 (`*/5`; the unused
  `another-project` and `another-worker` Workers were deleted the same day), so production Stackquake makes 4 of 5 and a
  staging Worker can have at most 1. If another Worker needs one, drop this cron and poll feeds
  every 4 h.
- **Feeds every 3 h** (was 2 h; SPEC says 1 h). Still 8× inside G1's 24 h. With both changes,
  catalog HEAVY polls are 280 + 50 = 330 a day of 576 (57%), leaving room for pipeline steps,
  imports and a 40-entry catalog in M5.
- **Alert jobs get their own allowance**: each tick claims up to `JOBS_PER_TICK` (3) jobs of
  other kinds, plus up to `ALERT_JOBS_PER_TICK` (**2**) fan-out, delivery or digest jobs. A burst
  of deliveries (one event, hundreds of affected users) neither waits behind polls nor pushes them
  back: 2 × 576 = 1,152 alert jobs a day. 2, not 3: with 3 general jobs (median 5 ms) plus 3
  alert jobs (about 1–2 ms each) a tick would sit near 10 ms.
- Not done: API polls (npm, PyPI, GitHub, endoflife.date) stay in the general allowance. Their
  CPU depends on the body (a full npm document for a big package is a large JSON.parse), so they
  are not "light" in the CPU sense, only in the politeness sense. Users' packages (up to 150 per
  imported project, 4 polls a day each) are the next capacity limit: roughly 1,200 package polls
  a day fit next to the catalog. Past that, poll packages every 12–24 h or move to Workers Paid,
  where JOBS_PER_TICK can be far higher.

### CPU (`npm run measure:cpu`, profiler estimate, which over-states)
- Seeded load: 450 users with Redis, one self-hosted licence change for every 50th (fan-out in 3
  chunks of 200, then 9 deliveries through a Resend stub) and a pricing change for all (held), then
  the digests of 5 users.
- Fan-out and delivery ticks: 4.2–9.0 ms (one chunk of 200 deps is about 2 ms; a delivery,
  including rendering, three HMAC links and the Resend call, about 1 ms; the 9.0 ms tick was two
  first chunks plus a delivery, in a run with 3 alert jobs per tick). Digest ticks (3 digests):
  4.4–5.4 ms. Daily run with digests queued and the budget check: 3.3–4.1 ms.
- Web: every page under 5 ms; the dashboard 2.7–4.9 ms (the measured user has no alerts; the
  alerts list is one query, capped at 30 rows).
- Unchanged risks from M1–M3: poll ticks median 5.8 ms, p90 14 ms, max 65 ms (marketing pages,
  as M3 recorded); one pipeline tick (post fetch plus two summarise steps) measured 16.8 ms this
  run against 3–7 ms in M2, so treat the profiler's single readings as noisy. The first daily run
  (catalog sync of 148 sources) about 150–175 ms, once. Check `exceededCpu` after deploy (M5).
- The measure script's poll phases now run until every source has been polled (they used to stop
  after 30 ticks and spill polls into the "pipeline" rows), and its web phase finds the imported
  project's id instead of assuming 2.

### Resend: one real email
- 2026-10-11: created a Resend API key `stackquake-dev` (sending access) in the owner's Resend
  account through Chrome, saved it to `.dev.vars` with `MAIL_FROM=Stackquake <onboarding@resend.dev>`,
  and sent the sample Deno alert with `POST /__dev/test-email` under `wrangler dev`. Resend's log
  shows it **Delivered** to user@example.com, subject "[Stackquake] Deno: Deno runtime development
  ends in about a year". Production needs its own key, restricted to stackquake.com, after the
  DNS records (M5).

### Checks at the end of M4
- `npm test`: 244 tests pass (65 new: E2, E3 and E4 end to end; the rate limit; urgency rules;
  signed-link expiry and tampering; mute; the digest send/skip rule; Slack URL validation;
  idempotent fan-out and delivery; chunking; shared-feed filters; Slack and Resend failures;
  settings, links and account deletion). `tsc` is clean.
- `npm run eval` passes with the pipeline changes (publish → fan-out, the classify budget check):
  one run, $0.099.
- Test helper fix: `testCtx({ http })` used to put the FixtureHttp object itself in `ctx.http`
  (no test had passed one before).

## M5: deploy, GitHub App, catalog to 59 (2026-10-11)

### Environments
- **Production** is the top level of `wrangler.jsonc` (`npm run deploy:production`): Worker
  `stackquake` on the custom domain **stackquake.com**, D1 `stackquake`, R2 `stackquake-snapshots`,
  the three cron triggers from M4. **Staging** is `env.staging` (`npm run deploy:staging`):
  `stackquake-staging` on **staging.stackquake.com**, its own D1 and R2, `APP_ORIGIN` set,
  `LLM_WEEKLY_BUDGET_USD=2`. `workers_dev` is off for both. `wrangler dev` and the tests use the
  top level with local D1/R2 (the real ids replace M1's placeholder; local state is unaffected).
- The deploy scripts run `tsc`, the tests and the remote migrations before `wrangler deploy`.
  Migrations are applied with `wrangler d1 migrations apply DB --remote [--env staging]`.
- No `www.` record yet (Cloudflare suggests one); add a redirect with the M6 landing page.

### Cron decision: staging has none
- The account has 5 Free-plan cron triggers: `another-project` 1, production 3. Staging could take the
  last one, but a second poller would fetch every vendor page twice and pay for every LLM note twice,
  and staging only needs the scheduler while someone is testing. So `env.staging.triggers.crons` is
  empty and **`/admin/staging`** (only when `STAGING_TOOLS=1`) runs a tick or the daily job on a
  button press, and adds a clearly-labelled sample free-tier event on a catalog entry's first source.
  Approving it on `/admin/events` runs the real fan-out and delivery path. The account keeps one
  trigger free.

### Secrets (names only; values never left the browser or the generator)
- Both Workers: `ANTHROPIC_API_KEY` (one key per environment, `stackquake-production` and
  `stackquake-staging` in the Anthropic Console, expiring 2027-10-10), `GITHUB_TOKEN` (fine-grained,
  public repositories read-only, one per environment, expiring 2027-10-10), `LINK_SECRET` and
  `CHANNEL_KEY` (generated fresh per environment), `ADMIN_EMAILS` (a secret so the owner's address
  stays out of the repo), `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` (OAuth app "Stackquake" and
  "Stackquake (staging)", one callback each), and the GitHub App's five (below).
  `RESEND_API_KEY`: see "Email".
- **Expiry dates to renew**: Anthropic keys and GitHub tokens on 2027-10-10. Nothing else expires.
- Secrets were moved by clipboard (`pbpaste | wrangler secret put`) or generated and piped, so none
  was printed in a terminal or chat.

### GitHub App (SPEC §4.1, §7.1, §8)
- Two apps, `stackquake` (public, installable by anyone) and `stackquake-staging` (private to the
  owner), created by `scripts/github-app-setup.mjs <env>` with GitHub's **manifest flow**: a local
  server is the manifest's redirect, redeems the one-time code and pipes the app's private key, client
  secret and webhook secret into `wrangler secret bulk`. No key file is downloaded. Permissions:
  contents read, metadata read; events: `push` (installation events always arrive). Webhook
  `/github/webhook`, callback `/app/github/callback`, setup URL `/app/github/connect` with "redirect on
  update".
- Secrets: `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID` (also the JWT issuer, so no app id is needed),
  `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` (GitHub's PKCS#1 PEM; wrapped to PKCS#8 in code
  because WebCrypto only imports PKCS#8), `GITHUB_WEBHOOK_SECRET`. All five or private import is hidden.
- **Which repos a user may import**: "Import a private repo" runs the app's own OAuth flow (instant
  once authorised), lists `/user/installations` and each installation's repositories with the
  user's token, and shows them. The user token is used in that one request and never stored. Each
  listed repo is a signed choice (HMAC with the app's client secret, bound to the user, 1 hour), so
  the form cannot name another installation's repo. Up to 5 installations and 100 repos each (MVP).
  With no installation, the page links to the app's install page, which comes back to the flow.
- **Installation tokens** (1 hour) are minted with an RS256 app JWT (iat −60 s, exp +8 min), asking
  only for contents and metadata read, cached in `github_installations` encrypted with
  `CHANNEL_KEY` (reusing `src/alerts/secretbox.ts`), and re-minted with under 10 minutes left. An
  import step resolves the token once. A 403/404 when minting means the app was removed: the import
  fails with "install it again". `installation.deleted` drops the row; `suspend` blocks minting.
- **Private imports** read manifests through the contents API (raw media type) with the installation
  token; the raw host is only for public repos. A private repo pasted as a public URL fails with a
  pointer to the GitHub App.
- **Push re-import**: a signed `push` to the default branch whose commits add, modify or remove a
  manifest (anything `parserFor` reads, or a catalog `detect.files` match) starts a re-import of
  every project with that repo **and** that installation, unless one is already running. A payload
  with 2,048 commits (GitHub's cap) is treated as touching a manifest. Bodies over 1 MB are
  acknowledged (202) without parsing: parsing them would not fit the CPU budget. Signatures are
  checked over the raw body with a constant-time compare.
- Plan limits (private repos on Team only, SPEC §10) are M6.
- Public imports and the watchers still use `GITHUB_TOKEN`: an installation token only exists for
  repos someone installed the app on.

### Email (Resend) and DNS on stackquake.com
- The owner approved each DNS change first; records were added by hand in the Cloudflare dashboard.
  Resend now does SPF and bounces through **CNAMEs**, not the MX/TXT pair of older guides:
  `send` → `send.forge.rmta.net` and `rsend` → `rsend.forge.rmta.net` (both DNS only), DKIM TXT
  `resend._domainkey`, and DMARC TXT `_dmarc` = `v=DMARC1; p=none;` (monitor only while the domain is
  new; move to `quarantine` once a few weeks of mail pass). Region us-east-1. Verified in about two
  minutes. The Worker custom domains added `stackquake.com` and `staging.stackquake.com` themselves.
- Resend keys `stackquake-production` and `stackquake-staging`: sending access, stackquake.com only.
  `MAIL_FROM` is unset on both Workers, so the default `Stackquake <alerts@stackquake.com>` applies.
  `.dev.vars` keeps the M4 dev key and `onboarding@resend.dev`.
- Resend's free plan allowed a second domain (project-h.example was already there).

### Staging end to end (2026-10-11, owner's inbox)
- Magic link from alerts@stackquake.com arrived in the inbox (owner inbox), sign-in worked.
- `/admin/staging` → daily job: catalog sync of 59 entries and 214 sources in one HTTP request,
  not killed by the CPU limit.
- Project "Staging check" with Cloudflare Workers (hosted, free tier) → sample free-tier event →
  approved → two manual ticks ran fan-out then delivery → alert `sent`, match `affected`. The email
  arrived in the inbox; its "Useful" and "Mute for 90 days" links both worked (`feedback = useful`,
  `muted_until` set). With the digest day set to Sunday, the daily job queued the digest and the
  next tick sent it (`last_digest_at` set).
- Slack was not connected (optional; the owner has no workspace webhook to test with).
- GitHub sign-in: both OAuth apps redirect with the right client and callback; an unsigned webhook
  gets 401 on both hosts. Installing the GitHub App on a real private repo was not done, because it
  grants read access to private code; the flow is covered by `test/github-app.test.ts` against a
  mocked GitHub.

### Catalog (59 entries, 22 new; 48 hosted services, APIs or runtimes)
- New: Cloudflare Pages, KV and Durable Objects, Amazon S3 and DynamoDB, Upstash, Turso, Azure
  Functions, Datadog, Grafana, Postmark; Go, Ruby, Java, PHP and Rust; Valkey, OpenTofu,
  Elasticsearch, OpenSearch, Kubernetes and HashiCorp Vault. Every source was polled twice with no
  change. 11 entries are self-hostable tools or infrastructure.
- HEAVY polls went from 306 to 372 a day (38 feeds × 8 + 68 pages) of 576. Cloudflare and AWS
  entries reuse feeds already watched; only six feeds were added (Datadog, Ruby, inside.java,
  php.net releases, Rust, Elastic). Runtimes, Valkey, OpenTofu, Kubernetes, OpenSearch and Vault use
  endoflife.date and GitHub sources only (not HEAVY).
- Docs pages that answer `Accept: text/markdown` replaced heavy marketing pages: AWS docs, Microsoft
  Learn, docs.datadoghq.com, Turso docs, upstash.com/docs, postmarkapp.com/pricing, grafana.com/docs.
  Not added (large HTML, no Markdown): the S3, Datadog, Elastic, Grafana and Turso pricing pages
  (100 KB–1.6 MB). Feeds not added for size: Upstash 447 KB, Go blog 350 KB, php.net all-news
  1.4 MB, kubernetes.io 1.1 MB, Azure updates 150 KB; the Grafana blog feed (134 KB) was dropped
  after a 25 ms tick. PyPI `ddtrace` is over 4 MB (detection only).
- No feed exists for valkey.io, opentofu.org, opensearch.org, Postmark or Turso. HashiCorp stays
  blocked (hashicorp.com Vercel checkpoint; developer.hashicorp.com is 120–260 KB HTML).
  blogs.oracle.com/java answers 403 (inside.java instead). Skipped for lack of a light source:
  1Password, Mailgun, Google Cloud Run, Gemini API, Home Assistant, Immich.
- Detection stays narrow: Cloudflare Pages only on `_routes.json` and `@cloudflare/next-on-pages`,
  Azure Functions on `host.json`, Kubernetes on `kustomization.yaml`, `skaffold.yaml` and
  `Chart.yaml`, OpenTofu on `*.tofu`.

### Competitor check
- `docs/COMPETITORS.md` (sources, accessed 2026-10-11). In short: none of Dependabot/GitHub, Snyk or
  Socket pushes an alert when an existing dependency's upstream licence changes; licence checks run
  at PR or scan time against allow/deny lists. Socket has a "Deprecated" alert (closest overlap);
  Snyk marks npm deprecation in its UI only; nobody alerts on archived repos (Scorecard scores them
  at PR time). Nothing covers hosted-service pricing, free tiers, terms, end of development or
  acquisitions. Its "Where Stackquake differs" bullets are drafts for the M6 landing page; a few
  quotes came through a summarising fetch and must be re-checked before they go public.

### CPU (`npm run measure:cpu`, 59 entries, profiler estimate, which over-states)
- Steady-state poll ticks: median 5.4 ms, p90 10.8 ms, max 52 ms; 16 of 107 ticks over 10 ms. First
  polls: median 6.7 ms, p90 16.4 ms, max 78 ms. The worst sources are the M3 ones, still:
  sentry.io/pricing (52–78 ms), the two Twilio pricing pages (31–67 ms), posthog.com/pricing, the
  MongoDB SSPL page, deno.com/deploy/pricing and neon.com/pricing (16–26 ms). New M5 sources sit in
  the 4–7 ms band (AWS, Microsoft Learn and Cloudflare docs) except feeds sharing a tick with one of
  those pages. Pipeline ticks max 17 ms (one tick), alert ticks 5.4 ms, digests 5.9 ms, every web
  page and import step under 6 ms. First daily run (catalog sync, 214 sources) 257 ms once; later
  daily runs 3.5 ms.
- On staging the same first sync ran inside one HTTP request (`/admin/staging`) and was **not**
  killed: the Free plan evidently tolerates occasional bursts over 10 ms. What matters is the rate
  of `exceededCpu` in production, not the profiler.
- `wrangler dev` now needs `--local-upstream`: with custom-domain routes in `wrangler.jsonc` it
  presents local requests as `https://stackquake.com/…`, which turned `/__dev` off (localhost only)
  and would have made local magic links point at production. `npm run dev`, `npm run poll` and
  `npm run measure:cpu` pass it.

### Production after deploy (first hours, 2026-10-11)
- Both tick crons fire: the dashboard's trigger list and the metrics show invocations at :00 and :03
  (and every 5 minutes after). First ~2 hours: 148 invocations, 0 errors, **0 "Exceeded CPU Time
  Limits"**, CPU P50 12.8 ms / P99 50 ms across versions (secret changes each create a version).
- **This is not yet the real test**: production's first catalog sync is the 06:07 UTC daily run, so
  the ticks so far had no polls to run. The few-days check (exceededCpu rate, parked polls on
  `/admin/sources`) and the Workers Paid decision move to the start of M6 (prompts/06-m6-launch.md,
  step 1). If more than 1% of invocations on any day exceed CPU, move to Workers Paid (SPEC §4.2);
  the first candidates to drop instead are sentry.io/pricing and the Twilio pricing pages.

### Checks at the end of M5
- `npm test`: 257 tests pass (13 new: app JWT and PKCS#1 wrapping, installation-token cache and
  expiry, webhook signatures, push re-import rules, installation removal and suspension, private
  import end to end with forged-choice refusal, staging tools end to end). `tsc` is clean.
- `npm run eval` passes with 59 catalog entries: one run, $0.099.
- Production is deployed on stackquake.com and not announced.

## M6: plans, billing, landing page (2026-10-11)

### Plans and limits (SPEC §10), all enforced server-side (`src/billing/plans.ts`)
- **Free**: 1 project, public repo import or the picker, email alerts, weekly digest. A second
  project is refused (402 page with an upgrade link) both when the form is opened and when it is
  posted. **Team**: unlimited projects, private repos through the GitHub App, Slack, up to 10
  people, CSV export (`/app/export.csv`).
- **Downgrade keeps everything and quiets the extra**: nothing is deleted. On Free only the owner's
  **oldest project alerts** (a fan-out condition, `projectAlertsSql`); the dashboard says which
  projects are quiet. Private-repo push re-imports stop (the webhook query requires Team), "Import
  again" on a private project is refused, a kept Slack channel gets nothing (delivery and fan-out
  require Team) and Settings says so. Without this, subscribe-create-cancel would keep unlimited
  projects for free.
- **Existing free users' Slack channels**: production had **no users** when M6 shipped (checked),
  staging one (the owner) with no Slack, so nobody lost anything. The rule above (kept but silent
  until Team) is what happens from now on.
- Plan checks without a request (fan-out, delivery, webhooks) use one SQL fragment,
  `teamPlanSql(userId)`: own plan is `team`, or an accepted membership of a Team owner's team.

### Teams ("up to 10 members"), as small as the plan needs
- A team is a Team user (the owner) plus accepted members: `team_members(owner_id, email,
  user_id, invited_at, joined_at)`. 10 people including the owner, so 9 invites (pending ones count).
- **Invite by email, accept by signing in**: the owner invites an address; the email links to
  `/app/team`, where a user signed in **with that address** (magic link or GitHub's verified email)
  sees Join/Decline. Signing in proves the address, so invites carry no token. 20 invites a day per
  owner.
- Members **see and edit the owner's projects**, and projects they create while in the team
  belong to the owner (that is what "shared projects" needs, and it keeps the Free limit about the
  payer). Their own earlier projects stay theirs. No roles: only the owner invites, removes and pays.
- **Alerts**: fan-out expands each dep to the project owner plus the team's members (only while
  the owner is on Team), one alert per user and event as before; each member's own email settings,
  rate limit, digest and Slack apply. A fan-out chunk is still 200 deps, picked first, then
  expanded (so a chunk can never cut a dep's recipients in half).
- One team per member. A user with their own Team subscription, or with members of their own,
  cannot join another team. A lapsed owner's membership rows stay, inactive, and come back with
  the subscription. Account deletion removes the user's team, memberships and invites, and cancels
  a Team subscription first (if Stripe refuses, nothing is deleted).

### Billing (Stripe, same pattern as Beckon)
- REST through `ctx.http`, no SDK (four endpoints and a signature check; the SDK would add bundle
  size and CPU). Checkout (subscription mode) on a customer created at first checkout and stored,
  so every subscription hangs off one customer; Customer Portal; the webhook at `/stripe/webhook`
  (no session or CSRF, mounted before the session middleware) is the **only writer of
  `users.plan`**.
- Webhook: `Stripe-Signature` checked over the raw body (HMAC-SHA256, constant-time, 5-minute
  tolerance); `checkout.session.completed` and `customer.subscription.created|updated|deleted`.
  **Idempotent by event id** (`stripe_events`): D1 has no interactive transactions, so the change
  is applied first and the id recorded after; every change is idempotent and ordered by the
  event's `created` (`users.plan_event_at`), so a retry after a crash re-applies the same values
  and an older event arriving late is ignored. A `deleted` for an old subscription does not undo a
  newer one. `incomplete` leaves the plan alone.
- **past_due keeps Team**; Stripe's own retry schedule (Billing settings) ends in cancellation,
  which the `deleted` event turns into Free. No grace-period job of our own.
- Prices: $19/month, $190/year, USD. Stripe Tax off (no registration). The account is UK-based,
  so payouts are in GBP.
- Secrets per environment: `STRIPE_SECRET_KEY` (restricted key: Customers, Checkout Sessions,
  Customer Portal and Subscriptions write, nothing else), `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`. All four or billing is off and pages say "Team
  opens soon".
- **Stripe account**: a new standalone account "Stackquake" (like Beckon's; the owner created it,
  agents may not create accounts). Test mode set up 2026-10-11 by API with the account's test key
  (moved by clipboard, deleted after): product "Stackquake Team" (`metadata.app=stackquake`,
  statement descriptor STACKQUAKE), prices with lookup keys `team_monthly`/`team_yearly`, webhook
  to staging, default Portal configuration (cancel at period end, switch monthly/yearly, card,
  invoices, address and tax id, links to /terms and /privacy). The restricted key
  `stackquake-staging-worker` was made in the dashboard.
- **Checked on staging against Stripe's test API**: Settings → "Team, $19/month" redirects to
  Checkout (the browser extension may not drive checkout.stripe.com, so no card was typed); a
  subscription created by API with `pm_card_visa` on that same customer arrived as a signed
  webhook and set Team (monthly, active, period end); `cancel_at_period_end` set the flag; the
  `deleted` event set Free. "Billing, invoices and cancelling" opens the Portal. Then the owner
  paid a real test Checkout with card 4242: `checkout.session.completed` set Team.
- **Bug found by that checkout, fixed**: Stripe creates the subscription (and its `created` event)
  before the session completes, so the checkout's later timestamp made `subscription.created`
  look stale; it was dropped and the interval and period end never saved. Checkout no longer moves
  `plan_event_at` (it still respects it: a checkout older than a `deleted` changes nothing).
  Beckon's `src/lib/billing.ts` has the same ordering logic and likely the same bug.
- **Live mode is not set up**: it needs the owner to activate the account (business and bank
  details) and approve the live product and prices. Then the same script and a live restricted key
  for production.

### Landing page, pricing, legal (SPEC §2 Positioning)
- `/` leads with services ("Pick what you run on"; "Or paste a repo" next to it), a static example
  alert (the real Deno quote), what we watch, the catalog's common entries, "Where it differs" with
  three competitor quotes **re-read on the live pages** (docs/COMPETITORS.md, "Re-check before
  launch"; GitHub's new PR-time licence-compliance preview noted there), and the plans.
- `/pricing`, `/terms`, `/privacy` (operator: Jay Stewart; contact support@stackquake.com), `/bot` (the
  User-Agent's URL had no page), `robots.txt`, `sitemap.xml` (catalog and up to 500 events).
  **The terms are a plain-language draft, not reviewed by a lawyer** (SPEC §14 Q5); have them
  reviewed before charging real customers.
- `www.stackquake.com` is a custom domain on the production Worker that answers 301 to the apex
  (owner approved). `hello@stackquake.com` forwards to the owner's inbox through Cloudflare Email
  Routing (owner approved; MX ×3, Cloudflare's DKIM and an apex SPF TXT were added; Resend's records
  are on `send.`/`resend._domainkey` and unaffected).
- **DMARC stays `p=none`** for now: the domain and its mail are a day old; revisit `quarantine`
  after a few weeks of clean Resend reports.

### Launch checks
- `npm run eval` on production's models (Haiku classify and summarise, Opus for licence, EOL and
  acquisition notes) **passes**: one run, $0.10, no false positive, every deal change found,
  every quote verbatim. (The Deno note restricted itself to self-hosted use; within the bar.)
- Review gate unchanged (auto-publish only deterministic kinds, confidence ≥ 0.9, quote found).
- **Sign-up in production** (2026-10-11, owner's GitHub account, owner's OK): landing → "Pick what
  you run on" → GitHub → new project → 5 services → usage → dashboard worked end to end. Wall
  clock 5 min 4 s, but that includes waiting for the owner to click "Authorize" on GitHub (the
  browser extension may not act on github.com) and the agent's own turn latency; the in-app steps
  after GitHub took under a minute. The dashboard showed the 5 services as "no sources yet",
  because production's first catalog sync is the 06:07 UTC daily run. Re-time after that.
- **Private import against a real private repo** (staging, owner's OK, 2026-10-11): the owner
  authorised the staging GitHub App and installed it on one private repo (the extension may not act
  on github.com, so those clicks were the owner's); the repo list showed it; the import read it
  through the installation token in about 15 s (33 root entries, 22 manifests, 53 npm packages
  ranked) and found 12 catalog services, 2 runtimes and 57 packages; the project page groups them
  by risk. The first attempt had stopped on GitHub's authorise page, not in our code.

### Managed Payments, tax and the legal pages (2026-10-11, later)
- **Stripe Managed Payments** (owner's choice): Stripe, through Link, is the merchant of record:
  it collects and remits VAT and sales tax in 80+ countries, handles fraud, disputes and
  transaction support, and applies consumer cooling-off rules, for 3.5% per transaction. Without
  it, a UK seller owes EU VAT on B2C digital services from the first sale (non-Union OSS). Code:
  Checkout sessions send `managed_payments[enabled]=true` and every Stripe call pins
  `Stripe-Version: 2025-03-31.basil` (MP needs basil or later; webhook parsing already handled both
  period-end shapes). We send none of the parameters MP forbids. Statements read "LINK.COM*
  STACKQUAKE.COM". Checked: staging created an MP session (Stripe request log:
  `managed_payments.enabled: true`, restricted key, pinned version). Product tax code
  `txcd_10103001` (SaaS, business use), marked eligible.
- **Prices include tax** (owner's choice; UK consumer pricing expects VAT-inclusive prices): test
  mode "Include tax in prices" = Yes. **Set the same in live mode** when live billing is set up.
- **Account activation** (live): details reused from the owner's Beckon account (sole trader,
  bank payouts), statement descriptor changed from PROJECT-H.EXAMPLE to STACKQUAKE.COM, Radar Lite
  (MP already covers fraud), no climate contribution. The final "Agree and submit" (Stripe
  Services Agreement, Bacs authorisation) is the owner's click.
- **Terms and privacy rewritten** without a lawyer (the owner can't get one), against: Consumer
  Rights Act 2015 (no exclusion of reasonable care and skill for consumers, death/injury or fraud;
  foreseeable-loss wording for consumers, a cap only for business users), Consumer Contracts
  Regulations 2013 (cancellation: we simply refund in full on request within 14 days of the first
  payment or a yearly renewal, which is more than the law requires), the DMCC Act subscription
  regime (expected January 2027: renewal reminders, easy cancellation; Link sends UK 6/12-month
  reminders and cancellation is in the Portal), E-Commerce Regulations 2002 reg. 6 (name,
  geographic address, email), UK GDPR Art. 13 (controller, purposes, lawful bases, recipients,
  transfers, retention, rights including a separate right-to-object paragraph, ICO complaint),
  PECR (two strictly necessary cookies, no banner). Governing law England and Wales.
- Retention promised in the notice is now true: the daily run deletes expired sessions, sign-in
  links a day after expiry, and rate-limit counters after two days (`prunePersonal`).
- **Still owner actions**: a business address service (the site says "being set up" until
  `ADDRESS` in `src/web/site.tsx` is filled; reg. 6 needs it); the **ICO data protection fee**
  (tier 1, about £52 a year; a sole trader processing customers' personal data must pay unless
  exempt).

### Email addresses (2026-10-11)
- One prefix per purpose, the same across the owner's products (Beckon already uses support@):
  **support@stackquake.com** is the customer contact on the site (`CONTACT`), in Stripe's public
  details and the Managed Payments escalation address (Stripe may refund after 48 hours without a
  reply). hello@ keeps forwarding so nothing sent earlier bounces.
- Role addresses forwarding to the owner (Cloudflare Email Routing, added through the dashboard's
  API): postmaster@, abuse@ (RFC 2142 / mail operators), hostmaster@, webmaster@, security@ (named in
  `/.well-known/security.txt`, RFC 9116, renew `Expires` by 2027-10-11), privacy@, billing@, dmarc@
  (for DMARC aggregate reports once `_dmarc` gets `rua=mailto:dmarc@stackquake.com`, a DNS change for
  the owner to approve). No catch-all: it mostly attracts spam.
- **All the owner's apps** (2026-10-11, owner's request and approval): the same 10 addresses
  (support, hello, postmaster, abuse, hostmaster, webmaster, security, privacy, billing, dmarc)
  forward to the owner's inbox on every domain whose mail Cloudflare handles: stackquake.com,
  project-h.example, project-e.example (its old soporte@ and jay@ removed at the owner's request), project-a.example, project-b.example, and,
  newly enabled (MX ×3 and SPF added by Cloudflare), project-c.example and project-f.example. Not
  touched: project-d.example and project-g.example (and jaystewart.co.uk/.dev) receive mail elsewhere; role
  addresses there are aliases. Stackquake's Stripe support email is
  support@stackquake.com.

### Production CPU: moved to Workers Paid (2026-10-11, owner approved)
- **What production showed** (Workers analytics through the dashboard's GraphQL, 2026-10-11 00:00–20:53
  UTC): 2,609 invocations, 2,364 ok, **244 `exceededResources`** (the CPU limit), 1 exception. Before the
  first catalog sync at 06:07 the ticks had nothing to do (CPU p50 1–5 ms). From 07:00 on, **20–24 of the
  24 ticks every hour were killed**: 9.4% of all invocations, nearly 100% of cron ticks. Jobs did finish
  before the kills (112 of 117 sources had been polled once), but 52 polls and the one classify and
  summarise step were on their 5th attempt, about to be parked. Web requests were unaffected.
- That is far past SPEC §4.2's 1% line. Staying on Free would have meant dropping most HTML pricing
  pages (the product's main point) with no guarantee the rest fits, so the owner moved the account to
  **Workers Paid ($5/month**, 30 s CPU per invocation, 30 M CPU-ms and 10 M requests a month included;
  the plan is account-wide, so another-project benefits too).
- Then: `JOBS_PER_TICK` 3 → **20**, `ALERT_JOBS_PER_TICK` 2 → **10**, and the HEAVY token became
  `HEAVY_PER_TICK` (1 → **10**; `HostGate` now counts tokens). Website hosts still get one request per
  tick (politeness). The "a job with ≥ 2 attempts runs alone" rule stays. The 54 jobs in backoff were
  reset (attempts 0, due now); none were parked.
- **First ticks on Paid**: 20 polls claimed and completed per tick, **192–298 ms CPU** and 3–8 s wall each,
  no errors; the stuck summarise and classify steps ran. So a full tick costs ~10–15 ms of CPU per poll in
  production, well above the profiler's local estimates, which is why Free could never fit. Budget: 576
  ticks a day × ~250 ms ≈ 4.3 M CPU-ms a month, about 15% of the included 30 M.

## UI redesign (started 2026-10-11)

- The owner asked for a world-class UI and delegated the choices ("you choose"). It runs unattended on the
  devbox (Hetzner, Tailscale only; see the Beckon repo's docs/devbox.md) as a Beckon chain of five prompts,
  `prompts/08-ui-*.md`, sharing `prompts/ui/BRIEF.md`: audit and direction, foundation, public pages, app,
  polish. Each stage is a fresh Claude Code session; the check after each is `npm run typecheck && npm test`.
- The direction is chosen by stage 1 from three sketches, not up front: it should come from the audit.
- The box holds no secrets for this repo: no GitHub token, no Cloudflare login, a `.dev.vars` with no real
  keys. The repo reaches it through a bare repo on the box (`dev@devbox:git/repo.git`, pushed from the
  laptop over SSH); the work comes back the same way and is reviewed on the laptop before main or deploy.
- Stage 1 tooling: demo data comes from a local-only `POST /__dev/seed` (src/dev-seed.ts) rather than SQL files, so it
  reuses the real dep and source helpers and stays in step with the schema. It wipes all users, projects, events and alerts
  in the local D1 (never anywhere else: `/__dev` needs `DEV_ROUTES=1` and localhost). Dates are fixed around 2026-10-11 so
  before/after shots match; "changed recently" is still judged against today, so re-check the seed if stages run after
  mid-November 2026.
- Screenshots sign in through the existing `/__dev/session` route (a real session row and cookie) instead of reading magic
  links from the log: same pages, no rate limits; the sign-in form itself is still shot, submitted, as "signin-sent".
- `.dev.vars` on the box also has a random `LINK_SECRET` (to shoot the one-click alert page) and a random
  `CHANNEL_KEY` (so Settings shows the Slack form); all generated locally, none real. Not `APP_ORIGIN`: vitest's Workers pool reads `.dev.vars` and three tests expect it unset.
- Playwright pinned to exactly 1.64.0 (the Chromium build already cached on the box); Lighthouse runs in Chrome launched by
  chrome-launcher with that Chromium, the session cookie set over CDP (Chrome ignores a Cookie header in extraHeaders).
- Direction: "Seismograph", a calm instrument (docs/design/DIRECTION.md). Chosen over an editorial serif direction (weak for
  the dashboard; system serifs vary, a webfont costs 40–80 KB) and a bold status board (loud, and its "magnitude" would be a
  score the pipeline does not compute). System fonts only; severities (act/watch/quiet) derived from existing event kinds
  and alert matches, no new data.
- Stage 2: legacy class names (`.card`, `.flash`, `.pill`, `button.primary`…) are restyled with the new tokens rather than
  removed, so every page keeps working while stages 3–4 convert them to components; remove the aliases in stage 5.
- Stage 2: the CSS stays one inline `<style>` (no extra request, no build step), written readable in `src/web/styles/*.ts`
  and minified by a small regex at module load; about 10 KB gzipped for the largest public page with the HTML.
- Stage 2: the mobile nav is a horizontally scrolling second row of the header and the account links sit in a `<details>`
  menu: both work without JS and keep the header to one line plus the nav row.
- Stage 2: light and dark tokens are defined once in TS and emitted both for `:root` and per element, so the gallery
  shows both schemes side by side on one page instead of relying on two screenshots.
- Stage 2: NoteCard uses no headings (styled paragraphs), so the example note can sit anywhere in a page's outline;
  the full event note keeps real h2s.
- Stage 2: the trace's spikes are links when they have a target, so the SVG is `role="group"` (an `img` may not contain
  links); its aria-label gives the count.
- Stage 3: notes have Open Graph and Twitter `summary` tags but no `og:image`: no remote images are allowed, and the
  main link-preview consumers (Slack, X, LinkedIn, iMessage) don't render SVG, so a self-generated SVG would show as
  nothing; a PNG would need a rasteriser in the Worker. A plain text card is honest and costs nothing.
- Stage 3: the landing comparison is a table built only from docs/COMPETITORS.md's table (vendor docs, 2026-10-11),
  where "No" means "their docs don't describe it"; each vendor's own quote stays on the page, cited, as the evidence.
  The "services" differentiator moved into the table's first rows, leaving four differentiators in a 2×2 grid.
- Stage 3: the event note's h1 is the title alone (the subject is in the kicker and in `<title>`/og:title), as
  DIRECTION.md planned; "What this means for you" on public pages is derived from `applies_when` in plain words,
  since there is no user to match.
- Stage 3: catalog cards show the latest change from events tagged with the entry's `catalogId` (one query, 500 rows);
  an entry's own page still also counts events from its sources, as before.
- Stage 3: the share block is a read-only permalink field plus RSS, not a "copy" button or share-site links: no JS is
  needed and no third-party URLs are added.
- Stage 3: the landing page stays above the 3,500 px target at 390 px (6,635 px): the prompt's required sections cost
  it; phones get a sideways-scrolling comparison table, a swipe row of quotes and three recent changes instead of five.
- Stage 4: the dashboard's "Needs your attention" lists alerts, act before watch and newest first within each, five
  shown and the rest folded ("n more alerts"); no separate /app/alerts page, since adding a route would change
  behaviour and the dashboard and dep pages already hold every alert. With none open it says so in one calm line.
- Stage 4: "No known risk" groups fold to their heading and count (`<details>`, heading inside the summary, so the
  outline stays); on phones a row with nothing to report hides its "No changes seen" line, so quiet rows are one line.
- Stage 4: feedback is "Useful? Yes / No" with accessible names "Yes, useful" / "No, not relevant" (visible text first,
  WCAG 2.5.3); same form, field and values as before.
- Stage 4: the import progress page keeps its 1-second `<meta refresh>` only inside `<noscript>`; with JS it fetches
  itself each second (each GET still runs one step) and swaps the progress in place, follows the redirect when done,
  and reloads if the import failed. Fixes axe's critical `meta-refresh` and stops screen readers re-reading the page;
  a `role=status` line announces only step changes. Steps are labelled from the importer's own step names.
- Stage 4: the new-project form gets a hidden first submit button with no `next`, so Enter in the repo field imports
  (the server already treats "no `next` and a repo" as import) instead of silently opening the picker.
- Stage 4: the onboarding stepper (start, find, usage, dashboard) shows on a user's first new-project page, the import
  page, the picker while a project is empty or just imported, and the usage page when reached from the picker (`?msg`).
- Stage 4: every 402 is one UpgradePanel page (what Team adds, the price from plans.ts, one button to /pricing, a way
  back); the feature lists moved to src/billing/plans.ts so /pricing, Settings and the 402s say the same thing.
- Stage 4: 400/403/404/429/503 pages in the app use ErrorPage via `problemPage()` (src/web/app-ui.tsx); the failed
  import is a 200 as before, so it uses a plain header rather than an error code it doesn't return.
- Stage 4: the one-click alert-link pages use the sign-in pages' narrow column (AuthShell, now in ui.tsx), one big
  confirm button and "Nothing changes until you press the button", since mail scanners fetch the GET.
- Stage 4: the seed adds a held "running" import (its job locked a year ahead, so loading the page neither runs a step
  nor calls GitHub) and a failed one, to shoot both progress states; `npm run ui:peek` screenshots one viewport of one
  page for close inspection.
- Stage 4: admin keeps its markup (the catalog-request test pins it) but moves onto Badge, Quote, DiffView, Buttons and
  Field; the edit page now has an h1, which clears the last pre-existing axe finding outside the gallery.
- Stage 5: the critique ran as four passes of five (later three, then one) read-only reviewer subagents over the
  screenshots, each pass's fixes committed before the next; stopped when a pass found only a minor wrap issue. Two
  passes caught regressions from the previous pass's fixes, which is why the final pass checked regressions first.
- Stage 5: `ui:shots` adds a 360×780 viewport in light only (it checks fit, not colour); `ui:keys` is a new script that
  tabs through sign-in, new project, a dependency's settings and usage questions and checks each stop's focus ring,
  position and whether a sticky bar covers it.
- Stage 5: orange is only the signal and the one primary action per page: event subjects, step and path icons, auth
  marks, error-page icons, selected chips and ticked picker tiles went neutral (ticked = ink border and sunken fill).
- Stage 5: `--shadow-1` in dark mode is a transparent shadow, not `none`, because it sits inside shadow lists where
  `none` invalidated the whole declaration (the upgrade panel and featured plan lost their accent edge in dark).
- Stage 5: alerts whose match is `unknown` are *watch*, not *act*, as DIRECTION.md's mapping always said; the stage 2
  helper only looked at the event kind. Presentation only (the query now selects `alerts.match`).
- Stage 5: dependency and alert rows lay out by their list's width (container queries) rather than the viewport, so
  they fit in rails, panels and the gallery's half-width columns.
- Stage 5: event lists drop the "Subject:" prefix when the title already starts with the subject as a whole word, and
  bold the title's opening words instead, so every row still leads with a bold name.
- Stage 5: on the landing comparison the Stackquake column comes first, so phones see it without scrolling the table;
  the vendor quotes follow the table's order.
- Stage 5: the project page's Danger zone moved after the Repository rail, so on phones the destructive action is last.
- Stage 5: published events in admin show "Unpublish" (secondary) instead of a red "Reject"; same form and route.
- Stage 5: /signin stays `noindex` (as before the redesign) and gets a meta description; Lighthouse SEO 100 is met on
  every indexable public page, and /signin's `is-crawlable` failure is by design.
- Stage 5: `npm run measure:cpu` fails at its second project because its user is on Free (one project); the CPU
  comparison in REVIEW.md used a temporary one-project copy on main and on this branch. The script itself is left as is.

### UI redesign: summary (2026-10-12)

- **What**: every page redesigned to one direction, "Seismograph" (docs/design/DIRECTION.md): system fonts, warm greys,
  orange only as signal, mono for machine facts, act / watch / quiet severities derived from data the app already had,
  and a 90-day trace of real changes as the signature element. Server-rendered Hono JSX, no client framework, no CSS
  build step, no third-party requests; every page works without JS.
- **How it is built**: tokens and styles in `src/web/styles/*.ts` (one inline stylesheet), components in
  `src/web/ui.tsx` and the view modules (stack-view, alerts-view, events-view), shown in every state at `/__dev/ui`.
- **Behaviour**: routes, forms, field names, CSRF, redirects, status codes and access rules unchanged; prices, plan
  limits and legal wording unchanged. User-visible changes are listed in docs/design/REVIEW.md "Risks to check".
- **Numbers**: axe 0 violations on all 52 shot pages in light and dark (baseline 92 findings); Lighthouse mobile
  100 / 100 / 100 / 100 on the indexable public pages (baseline best practices 92–96, event note a11y 97); no overflow
  at 360 px; public pages 12–17 KB gzipped (budget 30 KB); HTML renders cost about 2× the CPU of before (REVIEW.md).
- **Process**: five unattended stages (audit and direction, foundation, public, app, polish), each a fresh session
  with `npm run typecheck && npm test` as the check, screenshots and audits under `.ui/` on the devbox. Nothing was
  deployed or pushed; the branch is for review on the laptop.
- **Follow-ups**: prompts/09-ui-follow-ups.md.

## Launch (started 2026-10-13)

### Production checks (2026-10-13, read-only D1 queries)
- Sources: 211 active, 0 failing, 0 overdue by an hour; 3 blocked, all known (Bitwarden forum
  robots.txt; hashicorp.com feed and licence FAQ behind Vercel's checkpoint, M1/M5). Jobs: 211
  polls, 0 parked. Events: 6 published, 27 rejected, 2 waiting in the review queue (Grafana 13.0
  EOL at 0.85; a Bun licence-file attribution edit at 0.88 that reads like a non-change).
  LLM spend $0.26 over three days.
- **Bug found and fixed**: the owner's project had 2 of 5 services linked to sources (Resend,
  Stripe). Production's first catalog sync (2026-10-11 06:07, still on Free, 244
  `exceededResources` that day) stored the entries but never reached the relink step, and later
  syncs skip stored entries, so Workers, D1 and GitHub Actions stayed unwatched. Every sync now
  inserts any missing dep → catalog source link (`linkMissingCatalogDeps`); production heals on
  the first daily run after deploy. Only projects created before that first sync were affected.
- Deployed to staging (e3a80f98) and production (5d8efaac) on 2026-10-13 with the owner's OK.
- Workers metrics, last 24 hours (2026-10-13, mostly on the redesign's version a138ae63): 3.18k
  invocations, 0 errors, **0 Exceeded CPU Time Limits**; CPU P50 17 ms, P90 71 ms, P99 97 ms (cron
  ticks dominate), memory P99 12 MB. The dashboard has no per-route split; compare a full week
  after the redesign with this once there is one.
- `/admin` is a 404 for the owner in production: they sign in with GitHub as a different address
  than the one in `ADMIN_EMAILS`. Fixed 2026-10-13: the owner put both addresses in production's
  `ADMIN_EMAILS`; `/admin` opens.
- Live Stripe (2026-10-13): the account is activated (live keys exist). Live "Include tax in
  prices" is still **No** (must be Yes), there are no live products, and Managed Payments is not
  set up. Claude Code's auto mode blocked these dashboard changes and secret writes even with the
  owner's approval in chat, so they are the owner's (or need a permission rule).
- `/pricing` in production says "Team opens soon": live billing is still to do (prompt 07 step 3).

### UI follow-ups done (prompts/09-ui-follow-ups.md items 1–2)
- `npm run measure:cpu` runs to the end again: `/__dev/session` takes `plan: "team"`, and the
  import step label is read from ProgressSteps' current item.
- `GET /app/deps/:id` loads only its own dep's view (`loadDep`): 3.73 → 3.10 ms first load,
  2.85 → 2.44 ms again on a 150-dep project; same HTML byte for byte. Within run-to-run noise
  (`GET /app` moved 3.5 → 5.4 ms between runs with no change), so small but not nothing.
- Review queue cleared 2026-10-13 (owner's OK): Grafana 13.0 EOL approved, the Bun licence-file
  attribution edit rejected. 7 published, 28 rejected.
- support@stackquake.com forwarding checked: the owner received a message sent to it.
- Live Stripe (2026-10-13, owner's clicks with Claude filling forms): Managed Payments "Ready to
  use"; Include tax in prices = Yes; product "Stackquake Team" (`prod_PLACEHOLDER`, tax code
  `txcd_10103001`, eligible) with $19/month `team_monthly` (`price_PLACEHOLDER_MONTHLY`,
  default) and $190/year `team_yearly` (`price_PLACEHOLDER_YEARLY`), both USD, tax
  included. `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY` set on production.
- Live webhook `stackquake-production` (`we_PLACEHOLDER`) to
  `https://stackquake.com/stripe/webhook`, API version 2026-09-30.endive (the only non-preview
  choice; the handler reads `items.data[0].current_period_end` and the price's recurring interval,
  both present), events `checkout.session.completed` and `customer.subscription.created|updated|
  deleted`. Live Customer Portal (default configuration): invoice history; name, email, billing
  address, phone and tax ID; payment methods; cancel at period end with a reason; switch between
  the two Team prices with proration. Terms and privacy URLs set in Public details.
- Restricted key `stackquake-production-worker` (Write on Customers, Checkout Sessions, Customer
  Portal and Subscriptions, nothing else); Claude filled the form and clicked Create without
  looking at the result, the owner copied it. All four `STRIPE_*` secrets are on production
  (values moved by clipboard only). **Live billing is on**: /pricing shows "$19 monthly" and
  "$190 yearly" to a signed-in Free user and a sign-in button to visitors. No live Checkout
  session or charge made yet.

## Email: Amazon SES (2026-10-13)

Why: Resend's free plan is 100 emails a day and 3,000 a month; SES is about US$0.10 per 1,000 and
keeps mail in the EU (eu-west-1, like Beckon). Resend stays as the fallback until SES has run
cleanly for a while. Don't switch providers on launch day: deploy with the SES keys unset.

### Design
- **SES v2 HTTPS API**, not SMTP and not the AWS SDK (this is a Worker; bundle size and CPU). One
  signed `POST https://email.<region>.amazonaws.com/v2/email/outbound-emails` per message,
  `Content.Simple` with Subject, Text and Html (all UTF-8) and `Headers` for List-Unsubscribe and
  List-Unsubscribe-Post (the v2 API takes up to 15 custom headers on `Simple`, so no hand-built MIME).
- SigV4 is a pure function with Web Crypto (`src/platform/sigv4.ts`), tested against AWS's published
  test-suite vectors (`get-vanilla`, query ordering, `post-x-www-form-urlencoded`).
- Config: secrets `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY`; var `AWS_SES_REGION`
  (default `eu-west-1`); `AWS_SES_API_BASE` for stubs. The sender is `MAIL_FROM || DEFAULT_FROM`.
- Errors: 429, throttling, limit exceeded, 5xx and network failures are retried by the runner;
  `MessageRejected`, `MailFromDomainNotVerified`, `BadRequest` and other 4xx are permanent (the
  alert is `failed`). `AccountSuspended`, `SendingPaused` and credential errors (`UnrecognizedClient`,
  `InvalidSignature`, `AccessDenied`, `ExpiredToken`…) need the owner, not a different message, so
  they are **not** permanent (the runner retries for about 15 hours while the owner fixes it) and
  are logged with `console.error`.

### Idempotency without a provider key
Resend drops a second send with the same `Idempotency-Key` for 24 hours, and the job runner relies
on that (`alert-<id>`, `digest-<user>-<day>`, `budget-<date>-<to>`). SES has no such key.
- Table `mail_sends(key PRIMARY KEY, sent_at)` (migration 0006). `IdempotentMailer`
  (`src/platform/idempotent.ts`) wraps any Mailer: with a key it looks the key up, skips the send if
  found, otherwise sends and inserts the row right after the provider accepts. Mail without a key
  (sign-in links) is not recorded; each is meant to be sent.
- It is applied to SES only (Resend keeps its own key; the console and memory mailers don't need it).
- **How it fails:** a crash between SES's 200 and the insert leaves no row, so the retry sends the
  email a second time. That is deliberate: a duplicate alert is better than a lost one. A failed
  insert after a successful send is logged and swallowed, so it does not turn into a retry. Two
  invocations racing on one key could both send; the job claim lock makes that a non-case for
  alerts and digests, and the budget mail goes to one or two admins once a day.
- Rows are deleted in the daily run (`prunePersonal`) after 3 days; the runner's backoff retries
  for about 15 hours, so a key never needs to outlive that. The keys hold ids, a date and, for the
  budget mail, an admin's address, for at most 3 days.

### Owner checklist (the owner does these; Claude does none of them)
- [ ] 1. AWS console, eu-west-1: verify domain identity `stackquake.com` with Easy DKIM (2048-bit);
  add the three `_domainkey` CNAMEs in Cloudflare, DNS only (they don't clash with Resend's records
  or Email Routing). The owner approves the DNS change; Claude may add them in Chrome if told to.
- [ ] 2. Optional custom MAIL FROM `bounce.stackquake.com` (MX + SPF TXT), as Beckon's docs/deploy.md.
- [ ] 3. Request production access (transactional: sign-in links, alerts the user subscribed to,
  weekly digests; unsubscribe link in every alert and digest; bounces via the account-level
  suppression list). Until then SES only sends to verified addresses.
- [ ] 4. IAM user `stackquake-ses-production` allowed only `ses:SendEmail` on the `stackquake.com`
  identity ARN; an access key (not SMTP credentials). Then
  `! pbpaste | npx wrangler secret put AWS_SES_ACCESS_KEY_ID` and the same for
  `AWS_SES_SECRET_ACCESS_KEY`. Staging: its own user and keys (`--env staging`), or it stays on Resend.
- [ ] 5. After a deploy (owner's OK): sign in by magic link and trigger a test alert (staging, or a
  real alert; `/__dev/test-email` is local only). In the received mail's original check
  `dkim=pass header.d=stackquake.com`, `spf=pass`, `dmarc=pass`, not in spam, List-Unsubscribe on the alert.
- [ ] 6. After a clean week: delete the Resend production key, remove Resend's DNS records (`send`
  and `rsend` CNAMEs, `resend._domainkey` TXT; keep `_dmarc`), unset `RESEND_API_KEY`, and drop
  Resend from the privacy page. Then consider DMARC `p=quarantine` (M5).
- [ ] 7. Watch SES's reputation dashboard: bounces under 5%, complaints under 0.1%.
