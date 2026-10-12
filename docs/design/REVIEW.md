# UI redesign: review for the owner

Branch `ui-redesign`, five stages (prompts/08-ui-*.md), 2026-10-11 to 2026-10-12. Direction: "Seismograph", a calm
instrument (DIRECTION.md). This file is what to look at before merging: the pages before and after, the audit numbers,
what was left out on purpose, and the changes a user would notice.

## How to look

Screenshots are local to the devbox (`.ui/` is gitignored). Every page is shot at 390×844 (`mobile`) and 1280×800
(`desktop`) in `light` and `dark`, plus 360×780 (`narrow`, light) from stage 5:

- before: `.ui/shots/baseline/<page>.<mobile|desktop>.<light|dark>.png` (taken before any change, never overwritten)
- after: `.ui/shots/stage5/<page>.<mobile|desktop|narrow>.<light|dark>.png`
- the same demo data both times: `npm run ui:seed` (POST /__dev/seed); to re-shoot: `npm run dev`, then
  `npm run ui:shots -- <name>`; one close look: `npm run ui:peek -- <page> mobile dark 1200`
- every shared component in every state, light and dark side by side: `/__dev/ui` (local only)

Heights are the full page at 390 px wide, before → after. "New" means the page wasn't in the baseline shots (it existed,
but stage 1 didn't shoot that state).

## Page by page

### Public

| Page | Before → after (390 px) | What changed |
|---|---|---|
| `home` | 5,629 → 6,448 px | Two-column hero at ≥64rem with the real example note and the public feed's 90-day trace (each spike links its note); How it works, What we watch with the catalog as proof, a comparison with Dependabot/GitHub, Snyk and Socket (Stackquake column first, each vendor quoted and cited), recent changes, pricing strip, one closing call to action. |
| `pricing` | 2,106 → 2,488 | Plan cards side by side, Team emphasised, prices in mono from plans.ts; "Start free" is the primary action while Team can't be bought on this server. FAQ in two columns. Checkout form unchanged. |
| `catalog` | 6,542 → 5,198 | Search, a category jump bar (one scrolling row on phones), entry cards with what we read and the latest change; two columns on phones. |
| `catalog-empty-search` | 844 → 1,073 | Empty state with "Show everything" and "Sign in to request it". |
| `catalog-entry` | 1,077 → 1,465 | Breadcrumb to the category, recent changes, a rail with each source (host and path) and alternatives. |
| `events` | 2,583 → 3,252 | Grouped by month, date in a mono margin, 90-day trace on top, RSS as a button; rows lead with the subject in bold, "Took effect" for past dates. |
| `event-eol`, `event-free-tier`, `event-license` | 1,353 → 2,192 (eol) | The note as a document: kind and subject kicker, title as h1, summary as lede, fact strip (Published, Takes effect, Source), the quote as centrepiece with its citation, What this means for you, Who is not affected, Ways out with an effort meter, What the source doesn't say, the disclaimer word for word; rail with the call to action and a permalink. |
| `terms`, `privacy`, `bot` | 5,090 → 5,919 (terms) | Contents list (sticky rail at ≥64rem); the privacy table stacks on phones with the data as a row heading. Wording unchanged (checked word for word in stage 3; stage 5 changed markup only). |
| `signin`, `signin-sent` | 844 → 915 | Narrow centred column, email first, GitHub second, the terms line. |
| `link-expired`, `404` | 844 → 844 | Error pages with code, plain-words cause and a next step; flow errors stay in the sign-in column. |

### Signed in

