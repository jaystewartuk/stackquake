# Design direction

Stage 1 of the UI redesign (prompts/ui/BRIEF.md). It follows from `docs/design/AUDIT.md`: the
pages are fast and accessible but flat, the dashboard doesn't answer "do I need to act?", and the
event note, the product's best artefact, is its plainest page. Stages 2–5 build what is written
here; change it here first if a later stage finds a reason to.

## Three directions

### A. Seismograph: a calm instrument
- **Personality**: a well-made measuring instrument. Quiet until something moves, then exact
  about what moved, when, and by how much. Linear's restraint, Stripe docs' reading comfort.
- **Type**: system sans for text, system monospace (tabular) for every machine fact: dates,
  versions, prices, counts, plan limits. Tight, deliberate scale; weight does the work, not size.
- **Colour**: warm-neutral greys carry almost everything. Orange is the *signal*: it appears where
  something changed and needs you (and on the one primary action per page). Three severities with
  fixed meaning: **act** (red), **watch** (amber), **quiet** (neutral), plus info blue and ok green
  for system states, never for event kinds.
- **Density**: medium-high in the app (rows, not cards; one line per dep at 1280 px, two at 390),
  generous on the note and the landing page.
- **Signature element**: the *trace*: a thin seismograph line (inline SVG, ~1 KB) that is flat
  for quiet stretches and spikes at each published change, height by severity. It appears in the
  landing hero (the last 90 days of the real public feed), on each project in the dashboard (its
  deps' latest changes over 90 days) and as a small mark beside an event's date. It is data, not
  decoration: every spike is a real event and links to it.
- **Dashboard**: a status line first ("2 need action · 3 to watch · 19 quiet", with the trace
  under it), then a short "Needs action" list (one row per change: severity mark, dep, what
  changed, deadline, "Read note"), then projects as compact risk-grouped tables. Feedback buttons
  shrink to a small "Useful? Yes / No" inline control. Quiet deps collapse to one line per group.
- **Event note**: a document. Kicker (kind · subject), h1 without the repeated subject, a fact
  strip (Published, Takes effect, Source) in mono, the quote as the centrepiece with a hanging
  quote mark and the source domain as its citation, then **What this means for you**, **Who is
  not affected**, **Ways out** as option cards with an effort meter, **What the source doesn't say**,
  and the disclaimer.

### B. Field notes: an editorial bulletin
- **Personality**: a trusted newsletter or a good law blog. Paper, ink, footnotes.
- **Type**: a serif for headings and notes (system serif stack: Charter, Iowan Old Style,
  Georgia), sans for UI. Large measure-controlled text.
- **Colour**: off-white paper, near-black ink, one deep red-orange for marks and links.
- **Density**: low everywhere; whitespace and rules instead of boxes.
- **Signature element**: the pull-quote with a numbered source footnote, like a citation.
- **Dashboard**: a dated "bulletin" listing of changes, then projects as plain indented lists.
- **Event note**: an article with a drop-cap summary, the quote as a large pull-quote, footnoted
  source.
- Why not: beautiful for the note, weak for the dashboard (the question there is "what needs me",
  which an editorial layout answers slowly), and system serifs vary a lot across platforms
  (Georgia on Windows and Android looks dated); a good webfont would cost 40–80 KB.

### C. Signal board: bold status
- **Personality**: a status page or deploy dashboard. High contrast, big numbers, colour blocks.
- **Type**: heavy sans, oversized numerals.
- **Colour**: black and white with saturated orange, red and green fills.
- **Density**: low; big cards and badges.
- **Signature element**: a "magnitude" badge (1–5) on every event, like a Richter reading.
- **Dashboard**: a grid of project cards with big counts and coloured badges.
- **Event note**: a magnitude badge and a bold headline, the note in cards.
- Why not: loud where the brief asks for calm; a magnitude score would be a number we invent
  (the pipeline has no such measure, and a made-up score undermines "exact and trustworthy");
  colour fills fight dark mode and colour-blind users.

## Choice: A, Seismograph

It is the only one that serves both halves of the product: it makes the dashboard answer "is
anything changing, do I need to act?" in one line, and with B's best idea (the quote as the
centrepiece of a well-set document) it makes the note read beautifully. The "quake" idea becomes
a real data display rather than a pun, it needs no font download (system sans and mono), it is
calm by default and loud only where the data is, and its severities are derived from facts the app
already has (event kind and the alert's match), not invented.

## Tokens

All tokens are CSS custom properties on `:root`, overridden in
`@media (prefers-color-scheme: dark)`. Names are what stage 2 implements.

### Type
- `--font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- `--font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`
- Machine facts (dates, versions, prices, counts) use `--font-mono` at 0.92em with
  `font-variant-numeric: tabular-nums`.
- Scale (rem, line-height): `--text-xs` 0.75/1.4 (labels, kickers, uppercase +0.04em tracking),
  `--text-sm` 0.875/1.45 (meta, table cells), `--text-base` 1/1.55 (body), `--text-md` 1.125/1.5
  (lede, note summary), `--text-lg` 1.375/1.3 (h2), `--text-xl` 1.75/1.2 (h1 in app and notes),
  `--text-2xl` `clamp(2rem, 1.4rem + 3vw, 3rem)`/1.08 (landing h1 only, -0.025em tracking).
- Weights: 400 body, 500 UI labels and nav, 600 headings and dep names, 700 only the landing h1.
- Measure: prose and notes max 40rem (~68 characters).

### Colour (contrast checked with the WCAG 2 formula; ratios against `--bg` / `--surface`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f8f8f6` | `#121211` | page |
| `--surface` | `#ffffff` | `#1a1a18` | panels, rows, inputs |
| `--sunken` | `#f1f1ee` | `#0d0d0c` | quote, code, table header |
| `--line` | `#e3e2de` | `#2c2b28` | dividers (decorative) |
| `--line-strong` | `#c9c7c1` | `#45433f` | panel borders (decorative) |
| `--control` | `#8a8781` | `#6f6c66` | input and checkbox borders: 3.37 / 3.58 light, 3.58 / 3.33 dark (≥ 3:1, WCAG 1.4.11) |
| `--fg` | `#1a1917` | `#edece8` | text: 16.5 / 17.6 light, 15.9 / 14.7 dark |
| `--muted` | `#56544f` | `#aeaba4` | secondary text: 7.1 / 7.6, 8.2 / 7.6 |
| `--subtle` | `#6b6963` | `#93908a` | meta, placeholders: 5.2 / 5.5, 5.9 / 5.5 |
| `--accent` | `#c2410c` | `#f97316` | primary button fill, focus of attention, trace spikes |
| `--on-accent` | `#ffffff` | `#1a1917` | text on accent: 5.18 light, 6.27 dark |
| `--accent-text` | `#b13a09` | `#fb923c` | accent as text/links: 5.7 / 6.0, 8.3 / 7.7 |
| `--act` / `--act-bg` | `#b42318` / `#fdecea` | `#ff8a80` / `#3a1a17` | needs action: 6.2 / 6.6 on page, 5.8 on its tint; dark 8.2 / 7.6, 6.9 |
| `--watch` / `--watch-bg` | `#8f5200` / `#fdf3e1` | `#f5b94a` / `#33270f` | worth watching: 5.9 / 6.2, 5.7; dark 10.6 / 9.9, 8.3 |
| `--info` / `--info-bg` | `#38597a` / `#eaf0f6` | `#9cc0e3` / `#172636` | neutral system info: 6.9 / 7.3, 6.4; dark 9.9 / 9.2, 8.1 |
| `--ok` / `--ok-bg` | `#1c6e3c` / `#e8f4ec` | `#6fd391` / `#14291c` | sent, saved, connected: 5.9 / 6.3, 5.6; dark 10.2 / 9.5, 8.4 |
| `--focus` | `#1d5fd1` | `#7ab0ff` | focus ring: 5.5 light, 8.5 dark |

Every text pair is AA (4.5:1) or better, most AAA; non-text indicators are ≥ 3:1. Colour is never
the only signal: severities also carry a shape (filled bar, hollow bar, dot) and a word.

**Severity mapping** (presentation only, from data the app already has):
- *Act*: an alert with match `affected` whose event kind is licence, end of life, acquisition or
  free tier (the existing `URGENT` set), or a dep that is archived/deprecated.
- *Watch*: other affected or `unknown` alerts (pricing, other), no-licence packages, single vendor.
- *Quiet*: `not_affected` (suppressed) alerts, deps with no known risk, muted deps.
On public pages (no user context) events show their kind, not a severity.

### Spacing, radius, elevation
- Spacing (4 px base): `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 24, `--s-6` 32,
  `--s-7` 48, `--s-8` 64 px. Page gutter 16 px under 40rem, 24 px above; content max 72rem in
  the app, 64rem on public pages, 40rem for prose.
- Radius: `--r-1` 4 px (badges, code), `--r-2` 6 px (buttons, inputs), `--r-3` 10 px (panels),
  `--r-pill` 999 px (only for counts and avatars).
- Elevation: borders, not shadows. `--shadow-1: 0 1px 2px rgb(0 0 0 / .06)` for raised panels in
  light; `--shadow-2: 0 4px 16px rgb(0 0 0 / .10)` for the sticky action bar only. Dark mode uses
  a lighter surface instead of shadows.

### Motion
- `--ease: cubic-bezier(.2, .7, .2, 1)`, `--dur-1` 120 ms (hover, press), `--dur-2` 200 ms
  (details open, flash in). The trace may draw itself once on the landing page (stroke-dashoffset,
  600 ms). Nothing loops.
- `@media (prefers-reduced-motion: reduce)`: all transitions and the trace animation off
  (`transition: none; animation: none`).

### Focus
`:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }` on every interactive
element, including the picker tiles (via `:has(:focus-visible)`) and summary elements.

### Iconography
Inline SVG only, no icon font, no sprite request: a `src/web/icons.tsx` module of components,
16 and 20 px, 1.5 px stroke, `currentColor`, `aria-hidden="true"` (the text beside them carries
the meaning). Set: logo mark (a trace in a rounded square, also the favicon as a data URI),
arrow-right, external-link, quote, calendar, clock, alert-triangle (act), eye (watch), check (ok),
bell-off (muted), search, plus, trash, github, slack, mail, chevron-down, x, users, download.

## Components (stages 2–5)

Built once in stage 2 as JSX components and CSS in `src/web/styles/*.ts`, then used by every page.

1. **Shell**: header with logo mark, labelled primary nav with `aria-current`, account menu
   (`<details>` with no JS) holding Settings, Team, Admin and Sign out so the mobile header stays
   one line; skip link; footer with labelled nav and the disclaimer; doctype, favicon,
   `theme-color` for both schemes.
2. **PageHeader**: breadcrumb, title, optional kicker and actions.
3. **Button**: primary, secondary, ghost, danger; sm/md/lg; full width on mobile where useful.
4. **Field**: label, hint, error, input/select/textarea at sensible max widths; inline
   input + button group.
5. **Choice** (radio/checkbox as segmented chips) for usage questions; **PickTile** for the picker.
6. **Badge**: event kind (neutral with icon) and **Severity** mark (act/watch/quiet: bar + word).
7. **Trace**: the seismograph SVG, server-rendered from a list of `{date, severity, href}`.
8. **StatusLine**: "2 need action · 3 to watch · 19 quiet" with counts in mono.
9. **DepRow** and **RiskGroup** (table-like rows; quiet groups collapse).
10. **AlertRow** with compact feedback ("Useful?" Yes/No) and delivery state as text, not a pill.
11. **EventRow** (list) and **EventNote** (full note: FactStrip, Quote with citation, sections,
    OptionCard with effort meter, Uncertain list, disclaimer).
12. **Callout**: info, success, warning, error (flash messages, Free-plan notices).
13. **EmptyState** and **ErrorPage** (404, 400, 402, 429, 503) with a next step.
14. **UpgradePanel** for every 402/limit page (what Team adds, price, one button).
15. **PlanCard** (pricing and settings).
16. **Panel**/**Section** with an optional danger variant (Danger zone).
17. **StickyBar** for long forms (picker, usage).
18. **DiffView** before/after side by side (admin, and old/new values on pricing notes).
19. **Tabs** as links (admin status filter, settings sections if needed).
20. **DataList** (dt/dd) for sources, plan details, repository.

