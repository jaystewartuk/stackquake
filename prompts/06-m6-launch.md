# Prompt 06: implement M6 (plans, billing, landing page, launch)

Saved 2026-10-11. Paste this into a new Claude Code session in this repo (Opus 5.5 or
Sonnet 5.5 · high). LLM spend: `npm run eval` once against production's models before launch
(about $0.10). Money and accounts need the owner: ask before creating anything in Stripe (live
mode), before moving to Workers Paid, and before posting anything public (Show HN). Never paste
secrets into chat: move them by clipboard into `wrangler secret put` (see DECISIONS M5,
"Secrets") or into `.dev.vars`.

---

Read SPEC.md in full, then docs/DECISIONS.md (M1–M5; it wins where it differs from the spec),
then docs/COMPETITORS.md. Implement milestone M6 (§12): plans, billing, landing page, public
launch.

## What M5 left you
- **Deployed**: production `stackquake` on stackquake.com (3 cron triggers) and staging
  `stackquake-staging` on staging.stackquake.com (no cron; `/admin/staging` runs ticks, the daily
  job and a sample event by hand). Each has its own D1, R2 and all 13 secrets (names in
  DECISIONS M5). `npm run deploy:staging` / `deploy:production` run tsc, tests and remote
  migrations first.
- **Email** from `alerts@stackquake.com` through Resend (SPF/DKIM/DMARC `p=none` on Cloudflare).
  Staging was checked end to end in the owner's inbox: magic link, alert, Useful and Mute links,
  digest.
- **GitHub**: OAuth apps for sign-in (one per environment) and GitHub Apps `stackquake` (public)
  and `stackquake-staging` for private repos, with push re-import (`src/github/`,
  `src/web/github.tsx`). `scripts/github-app-setup.mjs` recreates an app if ever needed. Private
  import has not been tried against a real private repo yet.
- **Catalog**: 59 entries, 48 hosted services, APIs or runtimes; HEAVY polls 372 a day of 576.
- **Expiring credentials**: Anthropic keys and GitHub watcher tokens on 2027-10-10.

## Scope
1. **Production CPU first.** Before anything else, read production's Workers metrics (dashboard →
   stackquake → Metrics, last 7 days): invocations, "Exceeded CPU Time Limits", CPU P50/P99. Also
   `/admin/sources` on stackquake.com for parked polls (sign in as the owner). M5 only saw the first
   hours, before the first catalog sync (DECISIONS M5 "Production CPU"). If more than 1% of
   invocations on any day exceeded CPU, recommend Workers Paid ($5/month, SPEC §4.2); ask the owner
   before switching; then raise `JOBS_PER_TICK` and drop the HEAVY gate's one-per-tick rule as
   DECISIONS M1/M4 describe. Record what you saw either way. Watch the Rust and Elastic feeds and
   sentry.io/pricing in particular.
2. **Plans and limits** (SPEC §10): Free = 1 project (public repo or manual), email alerts,
   weekly digest. Team = $19/month or $190/year: unlimited projects, private repos through the
   GitHub App, Slack, up to 10 members, CSV export of vendor risk. Enforce server-side when creating
   projects, connecting a private repo and adding Slack (M4 offered Slack to everyone; decide what
   happens to existing free users' Slack channels and record it). "Up to 10 members" needs a
   minimal team model (invite by email, shared projects); keep it as small as the plan needs.
3. **Billing**: Stripe Checkout and the Customer Portal; a webhook (signature verified, idempotent by
   event id) sets `users.plan`. Test mode on staging first; live mode on production only after the
   owner creates or approves the live product and prices.
4. **Landing page and `/pricing`** (SPEC §2 Positioning): lead with services ("pick what you run
   on"), repo import as the shortcut. Use docs/COMPETITORS.md's "Where Stackquake differs" bullets,
   re-checking each quote against the live page first. Public catalog and event pages already
   exist. Add a `www.` redirect to the apex (ask before the DNS change). Terms and privacy pages
   (SPEC §14 Q5: a short "summary, not legal advice" disclaimer is already on every note).
5. **Launch checks**: a new user goes from sign-up to a populated dashboard in under 2 minutes in
   production (SPEC §12 M6 "done when"); time it. The golden set passes on production's models and
   the review gate is on (SPEC §12). Try private import against one of the owner's real private
   repos with the owner's OK. Consider DMARC `p=quarantine` if Resend shows clean mail. Then draft a
   Show HN post for the owner; do not post it.

## Done when
- Plans are enforced, Checkout and the Portal work in test mode on staging, and live billing is set
  up on production with the owner's approval.
- The landing page and pricing page are live on stackquake.com.
- The production CPU decision is recorded with numbers.
- `npm test` and `tsc` are clean; `npm run eval` passes.
- docs/DECISIONS.md has an M6 section.

Work on a branch `m6-launch` from `main` (merge `m5-deploy` first if it isn't merged), commit in
logical steps, and stop when M6 is done. Finish with a short summary of what is left before or
after launch.
