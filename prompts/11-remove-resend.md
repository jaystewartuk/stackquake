# Prompt 11: remove Resend

Saved 2026-10-13. Paste into a new Claude Code session in this repo, only after DECISIONS "Email:
Amazon SES" owner checklist steps 1–5 are ticked and SES has sent cleanly for a week (step 6's
condition). Deploying, pushing, anything in AWS, Cloudflare DNS or Resend are the owner's: ask first.

---

Read docs/DECISIONS.md "Email: Amazon SES" and "Email (Resend) and DNS on stackquake.com" first.
SES is the production mailer; remove Resend, each step its own commit with `npm run typecheck &&
npm test` green:

1. Delete `src/platform/resend.ts` and the `RESEND_*` env fields; `makeMailer` becomes SES, else the
   console. Move `DEFAULT_FROM` to `ses.ts`. The alert tests use `mockResend` (test/alert-helpers.ts)
   to read what was sent: replace it with a mock of the SES endpoint (same `sent`, `failWith`,
   `requests` shape, body read from the SES JSON) and keep every alert/digest assertion's meaning.
   The mock should also honour `mail_sends`, or the tests should wrap with `IdempotentMailer`, so
   the "retried step cannot send twice" tests still prove something.
2. Remove Resend from `scripts/measure-cpu.mjs` (the `/resend` stub route), `wrangler.jsonc`
   comments, `src/dev.ts` docs, `.dev.vars.example` if any, and the DECISIONS "Secrets" list.
3. Privacy page (`src/web/site.tsx`): drop Resend from the processors list and the logs line; leave
   the rest of the legal pages alone.
4. DECISIONS: tick checklist step 6 only when the owner reports it done; record that
   `IdempotentMailer` now applies to the only real mailer.
5. Owner steps to list (do none): delete the production Resend key, remove the `send` and `rsend`
   CNAMEs and `resend._domainkey` TXT in Cloudflare (keep `_dmarc`), `npx wrangler secret delete
   RESEND_API_KEY` (and on staging), then consider DMARC `p=quarantine`.

Don't deploy, push or touch AWS, DNS or Resend. End with a short summary.
