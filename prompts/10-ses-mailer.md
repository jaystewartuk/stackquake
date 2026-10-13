# Prompt 10: Amazon SES mailer

Saved 2026-10-13. Paste this into a new Claude Code session in this repo (Sonnet 5.5 · medium is
enough; use Opus if the idempotency design below gets hard). Deploying, pushing, anything in AWS,
Cloudflare DNS or Resend are the owner's: ask first. Never paste secrets into chat or print them:
the owner moves them with `! pbpaste | npx wrangler secret put NAME` (DECISIONS M5 "Secrets").

---

Read docs/DECISIONS.md "Email (Resend) and DNS on stackquake.com" (M5), "Launch" (the last
section) and the M4 alerts sections on delivery and digests first. Beckon, the owner's other
project, already moved its sign-in emails from Resend to Amazon SES; its owner steps are in
`~/repos/beckon/docs/deploy.md` "Amazon SES (hosted service email)". Follow the same choices
(region **eu-west-1**, Easy DKIM, leave the sandbox, least-privilege credentials) but note the
difference: Beckon runs on a VM and sends over SMTP; Stackquake is a Cloudflare Worker, so use the
**SES v2 HTTPS API** (`POST https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails`,
SigV4, service `ses`), signed with Web Crypto. No AWS SDK (bundle size and CPU on Workers; the
Resend mailer is plain `fetch` through `ctx.http` for the same reason).

## Why

Resend's free plan is 100 emails a day and 3,000 a month. Stackquake sends sign-in links, alerts
(at most 3 a day per user) and weekly digests, so a few hundred users outgrow it. SES is about
US$0.10 per 1,000 and keeps mail in the EU. Resend stays as the fallback until SES has run
cleanly for a while.

## What to build (each its own commit; `npm run typecheck && npm test` green after each)

1. **`src/platform/ses.ts`: `SesMailer implements Mailer`** (the port is in src/ports.ts; copy
   the shape of src/platform/resend.ts).
   - Config: `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY` (secrets), `AWS_SES_REGION`
     (var, default `eu-west-1`), optional `AWS_SES_API_BASE` (tests and `measure:cpu` stubs, like
     `RESEND_API_BASE`). `from` stays `MAIL_FROM || DEFAULT_FROM`.
   - Request: `Content.Simple` with Subject, Body.Text and Body.Html (when present), and
     `Headers` for `mail.headers` (List-Unsubscribe and List-Unsubscribe-Post on alerts, see
     src/alerts/deliver.ts). Check the current SES v2 API reference that `Simple` accepts custom
     headers; if it doesn't, build a `Raw` MIME message instead (multipart/alternative, UTF-8,
     quoted-printable or base64, CRLF line ends) and test it.
   - SigV4 in a small pure function (`signRequest`) with a unit test against AWS's published
     example vectors, so a signing bug can't hide behind a mocked fetch.
   - Errors to `MailError(message, permanent)`: 429 / `TooManyRequestsException` /
     `LimitExceededException` / 5xx are retryable; `MessageRejected`, `MailFromDomainNotVerified`,
     `BadRequestException` and other 4xx are permanent. `AccountSuspendedException` and
     `SendingPausedException` are not permanent (they need the owner, not a different message),
     and should be loud in the log.
2. **Idempotency.** Resend drops a second send with the same `Idempotency-Key` for 24 hours, and
   the job runner relies on that so a retried step can't email twice (`alert-<id>`,
   `digest-<user>-<day>`, `budget-<date>-<to>`). **SES has no such key.** Design the replacement
   and write it down in DECISIONS before coding. A likely shape: a small D1 table
   (`mail_sends(key PRIMARY KEY, sent_at)`, a migration) checked before sending and written right
   after a 200, inside the mailer or a wrapper around any Mailer. Say plainly which way it fails
   (a crash between the 200 and the insert sends twice on retry; that is better than never), and
   prune rows older than a few days in the daily run (there is a prune step already). Sign-in
   links have no key and need none.
