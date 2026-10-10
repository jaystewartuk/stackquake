# Prompt 05: implement M5 (GitHub App, deploy, DNS, catalog to 40+)

Saved 2026-10-11. Paste this into a new Claude Code session in this repo (Opus 5.5 or
Sonnet 5.5 · high). LLM spend: `npm run eval` once at the end (about $0.10) and a few real
pipeline runs on staging. Cloudflare and GitHub need the owner: ask before every DNS change and
make it through Chrome in the Cloudflare dashboard (stackquake.com is on Cloudflare); ask the owner
to create or approve anything that needs their accounts (GitHub App, OAuth app, Cloudflare API
token), and never paste secrets into chat: put them in Worker secrets or `.dev.vars`.

---

Read SPEC.md in full, then docs/DECISIONS.md (M1–M4; it wins where it differs from the spec).
Implement milestone M5 only (§12). No billing, plans or landing page (M6).

## What M4 left you
- Alerts end to end: fan-out (`src/alerts/fanout.ts`), delivery by email and Slack
  (`deliver.ts`), weekly digest (`digest.ts`), signed one-click links (`links.ts`, `/a/:token`),
  the LLM budget guard (`budget.ts`). E2–E4 pass in Miniflare with Resend and the LLM mocked
  (`test/alerts-e2e.test.ts`).
- `ResendMailer` (`src/platform/resend.ts`) is used when `RESEND_API_KEY` is set. A real email
  went through Resend from `onboarding@resend.dev` to the owner (`POST /__dev/test-email`).
  `.dev.vars` has a dev key named `stackquake-dev` (sending access).
- Runner capacity: two tick crons (`*/5` and `3-58/5`, each its own invocation and CPU budget)
  plus the daily one, 3 of the account's 5 Free-plan cron triggers; `JOBS_PER_TICK=3` plus
  `ALERT_JOBS_PER_TICK=3` for fan-out, delivery and digests; feeds every 3 h.
- Secrets the Worker now expects (all optional locally): `RESEND_API_KEY`, `LINK_SECRET`
  (HMAC for one-click links), `CHANNEL_KEY` (32 bytes base64, AES-GCM for Slack webhook URLs),
  plus M1–M3's `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GITHUB_CLIENT_SECRET`. Vars: `MAIL_FROM`,
  `APP_ORIGIN`, `ADMIN_EMAILS`, `LLM_WEEKLY_BUDGET_USD`, `GITHUB_CLIENT_ID`.

## Scope
1. **Deploy** staging and production Workers (wrangler environments): real D1 databases and R2
   buckets (replace the placeholder `database_id`), migrations applied, secrets set, the custom
   domains (`stackquake.com` for production, a `staging.` subdomain for staging), crons only where
   they should run (decide whether staging runs the cron at all: it shares the account's 5 cron
   triggers, and M4 uses 3 per Worker; record the decision). Generate fresh `LINK_SECRET` and
   `CHANNEL_KEY` per environment.
2. **DNS for Resend** on stackquake.com (SPF, DKIM, and a DMARC record; ask first, then do it in
   the Cloudflare dashboard via Chrome). Verify the domain in Resend, create a production key
   (sending access, restricted to the domain), switch `MAIL_FROM` to
   `Stackquake <alerts@stackquake.com>`, and send a real alert and a digest to the owner from
   staging.
3. **GitHub OAuth app** for sign-in (M3 left it hidden until `GITHUB_CLIENT_ID`/`SECRET` exist):
   the owner creates it; callback `https://stackquake.com/auth/github/callback` (and staging's).
4. **GitHub App** for private repos (SPEC §4.1, §7.1, §8): contents read, metadata read, `push`
   webhook only; installation tokens encrypted at rest (reuse `src/alerts/secretbox.ts`);
   webhook signatures verified (`X-Hub-Signature-256`); re-import on pushes to the default branch
   that touch a manifest. Import uses the installation token instead of `GITHUB_TOKEN`.
5. **Catalog to 40+ entries**, at least two thirds hosted services and runtimes (SPEC §5.1 list:
   Vercel functions, Deno Deploy, Valkey, Elasticsearch/OpenSearch, OpenTofu, 1Password,
   Grafana, HashiCorp Vault, Kubernetes, Home Assistant, Immich… whatever is missing). Every new
   source polled twice with no false change (`npm run poll`), and CPU-checked: on the Free plan
   a poll over 10 ms CPU is killed (DECISIONS M3 "CPU"); prefer Markdown docs pages to marketing
   pages.
6. **Competitor check** (SPEC §2 Positioning): what Dependabot, Snyk and Socket flag today for
   upstream licence changes, deprecations and archived repos. Write it up in docs/ with sources.
7. **Production checks after deploy**: watch `exceededCpu` in Workers analytics and parked polls
   on `/admin/sources` for a few days of real ticks. If more than 1% of invocations exceed CPU,
   move to Workers Paid (SPEC §4.2) and say so; record what you saw either way. Also confirm the
   second tick cron (`3-58/5`) fires.

## Done when
- Staging works end to end with a real email: sign in by magic link on staging, pick services,
  an admin-approved event alerts the owner by email (and Slack, if the owner connects a webhook),
  feedback and mute links work from the real email.
- Production is deployed on stackquake.com but not announced (no Show HN).
- `npm test` and `tsc` clean; `npm run eval` still passes; `npm run measure:cpu` re-run with the
  grown catalog.
- docs/DECISIONS.md has an M5 section (environments, secrets, DNS records, cron decision, what
  production CPU looked like).

Work on a branch `m5-deploy` from `main` (merge `m4-alerts` first if it isn't merged), commit in
logical steps, and stop when M5 is done. Finish with a short summary and a prompt for M6 in
`prompts/06-m6-launch.md`.