## As built (stage 2)

- Tokens: `src/web/styles/tokens.ts` (the table above, plus `--accent-bg` for a faint accent tint). Dark
  mode drops `--shadow-1` (lighter surfaces instead).
- Styles: `src/web/styles/{tokens,base,components,pages}.ts`, joined and minified in `styles/index.ts`.
  Add component CSS to `components.ts` next to its neighbours; page layouts to `pages.ts`.
- Components: `src/web/ui.tsx` (Button, ButtonLink, Field, InputGroup, Choice, PickTile, Panel, Badge,
  Severity, Callout, Flash, PageHeader, DataTable, Tabs, EmptyState, Quote, DataList, NoteCard, StatusLine,
  Trace, StickyBar, Avatar); icons in `src/web/icons.tsx`; shell (SiteHeader, Layout) in `layout.tsx`.
- See them all at `/__dev/ui` with `npm run dev`.
- Still to build when a page needs them: UpgradePanel, DiffView, AlertRow and DepRow in their final form.

## As built (stage 3)

- Added to `ui.tsx`: OptionCard + EffortMeter (3 bars + the word), PlanCard (name, mono price, period, checked
  features, action slot; `featured`), ErrorPage (code, h1, cause, actions), DataTable `rowHeader` and a
  keyboard-scrollable mode (`stack={false}` makes the wrapper a focusable region). `events-view.tsx`: EventRow /
  EventList (date margin column), NoteView in its final order, `whoIsAffected`, `noteFacts`, `latestByCatalog`.
  `public.tsx`: `feedTrace` (90-day public trace, used on / and /events). `site.tsx`: DocPage for legal pages.
