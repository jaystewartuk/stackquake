# UI audit (stage 1 baseline, 2026-10-11)

What every page looks like before the redesign, judged from the screenshots in
`.ui/shots/baseline/` (39 pages × 390/1280 px × light/dark, seeded with `npm run ui:seed`) and the
numbers in `.ui/audit/baseline/summary.md`. Reproduce with `npm run dev`, then
`npm run ui:shots -- baseline` and `npm run ui:audit -- baseline`.

## Numbers

| | Result |
|---|---|
| Lighthouse mobile, performance | **100** on all 8 audited pages (home, pricing, catalog, catalog entry, events, event note, sign-in, dashboard). FCP/LCP 0.6–0.8 s, CLS 0, TBT ≤ 50 ms |
| Lighthouse accessibility | 100, except the event note: **97** (heading order) |
| Lighthouse best practices | 92–96: **no `<!DOCTYPE html>`** on any page (quirks mode), and the home page logs a 404 for `/favicon.ico` |
| Lighthouse SEO | 100 on public pages; 54 on sign-in and the dashboard (deliberately `noindex`, no description: fine) |
| axe (WCAG 2.2 AA + best practice, light and dark) | 3 rules, all moderate: `landmark-unique` on every page (header and footer `<nav>` have no labels), `heading-order` on event notes, project pages and the usage page (h1 → h3), `page-has-heading-one` on the admin edit page. **No colour-contrast failures** in either scheme (2 "needs review" nodes on the admin list) |
| HTML + CSS gzipped | 2.3–6.0 KB per page (budget 30 KB). The CSS is ~5 KB raw, inline |
| Horizontal overflow at 390 px | 2 pages: a muted dep page (35 px, long source URLs) and the admin published list (51 px) |
| Client JS | One 600-byte inline script (picker filter). Everything works with JS off |

So the base is technically sound: fast, light, accessible enough, no CLS. What it lacks is design:
hierarchy, a point of view and the few details that make it feel made. The redesign must keep the
numbers where they are while changing almost everything a person sees.

## Across all pages

- **No identity.** A wordmark with "quake" in orange, system font, beige background, bordered
  cards. It reads as a competent prototype. Nothing says "instrument" or "radar"; the orange is
  used for primary buttons, link underlines, blockquote rules and pills alike, so it means nothing.
- **Header.** The "Sign out" button sits 6–8 px higher than the nav links (a `button.link` line-height
  bug, visible on every signed-in page). At 390 px the signed-in nav wraps onto **three lines**
  (Catalog Events Dashboard Settings / Admin / Sign out) and pushes content below the fold. No
  current-page state (`aria-current`), no skip link, the two `<nav>`s are unlabelled.
- **Hierarchy is flat.** h1 1.6 rem, h2 1.15 rem, h3 1 rem bold, body 1 rem: section titles,
  risk groups and dep names all look alike. Pages are long single columns of equal-weight blocks.
- **Pills do too many jobs.** Event kind, delivery state, deprecation, "muted", "owner",
  "invited" all use the same outlined pill in three colours. Red/amber/green carry no stable
  meaning (an "End of life" kind is amber, "deprecated" red, "Sent by email" green).
- **Dates** are ISO everywhere (good: exact), but there is no sense of recency ("2 days ago") and
  no tabular figures, so columns of dates jitter.
- **Links** are underlined in orange everywhere, including whole titles, which makes lists noisy.
- **Forms**: inputs are full-width at 1280 px (a 900 px email field), labels are bold 16 px, every
  form sits in its own card, secondary buttons look disabled-ish, and destructive buttons are only
  a red outline next to a neutral one. Fieldsets for usage questions are heavy boxes in boxes.
- **Empty and error states** are bare: 404, 402 ("CSV export is on the Team plan" + one link),
  400 (expired link) and the onboarding page have no illustration, no explanation of what to do
  next beyond one link, and lots of dead space.
- **Dark mode** works (follows `prefers-color-scheme`) and passes contrast, but it is the light
  theme inverted: grey-on-near-black with saturated orange buttons that glow; amber pills are
  bright yellow. No user toggle (fine; system setting is enough).
