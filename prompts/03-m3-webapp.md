# Prompt 03: implement M3 (web app)

Saved 2026-10-10. Paste this into a new Claude Code session in this repo (Opus 5.5 or
Sonnet 5.5 · high). No LLM spend expected; GitHub OAuth needs an OAuth app (ask the owner for
the client id and secret when you get there, and work against a mocked GitHub until then).

---

Read SPEC.md in full, then docs/DECISIONS.md (M1 and M2 decisions; it wins where it differs
from the spec). Implement milestone M3 only (§12): the web app. No alert delivery (M4), no
GitHub App or deploy (M5), no billing (M6).

## Constraints that carry over
- Workers **Free plan**: 10 ms CPU per invocation, including HTTP requests. Server-rendered
  Hono JSX, minimal client JS (htmx or a few small islands). Measure the heaviest pages
  (dashboard, repo import) the way `npm run measure:cpu` does and report them.
- Repo import is the CPU risk: fetching and parsing up to 30 manifests must not run in one
  request. Make it a job (or a few) on the existing runner, with the page polling for progress;
  G4 (under 60 s from paste to dashboard) still has to hold. Ticks are every 5 minutes, so
  either run the import steps inline in `waitUntil` within the CPU budget, or kick the runner
  for import jobs; decide, measure and record it.
- Portability (§4.3): new platform code behind interfaces. Add a `Mailer` with a console/dev
  implementation; Resend comes in M4/M5.
- `/admin` moves from `ADMIN_TOKEN` to real sessions for users in `ADMIN_EMAILS`.

## Scope (SPEC §2 Positioning, §6, §7.1, §7.6, §8)
1. **Auth**: GitHub OAuth sign-in and email magic links (`magic_links`, 15-minute single-use
   tokens, hashed at rest). Sessions in D1, HttpOnly, Secure, SameSite=Lax cookies, CSRF token
   on every POST form, sign-out. Rate-limit magic-link requests per email and per IP.
2. **Service picker first** (§7.1 "Manual add"): catalog entries grouped by category,
   searchable by name and alias, common ones first. Free text that matches nothing is stored
   as a catalog request (admin view), not watched.
3. **Public repo import as a shortcut** that pre-fills the picker: GitHub API tree + up to 30
   manifests from §7.1, mapped to catalog deps, runtimes (`eol` deps) and packages; the top 25
   packages shown, the rest under "also watching". Fixture repos for tests, including a
   monorepo with two `package.json` files. Parsers for every manifest type in §7.1.
4. **Usage profiles** per dep, only the questions in the entry's `usage_questions`, defaulting
   from the project. Unknown means "assume affected". Store them in the shape M2's
   `applies_when` uses (`hosting`, `use`, `tier`), and add the M4 matcher's unit tests now
   (§11: each profile combination, unknown → `unknown`).
5. **Dashboard** `/app`: projects, deps grouped by risk, latest published event per dep.
   `/app/projects/new`, `/app/projects/{id}`, `/app/deps/{id}` (sources, profile, events, mute),
   `/app/settings` (email, digest day, delete account: §8 says what is removed).
6. **Public pages**: `/catalog`, `/catalog/{id}` (recent published events), `/events`,
   `/events/{id}` (the note with its quote, source link and the "Summary, not legal advice"
   line from §14 Q5), `/events.rss`. Only `published` events are public.
7. **Catalog to 25+ entries, mostly hosted services** (§2 Positioning, §5.1 list), each with
   working sources: run `npm run poll -- <id>` twice for every new entry and fix selectors and
   ignore rules until the second poll shows no change. Note blocked hosts in DECISIONS.

## Done when
- E1 (SPEC §11) passes: a fixture repo URL (GitHub API mocked) gives the expected catalog
  deps and runtimes, under 60 s.
- A real public repo imports correctly (pick one with a monorepo layout; record which).
- A user with no repo builds a stack from the picker in under 60 s (describe the click path).
- Unit tests for every manifest parser, the profile matcher, auth (magic link reuse and expiry,
  CSRF, session expiry), and access control (one user cannot see another's projects).
  `npm test` and `tsc` are clean; `npm run eval` still passes (catalog growth must not break
  the golden set).
- docs/DECISIONS.md has an M3 section.

Work on a branch `m3-webapp` from `main`, commit in logical steps, and stop when M3 is done.
Finish with a short summary and a prompt for M4 in `prompts/04-m4-alerts.md`.