- Layout emits `canonical`, Open Graph and `twitter:card=summary` on indexable public pages (`page()` decides:
  not /app, /admin, /a, /auth, and only for 200s); `ogType: "article"` for notes.
- Page layouts in `styles/pages.ts`: `.split` + `.rail` (main column and a sticky 20rem rail at ≥64rem), landing
  `.hero`/`.band`/`.steps`/`.cat-proof`/`.compare`/`.cite-grid`/`.price-strip`/`.cta-band`, catalog cards,
  `.month-h`, `.note`, `.plans`/`.faq-grid`, `.auth`, `.doc`/`.toc`.

## As built (stage 4)

- Added to `ui.tsx`: Stepper (onboarding steps, `aria-current="step"`; labels of other steps hidden visually under
  40rem), ProgressSteps (native `<progress>` plus a done/current/todo checklist), UpgradePanel (every 402 and plan
  limit; `page` makes it the h1), DiffView, AuthShell (moved from auth.tsx), Severity `mark` (shape only, word for
  screen readers).
- `stack-view.tsx`: DepRow (mark, name and usage, latest change or the reason it is in its group, date; one line at
  ≥48rem, two on phones), StackView with folding "No known risk", `levelCounts`. `alerts-view.tsx`: AlertItem (severity
  word, dep and kind, title linking the note, "Affects you because", delivery as text, "Useful? Yes / No"), AlertList
  with `top` (act first, rest folded) and the not-affected fold.