3. **Choose the mailer in `makeMailer` (src/env.ts)**: SES when both AWS keys are set, else Resend
   when `RESEND_API_KEY` is set, else ConsoleMailer. Log one line at start-up-equivalent (first
   use) when both SES and Resend are configured, saying SES wins. Update `src/dev.ts`
   `/__dev/test-email` docs, `scripts/measure-cpu.mjs` (stub the SES endpoint as it stubs Resend,
   so CPU of signing is measured), and the `AppEnv` comments in wrangler.jsonc listing secrets.
4. **Privacy page** (`src/web/site.tsx`, the processors list near "Resend (sending email…)" and the
   logs line): name **Amazon Web Services (Amazon SES), Ireland** for sending email. While both
   can be configured, list both ("Amazon SES, and Resend as a fallback"); a later commit removes
   Resend once it's gone. Keep the transfers paragraph accurate (SES in eu-west-1 keeps sending in
   the EU; AWS is still a US company). Don't change anything else on the legal pages.
5. **Tests**: signing vectors; request shape (endpoint, region, headers, body, List-Unsubscribe
   passed through); error mapping; idempotency (second send with the same key does nothing, a
   failed send can be retried, prune); `makeMailer` precedence. Alert and digest tests must keep
   their assertions unchanged.
6. **DECISIONS.md**: a section "Email: Amazon SES (2026-10-…)" with the design, the idempotency
   trade-off, and the **owner checklist** below, ticked as the owner reports each step done.

## Owner checklist (put it in DECISIONS; you do none of it)

1. AWS console, region eu-west-1: verify domain identity `stackquake.com` with Easy DKIM
   (2048-bit). Add the three `_domainkey` CNAMEs in Cloudflare, DNS only. They don't clash with
   Resend's records or Email Routing. (DNS change: the owner approves it; Claude may add them in
   Chrome if the owner says so.)
2. Optional custom MAIL FROM (`bounce.stackquake.com`: MX + SPF TXT), as Beckon describes.
3. Request production access (transactional: sign-in links, alerts the user subscribed to,
   weekly digests; unsubscribe link in every alert and digest; bounces via the account-level
   suppression list). Usually about a day. Until then SES only sends to verified addresses.
4. IAM user `stackquake-ses-production` with a policy allowing only `ses:SendEmail` on the
   `stackquake.com` identity ARN. Create an access key (not SMTP credentials: the Worker uses the
   API). Then `! pbpaste | npx wrangler secret put AWS_SES_ACCESS_KEY_ID` and the same for
   `AWS_SES_SECRET_ACCESS_KEY`. Staging gets its own user and keys (`--env staging`), or stays on
   Resend.
5. After deploy (owner's OK): sign in with a magic link and trigger a test alert
   (`/__dev/test-email` is local only; use staging, or a real alert); in the received mail's
   original, check `dkim=pass header.d=stackquake.com`, `spf=pass`, `dmarc=pass`, not in spam,
   List-Unsubscribe present on the alert.
6. After a clean week: delete the Resend production key, remove Resend's DNS records (`send`,
   `rsend` CNAMEs and `resend._domainkey` TXT; leave `_dmarc`), unset `RESEND_API_KEY`, and drop
   Resend from the privacy page. Consider DMARC `p=quarantine` then (DECISIONS M5).
7. Watch SES's reputation dashboard: bounces under 5%, complaints under 0.1%.

## Timing

Show HN may go out before this is live. Don't switch mail providers on launch day: deploy the
code with SES keys unset (Resend keeps sending), and turn SES on by setting the keys once the
account is out of the sandbox and step 5 passes.

## How to check your work

`npm run typecheck && npm test`; `npm run measure:cpu` runs to the end and the alert phases show
no CPU jump from signing. Don't deploy, push or touch AWS, DNS or Resend yourself. End with a
short summary, the updated DECISIONS section, and a prompt for the follow-up (removing Resend).
