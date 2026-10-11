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
- The Workers Free plan's 10 ms CPU limit per invocation. Every poll is its own small step on a
  job table; pages are asked for Markdown first (`Accept: text/markdown`, which Cloudflare,
  Vercel and others answer) and HTML is streamed through HTMLRewriter, stopping when the selector
  closes. A few marketing pages are still too heavy.
- Pricing pages change constantly for no reason. Normalisation plus a "material?" check on the
  diff is what keeps it quiet.
- A golden set of real announcements (the Deno post, the Bitwarden forum post, a Cloudflare
  pricing page with a synthetic free-tier edit, and routine posts that must not alert) runs
  against the live model before every release.

## Before posting (checklist)

- [ ] Landing, pricing, terms and privacy live on stackquake.com (M6).
- [ ] Golden set passes on production's models; review gate on (SPEC §12).
- [ ] Sign-up to populated dashboard under 2 minutes in production (timed in M6).
- [ ] At least a few published events on /events, so the public feed isn't empty.
- [ ] hello@stackquake.com forwards (Cloudflare Email Routing).
- [ ] Watch Resend's daily limit (100/day on the free plan): a launch day can pass it with
      magic links alone. Upgrade Resend first if sign-ups look likely to pass ~80 a day.
- [ ] Owner online for a few hours after posting to answer comments.