- `app-ui.tsx`: `problemPage()` and `upgradePage()` for the app's error and 402 pages; plan feature lists live in
  `src/billing/plans.ts`.
- App layouts in `styles/pages.ts` ("App (stage 4)"): dashboard `.attention`/`.all-clear`/`.project-pulse`, new project
  `.paths`, picker (sticky search, two tile columns on phones, live "n selected" in the sticky bar), import progress,
  dep and project pages on `.split` with a rail, settings with an "On this page" rail at ≥64rem, admin `.review`.

## The pages that matter most

### 1. Landing `/`
- **Hero** (first 600 px at 1280, first screen at 390): kicker "Change radar for your stack", h1
  (kept), one-sentence lede, primary "Pick what you run on" and a ghost "or paste a repo", the
  reassurance line in small text. To the right on desktop (below on mobile): **the example note**
  rendered with the real EventNote component in a framed "email" card, and under it the trace of
  the last 90 days of the public feed with the newest spike labelled.
- **How it works**: three short steps in one row (Pick or import → Say how you use it → Get one
  quoted note when the deal changes), each with an icon.
- **What we watch**: four compact items in a 2×2 grid (no orphan), then the catalog as a single
  line of names with "and 40 more →".
- **Where it differs**: a three-column comparison (GitHub, Socket, Snyk) with each quote as a
  small cited quote, then the five differentiators as a tight two-column list.
