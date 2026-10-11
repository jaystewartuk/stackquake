# UI redesign brief (shared by prompts/08-ui-*.md)

Saved 2026-10-11. The owner asked for a world-class UI for Stackquake and delegated the design
choices ("you choose"). It runs as an unattended chain on the devbox (Beckon `devbox/launch
--chain`), one fresh Claude Code session per stage. Each stage reads this file first.

## What Stackquake is
A change radar for the services and packages a stack depends on: licence changes, end-of-life
notices, acquisitions, pricing and free-tier changes, each as a short note that quotes and links
its source. Read SPEC.md §1–3 and §2 "Positioning" (services first, neutral, "what this means for
you", not tied to GitHub). The audience is developers and small teams who are tired of noisy tools:
the UI should feel calm, exact and trustworthy, like a good instrument, not a marketing site.

## The bar
"World class" here means: the landing page explains the product in five seconds and the example
note sells it; onboarding (pick services, or import a repo) feels fast and obvious; the dashboard
answers "is anything I depend on changing, and do I need to act?" at a glance; event notes read
beautifully (quote, source, "what this means for you", alternatives); every page works at 360 px
wide, in light and dark, by keyboard and screen reader. Think Linear, Stripe docs and Vercel's
dashboard for craft, but with Stackquake's own identity (the orange accent and the "quake" idea
can stay or evolve; the stage 1 direction decides).

## Hard constraints
- **Server-rendered Hono JSX stays.** No SPA, no React, no CSS framework, no build step for CSS.
  Client JS only as small progressive enhancements (the picker filter exists today); every page
  must work with JS off. Keep CSS in one place (it is a string in src/web/layout.tsx today; you may
  split it into src/web/styles/*.ts modules).
- **No third-party requests from pages**: no font CDNs, analytics or remote images (the privacy
  page promises this). A self-hosted font is allowed only if it is small, served by the Worker,
  and worth it; system font stacks are fine.
- **Behaviour does not change.** Same routes, forms, field names, CSRF tokens, redirects, status
  codes and access rules. Source text stays escaped (never `raw()` on fetched content). Keep the
  legal lines ("Summary, not legal advice", the footer disclaimer) and the meaning of /terms and
  /privacy word for word. Copy elsewhere may be improved; prices and plan limits may not change.
- **Tests stay green**: `npm run typecheck && npm test` is the chain's check after every stage.
  When a test asserts on markup that you deliberately changed, update the assertion, never delete
  the test's intent.
- **Performance**: pages stay light (aim under 30 KB of HTML+CSS gzipped for public pages, no
  layout shift, Lighthouse mobile performance 95+ and accessibility 100 on public pages).
- **Nothing leaves the box.** No deploys, no `wrangler` remote commands, no pushes, no accounts.
  The box has no Cloudflare or GitHub credentials and no production secrets; keep it that way.
  Commit on the chain's branch in logical steps with clear messages.

## Local setup on the devbox (2 vCPU, 3.7 GB RAM: run one heavy thing at a time)
- `npm ci` in the worktree if `node_modules` is missing.
- `.dev.vars` must contain no real keys. Use exactly: `DEV_ROUTES=1` and `ADMIN_EMAILS=dev@example.com`
  (add others such as `LINK_SECRET` or `APP_ORIGIN=http://localhost:8787` only if a page needs
  them, with values you generate locally; with no `RESEND_API_KEY` mail is printed to the log, and
  with no `ANTHROPIC_API_KEY` the LLM is not called).
- `npm run db:migrate:local`, then `npm run dev` (wrangler dev, local mode, port 8787). Sign in with
  a magic link: request it on /signin and read the link from the dev server's log.
- Seed realistic data for screenshots (projects, deps, published events with quotes, alerts) with
  a script under `scripts/` that writes to the local D1 (for example through a `/__dev/seed` route
  in src/dev.ts, which is already local-only behind DEV_ROUTES). Make the seed deterministic so
  before/after shots are comparable.
- Chromium for Playwright is already in ~/.cache/ms-playwright. Screenshot and audit tooling goes
  in `scripts/ui/` (Playwright, axe-core, Lighthouse as devDependencies are fine); output goes to
  `.ui/` at the repo root, which is gitignored (add it to .gitignore).

## Artifacts every stage keeps up to date
- `docs/design/DIRECTION.md`: the chosen direction (stage 1), the tokens and components (stage 2+).
- `docs/design/PROGRESS.md`: one short section per stage: what changed, what is left, numbers.
- `docs/DECISIONS.md`: a "UI redesign" section, one line per choice and why.
- `.ui/shots/<stage>/`: screenshots of every page at 390×844 and 1280×800, light and dark.
  `.ui/shots/baseline/` is taken in stage 1 before any change and never overwritten.
