# Prompt 07: finish M6 and launch

Saved 2026-10-11. Paste this into a new Claude Code session in this repo (Opus 5.5 or
Sonnet 5.5 · high). Money and accounts need the owner: ask before anything in Stripe live mode,
before moving to Workers Paid, and before posting anything public. Never paste secrets into chat:
move them by clipboard (see DECISIONS M5 "Secrets" and M6 "Billing").

---

Read docs/DECISIONS.md M5 and M6 first (it wins over SPEC.md), then docs/SHOW_HN.md. M6 is built
and deployed on branch `m6-launch` (merge it to `main` first if it isn't). What is left:

1. **Production CPU: decided in M6** (Workers Paid since 2026-10-11, DECISIONS M6 "Production CPU").
   Check a day of ticks on Paid: `exceededResources` should be 0, CPU per tick well under 30 s, monthly
   CPU-ms well under the included 30 M; `/admin/sources` (or D1) for failing or blocked sources. Tune
   `JOBS_PER_TICK`/`HEAVY_PER_TICK` if feeds or pages fall behind.
2. **Re-time sign-up in production** once the sync has linked sources (the M6 run showed "no
   sources yet"). The owner's production user exists (GitHub); time a fresh project from
   "New project" to a populated dashboard, or ask the owner to time a brand-new sign-up on a
   phone. Target: under 2 minutes (SPEC §12 M6).
3. **Live billing (Managed Payments, prices include tax; DECISIONS M6, last section).** Check the
   Stripe account "Stackquake" (acct_PLACEHOLDER) is activated (the owner clicks "Agree and
   submit"). Then, with the owner's explicit approval of the live product and prices ($19/month,
   $190/year, USD, tax included): in live mode, run the Managed Payments setup (Settings → Managed
   Payments; accepting its terms is the owner's click), set "Include tax in prices" = Yes, set the
   support email to support@stackquake.com (already set on the account; check it), and repeat the M6 test-mode setup (product with tax code
   `txcd_10103001`, prices with lookup keys, webhook to
   `https://stackquake.com/stripe/webhook`, Portal configuration, a restricted key
   `stackquake-production-worker` with Customers, Checkout Sessions, Customer Portal and
   Subscriptions write), put the four `STRIPE_*` secrets on production with `wrangler secret
   bulk` from a 0600 scratch file, and check that /pricing shows the buttons. Do not make a live
   charge unless the owner wants to buy one themselves and refund it.
4. **Legal leftovers (owner):** a business address for /terms and /privacy (`ADDRESS` in
   src/web/site.tsx; E-Commerce Regulations reg. 6) and the ICO data protection fee. The terms
   were reviewed by Claude against UK law in M6, not by a lawyer.
5. **Show HN.** Walk the checklist at the bottom of docs/SHOW_HN.md (Resend's 100 emails/day free
   limit matters on launch day: magic links count). Give the owner the final text; do not post.
6. After launch: watch alert feedback (G3: < 10% "not relevant"), `/admin` review queue, LLM
   spend, and Resend bounces; consider DMARC `p=quarantine` after a few weeks of clean reports.

Record everything in a "Launch" section of docs/DECISIONS.md, commit in logical steps, and end
with a short summary and a prompt for the next session.