| Page | Before → after (390 px) | What changed |
|---|---|---|
| `app-dashboard` | 4,410 → 4,236 | "Your stack": status line (act / watch / quiet) and 90-day trace; **Needs your attention**: alerts, act first, five shown and the rest folded, each with why it affects you and "Useful? Yes / No"; then each project as rows grouped by risk, "No known risk" folded. |
| `member-dashboard` | new → 3,290 | Same, with "shared with your team" on team projects. |
| `free-dashboard` | 844 → 1,253 | Same; zero counts shown hollow, a line instead of an empty trace, no second pulse for a single project. |
| `onboarding-empty`, `app-new-project` | 862 → 1,494 | First-run welcome with an onboarding stepper, the name, two ways in side by side (pick from the catalog; import a public repo). |
| `app-services-imported`, picker | 6,147 → 4,773 | Sticky search, common entries first, two tile columns on phones, live "n selected" in the sticky bar, the import result as a success callout, "found in repo" on tiles. |
| `free-import-progress` | new → 1,045 | Stepper, a progress bar and the importer's five steps as a checklist, log under Details; updates in place with JS. |
| `app-import-failed` | new → 879 | "Couldn't import owner/repo", the error, "Pick services instead". |
| `app-profiles`, `app-profiles-onboarding` | 3,174 → 2,978 | Usage questions as chips, two panels a row on desktop, sticky Save. |
| `app-project-import`, `app-project-picker`, `free-project` | 2,684 → 2,903 | Pulse and risk groups beside a Repository rail; project settings in a panel; Danger zone last. |
| `app-dep`, `app-dep-muted`, `app-dep-package` | 1,736 → 2,485 | Severity and reason under the title, changes, your alerts, usage questions, a rail with About, What we watch and mute / stop watching; muted state said once. |
| `app-settings`, `free-settings`, `member-settings` | 2,095 → 2,243 | Panels (Alerts, Email, Slack, Plan, Delete account) with an "On this page" rail at ≥64rem; Plan shows the plan, usage against the Free limit and what Team adds. |
| `app-team`, `free-team`, `member-team` | 1,090 → 1,274 | Members with avatars, "4 of 10 people", invite inline; Free gets the upgrade panel. |
| `free-new-project-limit`, `free-402-export` | 844 → 1,123 | Every 402 is one upgrade panel: what Team adds, the price, one button, a way back. |
| `app-github-unavailable` | new → 844 | Plain-words 404 with a way back. |
| `alert-link-*` (confirm, useful, done, bad) | 844 → 844 | Narrow column, the dependency and the date named, one large confirm button, "Nothing changes until you press the button". |
| `admin-queue`, `admin-published`, `admin-event-edit` | 7,859 → 4,806 (published) | Review cards as panels: status and kind badges, the quote with its source, before/after diff, Approve / Edit / Reject; published cards fold their note; the edit page has an h1 and real fields. |
| `admin-sources`, `admin-requests` | 844 → 1,050 | Failing and blocked sources in a panel with badges; requests grouped with counts; empty states. |

## Audit numbers, baseline → stage 5

From `npm run ui:audit -- baseline` and `-- stage5` (`.ui/audit/<name>/summary.md`). Lighthouse is the mobile preset with
simulated throttling on a 2 vCPU box, so performance is indicative.

| Public page | Perf | A11y | Best practices | SEO | Gzipped HTML+CSS |
|---|---|---|---|---|---|
| home | 100 → 100 | 100 → 100 | 92 → 100 | 100 → 100 | 5.6 → 17.3 KB |
| pricing | 100 → 100 | 100 → 100 | 96 → 100 | 100 → 100 | 3.4 → 13.3 KB |
| catalog | 100 → 100 | 100 → 100 | 96 → 100 | 100 → 100 | 3.6 → 14.3 KB |
| catalog-entry | 100 → 100 | 100 → 100 | 96 → 100 | 100 → 100 | 2.9 → 13.4 KB |
| events | 100 → 100 | 100 → 100 | 96 → 100 | 100 → 100 | 3.8 → 14.5 KB |
| event-eol | 100 → 100 | 97 → 100 | 96 → 100 | 100 → 100 | 3.0 → 13.6 KB |
| signin | 100 → 100 | 100 → 100 | 96 → 100 | 54 → 63 | 2.5 → 12.3 KB |
| app-dashboard | 100 → 100 | 100 → 100 | 96 → 100 | 54 → 54 | 4.3 → 16.3 KB |

- **SEO** is 100 on every indexable page. `/signin` and `/app` are `noindex` on purpose (as before), so Lighthouse's
  `is-crawlable` audit fails them by design; /signin gained a meta description.
- **axe** (WCAG 2.2 A/AA and best practices, light and dark): baseline 92 findings on all 39 pages it covered (`landmark-unique`
  everywhere, `heading-order` on 6 pages, `page-has-heading-one` on admin edit) → **0 on all 52 pages**, the gallery
  included.
- **Layout**: no horizontal overflow at 360, 390 or 1280 on any page (baseline: 2 pages at 390); no console errors;
  CLS 0.
- **Keyboard** (`npm run ui:keys -- stage5`, `.ui/audit/stage5/keyboard.md`): sign-in (17 stops), new project (19),
  a dependency's settings (29) and usage questions (33), light and dark: every stop has a visible focus ring, is on
  screen and isn't covered by the sticky bar.
- **Weight**: the stylesheet is inline on every page, about 55 KB raw and 11 KB gzipped; public pages are 12–17 KB
  gzipped (budget 30 KB). It is sent with every page and can't be cached separately.
