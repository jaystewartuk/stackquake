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

## Stage 2: foundation and components (2026-10-11)

**Changed**
- **Styles** moved out of layout.tsx into `src/web/styles/`: `tokens.ts` (DIRECTION.md tokens; light and
  dark defined once, emitted for `:root` and `prefers-color-scheme: dark`, and reusable per element via
  `schemeVars()`), `base.ts` (reset, type, `:focus-visible`, `::selection`, reduced motion, layout
  primitives, legacy helpers), `components.ts`, `pages.ts`; `index.ts` joins and minifies them once per isolate.
  Legacy classes (`.card`, `.flash`, `.pill`, `.row`, `.spread`, `button.primary`…) are styled with the new
  tokens so pages not yet converted still look coherent; the missing admin `.cols` now exists.
- **Shell**: `<!doctype html>` (no more quirks mode), SVG favicon as a data URI, `color-scheme` and
  `theme-color` for both schemes, skip link to `main#main`, logo mark, labelled main nav with
  `aria-current`, nav as a scrolling second row under 40rem (no JS), account menu (`<details>`: Settings,
  Team, Admin, Sign out), footer with labelled nav and the disclaimer word for word.
- **Components** (`src/web/ui.tsx`, `src/web/icons.tsx`), each used by a real page: Button/ButtonLink
  (primary, secondary, quiet, danger; sm/md/lg; icons; disabled; pressed), Field (label, hint, error with
  `aria-describedby`/`aria-invalid`: sign-in, new project, project settings), InputGroup (catalog search,
  repo import), Choice chips (usage questions), PickTile (picker), Panel (+ danger: project Danger zone),
  Badge and KindPill with icons, Severity (alerts), StatusLine and Trace (dashboard), Callout/Flash (app
  flash messages, picker notices, admin), DataTable stacking on mobile (dep sources; fixes the muted dep
  page overflow), Tabs and segmented control (admin), EmptyState (404, catalog search, dep, alerts, empty
  project), Quote (event note), DataList (note fact strip, dep metadata), NoteCard (landing example),
  PageHeader (catalog, event, sign-in, dashboard, project, picker, usage, dep), StickyBar, Avatar, 26 icons.
- Severity is computed for presentation only: `depLevel` and `tracePoints` (stack-view.tsx), `alertLevel`
  (alerts-view.tsx), as in DIRECTION.md.
- Event note headings are now h1 → h2 (fixes heading-order); "Options" became "Ways out".
- **Gallery** at `/__dev/ui` (src/web/gallery.tsx; DEV_ROUTES and localhost only): every component in every
  state, light and dark columns side by side. In the shots as `dev-ui`.

**Numbers** (`.ui/audit/stage2/`, `.ui/shots/stage2/`): 160 shots, 0 with wrong status, overflow or console
errors (baseline: 4 overflowing). Lighthouse mobile 100 performance and 100 accessibility on all 8 audited
pages (baseline: event note 97), best practices 100 (baseline 92–96). axe: 0 violations on every page
except `admin-event-edit` (page-has-heading-one, pre-existing, stage 4) and the gallery (one duplicated
breadcrumb landmark, because the demo shows twice). HTML+CSS 7–10.8 KB gzipped per page (baseline 2.3–6;
budget 30).

**Left**: stage 3 redesigns the public pages with these components (landing hero and layout, pricing,
catalog cards, events list, legal ToC); stage 4 the app (needs-action list, dep rows with severity marks,
settings/team/billing panels, 402 UpgradePanel, admin Approve/Edit/Reject spacing and edit page h1).
Not built yet, as no page needs them: UpgradePanel, PlanCard, DiffView, OptionCard with effort meter.

## Stage 3: public pages (2026-10-11)

