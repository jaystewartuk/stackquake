# Prompt 04: implement M4 (alerts)

Saved 2026-10-10. Paste this into a new Claude Code session in this repo (Opus 5.5 or
Sonnet 5.5 · high). LLM spend: only if you re-run `npm run eval` (about $0.09 a run). Resend
needs an API key: ask the owner for one when you get there. Until stackquake.com's DNS records
exist (M5), Resend only delivers to the account owner's own address, so build and test against
a mocked Resend API.

---

Read SPEC.md in full, then docs/DECISIONS.md (M1–M3; it wins where it differs from the spec).
Implement milestone M4 only (§12): alerts. No GitHub App, deploy or DNS (M5), no billing (M6).

## What M3 left you
- `matchProfile(appliesWhen, profile)` and `effectiveProfile(...)` in `src/stack/profile.ts`,
  already unit-tested for every profile combination. Fan-out uses them; don't write a second
  matcher.
- `dep_sources` is the single source of truth for what a dep watches (catalog deps link all of
  their entry's sources; packages link their registry; runtimes link their EOL cycle). Fan-out
  joins `events.source_id → dep_sources → deps → projects → users`.
- `deps.muted_until`, `users.digest_day`, and the `Mailer` port (`src/ports.ts`) with
  `ConsoleMailer` and `MemoryMailer`. Add a `ResendMailer` behind the same interface.
- Account deletion (`src/web/app.tsx`, `/settings/delete`) must also remove `alerts` and
  `channels` once you add them.
- Tests drive the app through `test/web.ts` (`Browser`, `webCtx`); the CPU script
  (`npm run measure:cpu`) profiles ticks, web pages and import steps, and names the sources in
  each tick.

## Constraints that carry over
- Workers Free plan: 10 ms CPU per invocation; D1 allows 100 bound parameters per statement
  (use the `json_each` pattern from `src/stack/deps.ts` for bulk writes). Fan-out for an event
  with many affected deps must be chunked across steps, not done in one.
- Steps are idempotent jobs on the existing runner (SPEC §7.2). Alerts are UNIQUE(user_id,
  event_id); a retried fan-out or delivery must never send twice.
- **Runner capacity.** `JOBS_PER_TICK=3` gives about 860 job runs a day. The catalog has 149
  sources, and users' package and EOL sources add more (up to 150 packages per project), most of
  them cheap API polls every 6 h. Delivery jobs will compete with polls. Some marketing-page
  polls already measure 25–60 ms (DECISIONS, M3 "CPU"). Measure, then decide.
  One option is a second, larger per-tick allowance for jobs that take no `HEAVY` token
  (registry and API polls, deliveries), with its CPU measured. Record the decision.

## Scope (SPEC §7.3 steps 5–6, §7.4 logging/budget, §7.5, §8)
1. **Fan-out** when an event is published (auto-publish or admin approval/edit): for each linked
   dep (skip muted ones), match `applies_when` against the effective profile. `affected` and
   `unknown` → an alert; `not_affected` → a `suppressed` alert for the digest. Events published
   before M4 are not fanned out retroactively (decide and record).
2. **Urgency and rate limit** (SPEC §7.5): `license`, `eol` within 180 days, `acquisition` with an
   end of service, and `free_tier` go out immediately; everything else waits for the digest. At
   most 3 immediate alerts per user per day; the 4th goes to the digest (unit test).
3. **Email via Resend**: subject `[Stackquake] {catalog name}: {title}`, the note sections in
   order, the quote as a blockquote with its link, "Affects you because: …" (or "We don't know
   how you use X, so we assume it does"), the options, and the "Summary, not legal advice" line.
   Plain-text and HTML parts. A per-user unsubscribe from immediate alerts (digest only) in
   settings.
4. **Signed one-click links** (HMAC with a Worker secret, 30-day expiry): "Useful", "Not
   relevant", "Mute this dependency for 90 days". GET shows a confirm button that POSTs (same
   reason as the magic links: mail scanners prefetch links). Store feedback on the alert.
5. **Slack**: `channels` with the incoming webhook URL encrypted with AES-GCM (key from a Worker
   secret), a test message when it is added, and the same content as Block Kit. Only
   `hooks.slack.com` URLs are accepted (SSRF, SPEC §8). Settings page to add and remove it.
6. **Weekly digest** on each user's `digest_day`, from the daily cron: queued and digest-held
   alerts, plus "N changes we watched that don't affect you" (the suppressed ones). Send it only
   if there is something to say, or for the first digest of the month ("all quiet").
7. **LLM budget guard** (SPEC §7.4): the daily run emails the admin (`ADMIN_EMAILS`) when the
   7-day cost passes `LLM_WEEKLY_BUDGET_USD` (default $10), and `classify` jobs pause (deferred,
   not failed) above twice the budget; `summarise` keeps running. Show both on `/admin`.
8. Show each user's alerts on the dashboard and dep page (sent, held for digest, suppressed),
   with the feedback buttons.

## Done when
- E2, E3 and E4 (SPEC §11) pass end to end in Miniflare, with the LLM and Resend mocked:
  - E2: a snapshot change becomes a published event, then an email to an affected user and a
    suppressed alert for an unaffected user.
  - E3: a note whose quote is not in the source stays `pending_review` and sends nothing.
  - E4: with the weekly budget exceeded, `classify` pauses and the admin gets an email.
- Unit tests: rate limit (4th immediate alert → digest), the urgency rules, signed-link expiry
  and tampering, mute (no alert while muted), the digest's send/skip rule, Slack URL validation,
  idempotent fan-out and delivery (run each step twice, one email).
- `npm test` and `tsc` clean; `npm run eval` still passes if you touched the pipeline.
- `npm run measure:cpu` covers fan-out and delivery ticks; report them, and the capacity decision.
- One real email delivered through Resend to the owner's address (ask first), recorded in
  DECISIONS.
- docs/DECISIONS.md has an M4 section.

Work on a branch `m4-alerts` from `main` (merge `m3-webapp` first if it isn't merged), commit in
logical steps, and stop when M4 is done. Finish with a short summary and a prompt for M5 in
`prompts/05-m5-deploy.md`.