- **Mobile**: layout mostly reflows, but rows that are `spread` (title left, meta right) collapse
  into awkward stacks, long URLs overflow, and the sticky "Save" bar on the picker covers content.
- **Missing basics**: doctype, favicon (an inline SVG data URI would do and costs no request),
  `theme-color`, focus styles beyond the browser default, `:focus-visible` on custom controls.
- **Admin** uses a `.cols` class that does not exist in the CSS, so before/after text stacks
  instead of sitting side by side.

## Page by page

### Landing `/`
- Works: the headline is right ("Know when the services you build on change the deal."), the
  services-first CTA order matches SPEC §2, the example alert uses the real Deno quote, page weight
  is tiny.
- Doesn't: the hero is a left-aligned text block with two equal-size buttons; nothing visual says
  what the product *is* until the example card, which is a plain bordered box that looks like
  the rest of the page rather than the product's best artefact. "What we watch" is four
  identical cards (the fourth alone on its own row at 1280 px). The catalog tags are a wall of
  20 pills. "Where it differs" is a long paragraph + quote list + five-bullet list: the most
  persuasive section is the hardest to read. Recent changes repeat the subject in every title
  ("Deno: Deno runtime…"). At 390 px the page is **5,600 px tall**. In five seconds you learn
  the headline but not the shape of the product.

### Pricing `/pricing`
- Works: two plans side by side, Team highlighted, prices and limits clear, FAQ answers real
  questions.
- Doesn't: the Free card has a weak secondary button and the Team card ends in small grey "Team
  opens soon." The two cards have different heights. FAQ is a run of h3 + paragraph with no
  rhythm. Price line "$19 a month, or $190 a year (two months free)" mixes sizes awkwardly.

### Catalog `/catalog`, `/catalog/{id}`
- Works: grouped by category, server-side search works with JS off, entries are links.
- Doesn't: 59 identical cards whose only detail is "N sources watched" (and "1 sources watched"
  for Vaultwarden, a plural bug). No sense of which entries have recent changes. The search box
  is narrow and the button is detached. The entry page has a long SEO h1, "What we watch" as a
  bulleted list of raw URLs, and alternatives as a dotted inline list. Empty search says
  "Nothing matches" with no suggestion beyond signing in.

### Events `/events` and the event note `/events/{id}`
- Works: the note has the right parts in the right order (what changed, quote, source, who is
  not affected, options, what the source does not say, disclaimer) and the disclaimer is kept.
- Doesn't: this is the page that should sell the product and it is the plainest. The h1 repeats
  the subject ("Deno: Deno runtime development ends…"). Kind, publication and effective dates
  sit in one wrapping meta line. The quote is a beige box like every other box; the source is a
  raw URL under it, not attached to it. "Options" is a bullet list with "(medium effort)" in
  text. There is no "What this means for you" heading even though that is the product's promise
  (SPEC §2). Headings jump h1 → h3 (axe, Lighthouse 97). No date is prominent; the deadline
  ("effective 2027-10"), the most actionable fact, is meta text. The events list is a feed of
  titles + kind pill + paragraph with no grouping by month.

### Sign-in, check-your-email, link problems
- Works: one field, one button, plain copy.
- Doesn't: a full-width card for one email field at 1280 px; no reassurance (what happens next,
  that the same link creates an account is there but faint). "Check your email" and "link
  expired" pages are an h1 and a sentence floating at the top of an empty page.

### Onboarding `/app/projects/new` (and empty `/app`)
- Works: services first, repo import second, optional defaults hidden in `<details>`.
- Doesn't: it doesn't look like the first step of anything: no steps (project → services →
  usage), the primary button "Pick services" sits between the name and the import field, and the
  import button is visually equal to it. On mobile the repo placeholder is cut off.

### Service picker `/app/projects/{id}/services`
- Works: grouped, filterable (JS) and server-searchable, imported items ticked with "found in
  repo", the selected state is clear (accent border), the request box catches misses.
- Doesn't: 59 tiles in 13 groups make a 3,300 px page with no count of what is ticked and no
  "selected" summary; the sticky Save bar floats over tiles mid-page; aliases in small grey
  under each name add noise; the search field has no icon and no result count.

