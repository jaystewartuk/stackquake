# Show HN draft (not posted)

For the owner to edit and post. HN rules: a Show HN must be something people can try now, the
title starts "Show HN:", no marketing language, and the author answers in the comments.
Post from the owner's account; link to https://stackquake.com (not /pricing).

## Title (≤ 80 characters)

Show HN: Stackquake – alerts when a service you build on changes its pricing or licence

Alternatives:
- Show HN: Stackquake – get told when your host, database or runtime changes the deal
- Show HN: An email when Deno-style end-of-life news hits something in your stack

## Text

Hi HN. This week Deno announced it is joining Cloudflare: one more year of bug-fix releases for
the runtime, then development ends, and Deno Deploy shuts down in six months.
The same week Bitwarden moved to a dual-licence model. Before that it was Redis, Terraform, and a
long tail of free tiers that got smaller. Each time, the news was easy to miss unless you read that vendor's blog.

Stackquake watches the things a stack depends on and emails you when one of them changes the
deal: pricing and free-tier limits, licences, end-of-life and end-of-development notices,
acquisitions. You pick what you run on from a catalog (59 entries so far: Cloudflare, Vercel,
Supabase, Neon, Fly.io, Stripe, Clerk, Resend, OpenAI, Postgres, Redis, Node, Python…), say how
you use each one (hosted or self-hosted, commercial or personal, free tier or paid), or paste a
repo and it pre-ticks what it finds in package.json, Dockerfiles, wrangler.toml and so on.

How it works:
- Watchers poll vendor blog feeds, pricing and limits pages, npm/PyPI, GitHub repo metadata and
  endoflife.date. Pages are normalised (timestamps and tracking junk stripped) and diffed.
- New posts go through a classifier (Claude Haiku) that only passes deal changes; the note for a
  licence, end-of-life or acquisition change is written by Claude Opus. A note must quote the
  source verbatim; the quote is checked against the fetched text, and only deterministic kinds
  with high confidence are published without a human looking at them first.
- Matching against your usage is plain rules, so a self-hosting licence change doesn't alert
  someone on the hosted service. Events are computed once per source and shared, so it's cheap to
  run: it's one Cloudflare Worker with D1 and R2, and the LLM bill is a couple of dollars a month.

What it is not: vulnerabilities and version bumps (keep Dependabot/Snyk/Socket for those). Those
tools mostly check licences when a pull request changes your dependencies; this watches the
vendors themselves, including the hosted services that never appear in a manifest.

It's free for one project; a Team plan ($19/month) adds more projects, private repos via a
GitHub App, Slack and shared projects. Public pages for every event are at /events (with RSS) if
you just want to watch the feed.

Things I'd love feedback on: what's missing from the catalog (there's a "request it" box), and
whether the notes are blunt enough. Happy to answer anything about the pipeline.

## First comment (optional, technical)

Some things that were harder than expected:
- CPU per invocation. I built it for the Workers Free plan's 10 ms limit: every poll is its own
  small step on a job table, pages are asked for Markdown first (`Accept: text/markdown`, which
  Cloudflare, Vercel and others answer) and HTML is streamed through HTMLRewriter, stopping when
  the selector closes. Some marketing pages were still too heavy, so it runs on Workers Paid
  ($5/month) now; p99 is under 100 ms of CPU per invocation.
- Pricing pages change constantly for no reason. Normalisation plus a "material?" check on the
  diff is what keeps it quiet.
- A golden set of real announcements (the Deno post, the Bitwarden forum post, a Cloudflare
  pricing page with a synthetic free-tier edit, and routine posts that must not alert) runs
  against the live model before every release.

## Before posting (checklist)

Status 2026-10-13 (docs/DECISIONS.md "Launch").

- [x] Landing, pricing, terms and privacy live on stackquake.com; live billing on (Team $19/$190).
- [ ] **Business address** in /terms and /privacy (`ADDRESS` in src/web/site.tsx; they say
      "being set up" until then) and the **ICO data protection fee**. Owner.
- [x] Golden set passed on production's models in M6; review gate on; review queue empty.
- [ ] Sign-up to populated dashboard under 2 minutes in production: re-time with a fresh account
      (new projects now link sources at once; the owner's older project heals at the 06:07 UTC
      sync on 2026-10-14).
- [x] Published events on /events (7 on 2026-10-13).
- [x] support@stackquake.com forwards (owner received a test message, 2026-10-13).
- [x] Mail volume: Amazon SES since 2026-10-14 (50,000 a day, 14 a second), so launch-day magic
      links no longer hit Resend's 100-a-day cap. Watch SES bounces (<5%) and complaints (<0.1%).
- [ ] One live Checkout opened (or bought and refunded by the owner) to prove the restricted key.
- [ ] "This week Deno announced…": the news is from 2026-10-09; say "Last week" if posting after
      about 2026-10-16.
- [ ] Owner online for a few hours after posting to answer comments.