**Changed**
- **Landing** `/`: two-column hero at ≥64rem (kicker, h1, lede, one primary "Pick what you run on" with "or paste a
  repo" as a text link) beside the real Deno example note and the public feed's 90-day trace (each spike links to its
  note, newest labelled). Then How it works (3 numbered steps), What we watch (2×2) with the catalog as proof
  (59 entries, 13 categories, names and counts, no logos), Where it differs (a 5-row comparison with Dependabot/GitHub,
  Snyk and Socket from docs/COMPETITORS.md, each vendor's own quote cited, four differentiators), recent changes,
  a pricing strip and one closing call to action. No testimonials, no invented numbers.
- **Pricing**: PlanCard side by side, Team emphasised (accent border, label), prices in mono from plans.ts, the
  checkout form unchanged (same action, names, values, CSRF), FAQ as a two-column grid.
- **Catalog**: search plus a category jump bar with counts; each entry card shows what we read (Blog · 2 pages ·
  End-of-life dates…) and its latest published change (kind, date, "+n earlier"); two columns on phones.
  **Entry page**: breadcrumb to its category, recent changes as EventRows (or an empty state), a sticky rail with
  sources (icon, kind, link) and alternatives as chips.
- **Events**: list grouped by month, date in a mono margin column, the 90-day trace on top, RSS as a button.
  **Event note**: kind and subject kicker, h1 = the title, the summary as lede, FactStrip (Published, Takes effect,
  Source domain), the quote as centrepiece, What this means for you (who is affected, in plain words from
  `applies_when`), Who is not affected, Ways out as OptionCards with an effort meter, What the source doesn't say,
  the disclaimer word for word; a rail with the CTA and a permalink to share. Every indexable public page now has
  `canonical`, `og:*` and `twitter:card=summary`; notes are `og:type=article` with `article:published_time`.
  No og:image (see DECISIONS).
- **Sign in** and magic-link pages in a narrow centred column; expired link, 429, GitHub problems, 503 and 404 use the
  new ErrorPage (code, plain-words cause, next step). **Terms / Privacy / Bot**: DocPage with a contents list (sticky
  rail at ≥64rem), the privacy table stacks on phones. Legal wording checked word for word against the previous
  version (only the h1 moved into the component).
- New components: OptionCard + EffortMeter, PlanCard, ErrorPage, EventList/EventRow (redesigned), DataTable row
  headers and keyboard-scrollable mode, icons rss/link/layers. Fixed: trace spikes had no visible focus style
  (the stage 2 rule targeted `line`, the spikes are `path`s).

**Numbers** (`.ui/audit/stage3/`, `.ui/shots/stage3/`), before = baseline → stage 3:

| Public page | Lighthouse perf | A11y | Best pr. | axe (light/dark) | Gzipped HTML+CSS | Height at 390 |
|---|---|---|---|---|---|---|
| home | 100 → 100 | 100 → 100 | 92 → 100 | 1/1 → 0/0 | 5.6 → 14.8 KB | 5,629 → 6,635 px |
| pricing | 100 → 100 | 100 → 100 | 96 → 100 | 1/1 → 0/0 | 3.4 → 10.8 KB | 2,106 → 2,462 px |
| catalog | 100 → 100 | 100 → 100 | 96 → 100 | 1/1 → 0/0 | 3.6 → 11.7 KB | 6,542 → 5,295 px |
| catalog-entry | 100 → 100 | 100 → 100 | 96 → 100 | 1/1 → 0/0 | 2.9 → 10.8 KB | |
| events | 100 → 100 | 100 → 100 | 96 → 100 | 1/1 → 0/0 | 3.8 → 12.0 KB | |
| event-eol | 100 → 100 | 97 → 100 | 96 → 100 | 2/2 → 0/0 | 3.0 → 11.1 KB | |
| signin | 100 → 100 | 100 → 100 | 96 → 100 | 1/1 → 0/0 | 2.5 → 9.8 KB | |

axe: 0 violations on all 16 public pages (including the empty search, both other notes, terms, privacy, bot,
signin-sent, link-expired, 404) in light and dark; the only remaining findings are the gallery's duplicated demo
landmark and admin-event-edit's missing h1 (stage 4). 160 shots, none with a wrong status, overflow or console
errors. Keyboard: tab order checked on /, a note, /catalog, /pricing, /signin and /terms at 390 px: every stop
visible. Lighthouse SEO 92 on /catalog is a false positive (`link-text` flags the entry named "Go").

**Left**: the landing page is 6,635 px tall at 390 px, not the 3,500 px DIRECTION.md aimed for. The sections this
stage's prompt requires (steps, catalog proof, comparison, cited quotes, pricing) cost the height; on phones the
comparison table scrolls sideways, the vendor quotes are a swipe row and recent changes show 3. Stage 5 can trim
copy. The one-click alert pages (`/a/…`) and the 402 page are app pages (stage 4). PlanCard is ready for Settings.

## Stage 4: the signed-in app (2026-10-12)

**Changed**
- **Dashboard** `/app`: "Your stack" with project and dependency counts, the status line and 90-day trace, then **Needs
  your attention**: alerts act-first (severity word, dependency and kind, the change linking its note, why it affects
  you, delivery as text, "Useful? Yes / No"), five shown and the rest folded; with nothing open, one calm "Nothing needs
  you right now" line. Then each project: its own status line and trace, deps as rows grouped by risk (mark, name and
  usage, latest change or the reason, date), "No known risk" folded to a count, muted deps with a bell-off and dimmed.
