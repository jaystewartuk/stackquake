# UI redesign progress

One section per stage of prompts/08-ui-*.md. Numbers come from `npm run ui:audit -- <stage>`
(`.ui/audit/<stage>/summary.md`).

## Stage 1: audit, baseline and direction (2026-10-11)

**Changed**: no page. Added the tooling and the documents.
- `POST /__dev/seed` (src/dev-seed.ts, local only behind `DEV_ROUTES`) and `npm run ui:seed`:
  wipes users, projects, events and alerts in the local D1 and writes the same demo set every
  time (dates fixed around 2026-10-11): a Team owner `dev@example.com` (also the admin) with two
  members and a pending invite; project "platform" from a monorepo import (16 deps: services,
  runtimes, npm/PyPI/Go packages, one deprecated, one unlicensed) and "homelab" from the picker
  (8 services, one muted); 10 published events (EOL, free tier, licence ×2, pricing ×2,
  acquisition, deprecated) plus one in review and one rejected; alerts sent, held, in a digest,
  failed and suppressed, with feedback; a Free user with one project; a blocked and a failing
  source; catalog requests and LLM spend for the admin pages. `GET /__dev/link` signs a one-click
  alert link.
- `npm run ui:shots -- <name> [pages…]`: 39 pages (public, app, other users, admin, 400/402/404)
  at 390×844 and 1280×800, light and dark, full page, plus `index.json` with status, overflow and
  console errors. `npm run ui:audit -- <name> [pages…]`: axe-core (WCAG 2.2 AA + best practice,
  light and dark) on every page, Lighthouse mobile on the public pages and /app, and gzipped page
  sizes; `summary.md` per run.
- `docs/design/AUDIT.md` (page by page) and `docs/design/DIRECTION.md` (three directions, the
  choice: "Seismograph", tokens, components, target layouts).

**Baseline numbers** (`.ui/audit/baseline/`): Lighthouse mobile performance 100 on all 8 pages,
accessibility 100 (event note 97), best practices 92–96 (no doctype; favicon 404); axe: 3 moderate
rules (`landmark-unique` everywhere, `heading-order` on 6 pages, `page-has-heading-one` on admin
edit), no contrast failures; pages 2.3–6.0 KB gzipped; horizontal overflow at 390 px on 2 pages.

**Left for stage 2**: implement the tokens, shell and components from DIRECTION.md; fix doctype,
favicon, nav labels, heading order and the sign-out alignment as part of the shell.

**Running it on the box**: `npm ci`, `.dev.vars` as in the brief (plus a locally generated
`LINK_SECRET` and `CHANNEL_KEY`; not `APP_ORIGIN`: the vitest pool reads `.dev.vars` too and three
tests expect it unset), `npm run db:migrate:local`, `npm run dev`, then the
scripts. Playwright is pinned to 1.64.0 because that is the version whose Chromium (build 1248)
is already in `~/.cache/ms-playwright`.