- **CPU** (`npm run measure:cpu`, see below): HTML renders cost more than before; the dependency page about doubled.

### CPU per request

`npm run measure:cpu` fails on main and on this branch at the same step: it creates two projects for a Free user, and
Free allows one (the script predates the limit). A copy that imports one repo ran on both (two runs here, one on main;
local timings, noisy):

| Request | main | ui-redesign |
|---|---|---|
| GET / | 2.5–3.0 ms | 4.6–8.7 ms |
| GET /catalog | 2.5–2.6 | 4.4–6.4 |
| GET /events | 2.7–3.1 | 3.5–4.4 |
| GET /app | 7.1–7.4 | 6.3–9.1 |
| GET /app/projects/:id | 6.5–7.9 | 7.8–12.2 |
| GET /app/deps/:id | 4.9–6.5 | **11.7–13.8** (one 22 ms outlier) |
| cron ticks | unchanged (UI work doesn't touch them) | |

Production is on Workers Paid since 2026-10-11 (wrangler.jsonc), so no request is near a limit, but the dependency page
now does about 2× the work: it loads the project's whole stack (`projectDeps`) to find one row's severity and reason.

## Left out on purpose

- **Landing height on phones**: 6,448 px at 390 against DIRECTION's 3,500 px. Every section the prompts asked for is
  there; phones get the comparison as a sideways table (Stackquake column first), three recent changes and a shorter
  closing band. Getting to 3,500 means dropping sections, which is a content call.
- **No og:image** (DECISIONS, stage 3): no remote images, and the preview consumers don't render SVG.
- **Admin diff highlighting**: DiffView shows before and after side by side without marking the changed words.
- **Admin edit form** builds its select and textarea by hand (Field renders inputs only).
- **Gallery**: the header and account-menu demos are shown in the half-width columns, where the real header's
  viewport media queries don't apply, so they wrap; the pages themselves are right.
- **Support email** is a link only in the operator line of /terms and /privacy; elsewhere in the legal text it stays
  plain text, so the legal pages' markup changes as little as possible.
- **Catalog data**: Twilio sits under Infrastructure, and the "keydb" and "dragonfly" alternatives aren't catalog
  entries, so they show as bare ids (styled as non-links).
- **Sticky "n selected"** on the picker wraps to a second line on 390 px phones.
- **`measure:cpu`** still fails on its second project (see above); not a UI change, left for its owner.

## Risks to check (things a user would notice)

1. **Severity**: alerts whose match is `unknown` now show as *watch*, not *act* (as DIRECTION specified), which also
   moves them below the act alerts in "Needs your attention". Only presentation; nothing is sent differently.
2. **Enter in the repo field imports** (stage 4): the new-project form has a hidden first submit button without `next`,
   so pressing Enter in the repo field starts an import instead of opening the picker. The server already treated
   "no `next` and a repo" as import.
3. **Import progress** refreshes with a small script (fetches itself every second, swaps the progress in place,
   follows the redirect when done); the `<meta refresh>` is only used without JS. Each GET still runs one step.
4. **Copy changes users will read**: one-click alert pages ("Mute Deno for 90 days?", "No alerts about Deno until
   <date>.", done titles "Noted as useful" / "Muted Deno"); the import error "Repository not found. Check the owner
   and name; public repos can be pasted, and private repos need the GitHub App." (src/stack/import.ts, stored on the
   import); the picker's title "Find what you use"; the note's call to action "Pick what you run on"; member account
   deletion now says the team's projects stay; "Took effect" for past dates. Prices, plan limits and legal lines are
   unchanged.
5. **Admin**: "Reject" reads "Unpublish" (secondary) on published events (same route); on the edit page, Approve reads
   "Approve as it is" (secondary). Published cards fold their note and diff under "Note and source text".
6. **Layout moves**: the project page's Danger zone is now after the Repository panel (last on phones); the dep page's
   "Alerts for it" is in the rail; settings sections have an "On this page" rail; the footer links Events.
7. **Link previews**: indexable public pages now carry canonical, Open Graph and Twitter `summary` tags (stage 3), so
   Slack, X and LinkedIn previews of stackquake.com links will look different.
8. **Event permalink** is a two-line read-only textarea (was a one-line input) so the id stays visible.
9. **Email templates** (src/alerts/render.ts) are untouched: alert emails look as before, so the site and the emails no
   longer match visually.
10. **Seed dates**: the demo data is fixed around 2026-10-11 while "changed recently" is judged against today, so shots
    taken after mid-November 2026 will differ from these.