### Usage `/app/projects/{id}/profiles`
- Works: optional, skippable, explains why.
- Doesn't: one bordered card per service, each holding bordered fieldsets of radio buttons: three
  levels of boxes. The questions repeat per service with no way to answer once for all. h1 → h3.

### Dashboard `/app`
- Works: the risk grouping (changed recently / archived / no licence / single vendor / no known
  risk) is the right model, each dep shows its latest event, the Free-plan "quiet projects"
  notice is honest, four queries however many projects.
- Doesn't: **it does not answer "do I need to act?" at a glance.** The first thing is an "Alerts"
  card of 7 items, each with two full-size "Useful / Not relevant" buttons, so feedback controls
  dominate the page (14 buttons above the fold at 1280 px). There is no summary ("2 need
  action, 3 to watch, 19 quiet"). Alert titles repeat the subject. Severity isn't encoded:
  "Not delivered" and "Held for the digest" have the same pill as event kinds. In project cards,
  risk group headings look like dep names; "No changes seen" is repeated on every quiet row (14
  times in one project); a muted dep still shows its event at full weight. At 390 px the dep row
  splits into name, then event on the next line, then date, so a 24-dep stack is 4,400 px tall.

### Project `/app/projects/{id}`
- Works: same stack view, repository section with "Import again", settings and delete on the page.
- Doesn't: the stack, repo, settings and a destructive button are one long page with no
  separation; project settings repeat the three usage fieldsets; "Delete this project" sits
  directly under "Save". h1 → h3.

### Dependency `/app/deps/{id}`
- Works: everything about one dep in one place: changes, usage, sources with "checked" dates,
  alerts, mute and stop watching.
- Doesn't: the muted state is only at the bottom ("Muted until … Unmute"), not near the title.
  Sources are a bulleted list of `kind: URL`, with raw long URLs that overflow at 390 px. The
  usage form is the heaviest element on the page though it is the least visited. Mute and
  "Stop watching" are equal-size buttons side by side.

### Settings `/app/settings`
- Works: every setting is there, plan state is clear, deletion needs "DELETE".
- Doesn't: five stacked cards with full-width inputs; each section has its own Save; the
  "Change to" field is unlabelled in meaning (change email to); the plan card's upgrade
  buttons (Free user) are the only colour on the page; delete is not set apart (no danger zone).

### Team `/app/team`
- Works: owner, members, pending invite with state; invite form; member view and leave.
- Doesn't: member rows have no left padding (text touches the card edge), "Remove" and "Cancel
  invite" are bare grey text links at the far right, no avatars/initials, no count ("3 of 10").

### 402 and limit pages (Free user: new project, CSV export, Slack, private repo)
- Works: the copy says what the limit is and links to plans; status codes are right.
- Doesn't: a heading and one underlined link on an empty page. These are upgrade moments and
  should show what Team adds, with the price, in one compact panel.

### 404, 400, 429
- A heading and a "Home" link; no search, no links to the catalog or events, no tone.

### Alert one-click confirm `/a/{token}`
- Works: GET only confirms, POST acts (safe against mail scanners).
- Doesn't: the question is the h1, the target is a sentence, and the button sits in a card on its
  own. Fine but anonymous: no sign this came from Stackquake's email.

### Legal and bot pages
- Works: readable `prose` measure, tables scroll horizontally.
- Doesn't: no table of contents for the two long pages; headings are small. Text must stay word
  for word; only presentation can change.

### Admin `/admin/*`
- Works: the review queue shows quote, quote-found state, note, before/after, approve/edit/reject.
- Doesn't: the admin sub-nav and status filter are rows of underlined links; before/after stack
  (missing `.cols`); "Approve Edit Reject" run together; the edit page has no h1; the
  published list overflows at 390 px. Low priority: owner-only, but it should share the components.

## What to keep
- Server-rendered pages that work with JS off; one small script.
- The page weights (2–6 KB gzipped) and Lighthouse 100 performance.
- The risk-group model on the dashboard and the note's section order.
- ISO dates as the exact value (add relative time next to them, not instead).
- The orange as the brand accent, but used far less.