- **Recent changes**: five EventRows with kind badges and the trace mark.
- **Pricing strip**, footer. Target at 390 px: under 3,500 px tall (5,600 today).

### 2. Dashboard `/app`
- **Header row**: "Your stack", project count, actions (New project; Export CSV for Team) on the
  right; on mobile, actions go into one row under the title.
- **StatusLine + Trace** across the top: counts of act/watch/quiet across all projects, and the
  90-day trace of the deps' latest changes.
- **Needs action**: up to 5 AlertRows (severity mark, dep, change title without the repeated
  subject, takes-effect date, "Read note →", compact feedback). "All alerts (8)" expands the rest
  in a `<details>`, and the not-affected ones stay collapsed under it as today.
- **Projects**: one panel each: name, repo, member/quiet notes, the project's trace, then risk
  groups as rows. Changed-recently and archived rows show the event; single-vendor, no-licence
  rows show their reason; "No known risk" collapses to a count with a `<details>` list. Muted
  deps show a bell-off icon and dim their event.
- **Empty state** (no projects): redirect stays; the onboarding page carries the welcome.

### 3. Event note `/events/{id}`
- Breadcrumb (Events / Subject), kicker (kind badge · subject linked to the catalog), h1 (title
  only), **FactStrip** (Published, Takes effect (highlighted when set), Source domain) in mono.
- **Quote** first-class: large, `--sunken` panel, hanging quote mark icon, citation line "— deno.com,
  read the source ↗" linking to the source.
- **What changed** (the note's summary in `--text-md`), **What this means for you** (signed in and
  affected: the alert's "because" line and the user's usage; otherwise "who is affected" from
  `applies_when` in plain words), **Who is not affected**, **Ways out** (OptionCards: name linked
  to the catalog, why, effort meter low/medium/high), **What the source doesn't say**, then the
  disclaimer "Summary, not legal advice; read the source." (word for word) and the CTA panel.
- Headings h1 → h2 in order (fixes axe and Lighthouse 97). Measure 40rem; on desktop the fact
  strip and CTA can sit in a right rail at ≥ 64rem.

## Budgets the stages must hold
Public pages under 30 KB gzipped HTML+CSS (today 2–6 KB; the CSS may grow to ~12 KB raw), no
layout shift, Lighthouse mobile performance ≥ 95 and accessibility 100 on public pages, axe clean
(0 violations) in light and dark, no horizontal overflow at 360 px.