- **New project**: a first-run welcome with an onboarding stepper (start, find, usage, dashboard), the name, then two
  side-by-side ways in: "Pick from the catalog" (primary) and "Or import a public GitHub repo"; Enter in the repo
  field now imports. **Picker**: sticky search, common entries first, two tile columns on phones, a live "n selected"
  in the sticky bar, the import result as a success callout. **Import progress**: the stepper, "Step 3 of 5", a
  progress bar and the importer's five steps as a checklist, the raw log under Details, "you can leave this page";
  with JS it updates in place every second and moves on to the picker when done (meta refresh only without JS). A
  failed import says what failed and offers "Pick services instead". **Usage questions** end with "Save and see the
  dashboard" when reached from the picker.
- **Project** and **dependency** pages on the main-and-rail layout: the project's pulse and risk groups beside a
  Repository panel; a dep's severity and reason under its title, changes (EventList), its alerts, usage questions,
  and a rail with About, What we watch (each source, kind and last check) and mute / stop watching.
- **Settings** as panels (Alerts, Email, Slack, Plan, Delete account) with an "On this page" rail at ≥64rem. Plan shows
  the plan, projects used against the Free limit, what Team adds and the two checkout buttons; Team shows billing
  interval, renewal and a payment-failed callout. **Team**: members with avatars, "4 of 10 people", invite with an
  inline field; Free gets the UpgradePanel. **Every 402** (new project limit, CSV export, private repos, Slack) is one
  UpgradePanel page; app 400/403/404/429/503 pages (billing, GitHub, Slack, email, team, delete) use ErrorPage.
  **GitHub**: install page in the narrow column, repos as radio tiles. **One-click alert links**: the narrow column,
  one large confirm button, "Nothing changes until you press the button"; done and bad-link pages to match.
- **Admin**: review cards as panels with status and kind badges, the quote, "quote found" as a badge, DiffView for
  before/after, Approve / Edit / Reject as buttons; the edit page has an h1 and real fields; sources and requests
  in panels. Email templates (src/alerts/render.ts) untouched.
- Shots: 13 new pages (import progress and failure, onboarding usage, alert-link done and bad link, free team and
  project, member dashboard and settings, GitHub unavailable…), 52 in all; `npm run ui:peek` for close looks.

**Numbers** (`.ui/audit/stage4/`, `.ui/shots/stage4/`): 208 shots, none with a wrong status, overflow at 390 px or
console errors. axe: 0 violations on all 35 app, admin and alert-link pages in light and dark (baseline: 1 on each,
2 on admin edit), and on every public page; the only finding left is the gallery's duplicated demo breadcrumb.
Lighthouse mobile on `/app`: performance 100, accessibility 100, best practices 100, CLS 0 (stage 3: a11y 100 too;
the intermediate build's muted-row opacity failed contrast and was fixed). Gzipped HTML+CSS: app pages 11.5–15.9 KB
(stage 3: 9.5–12.7), public pages up about 2 KB from the shared CSS (home 16.7 KB; budget 30). Keyboard: tabbed through
dashboard, project, dep, settings, team (owner and Free), picker, first-run new project and the admin queue at 390 px:
every stop visible and on screen; picker tiles keep clear of the sticky search and action bar. Checked at 390 and 1280,
light and dark, seeded and empty (first run, empty project, no alerts, Free and member accounts).

**Left for stage 5**: remove the legacy class aliases (`.card`, `.pill`, `button.primary`…) now that no app page uses
them (admin sources/requests still use `ul.plain`); the landing page height at 390 px; the dev gallery's duplicate demo
landmark; a final pass over copy.
