# Prompt 09: UI redesign follow-ups

Saved 2026-10-12, at the end of the UI redesign (prompts/08-ui-*.md). Paste this into a new Claude Code session in this
repo (Opus 5.5 or Sonnet 5.5 · high) once the owner has reviewed branch `ui-redesign` and decided whether to merge it.
Deploying, pushing and anything in Cloudflare or Stripe are the owner's: ask first.

---

Read docs/design/REVIEW.md, docs/design/DIRECTION.md and the "UI redesign" section of docs/DECISIONS.md first. The
redesign is on branch `ui-redesign` (merge it to `main` first if the owner says so; don't merge it yourself). The rules
of prompts/ui/BRIEF.md still hold: server-rendered Hono JSX, no client framework or CSS build step, no third-party
requests, every page works without JS, behaviour unchanged, `npm run typecheck && npm test` green.

## Before or right after deploy (owner)

1. **Look at the risks in REVIEW.md** "Risks to check", especially the copy users will read, "unknown" alerts as watch,
   Enter importing from the repo field, and the import progress script.
2. **After deploy, watch for a week**:
   - Workers analytics: CPU time per request on `/app/deps/*`, `/app/projects/*` and `/`. Locally they cost about 2×
     what they did (REVIEW.md "CPU per request"); on Workers Paid that is billing, not a limit. Compare with the week
     before the deploy; any `exceededCpu` is a bug.
   - Errors from the import progress script (it fetches its own page each second) and from the picker filter.
   - Link previews of a note and of the home page in Slack and X now that Open Graph tags exist.
   - Alert feedback ("Useful? Yes / No") volume on the dashboard compared with the email links, to see whether the
     smaller inline control is used.

## Work that is left (each its own commit, smallest first)

1. **Dependency page CPU**: `GET /app/deps/:id` calls `projectDeps` for the whole project to rate one row
   (src/web/app.tsx). Load just that dependency's view, measure before and after with `npm run measure:cpu`.
2. **Fix `npm run measure:cpu`**: it creates two projects for a Free user and the second is a 402. Make its session
   user a Team owner (or measure one project) so it runs to the end again; keep the cron part unchanged.
3. **Admin diff**: mark the changed words in DiffView (common prefix and suffix at word level, `<del>`/`<ins>`, act
   and ok tints, not orange). Admin only.
4. **Field for select and textarea**: give Field an `as` option and use it on the admin edit form and in the gallery.
5. **Gallery shell demos**: render the header and account-menu demos full width (one per scheme) above the two
   columns, where the header's viewport media queries apply.
6. **Catalog data**: move Twilio to Email and messaging (catalog/twilio.yaml, regenerate, check counts and tests); give
   alternatives that aren't catalog entries (keydb, dragonfly) display names.
7. **Email templates** (src/alerts/render.ts) still use the old look. Bring them closer to the site (same severities,
   quote styling, system fonts) within what email clients render; keep the text version and every link unchanged, and
   keep the tests' assertions on order and content.
8. **Landing height at 390 px** is 6,448 px against DIRECTION's 3,500 px. Only with the owner: which sections to cut
   or fold on phones is a content decision (REVIEW.md "Left out on purpose").

## How to check your work

`npm run dev` (with `npm run db:migrate:local` once), then `npm run ui:shots -- <name>`, `npm run ui:audit -- <name>`
and `npm run ui:keys -- <name>`. Compare with `.ui/shots/stage5/` and `.ui/audit/stage5/summary.md`: axe must stay at 0,
Lighthouse at 100 on the indexable public pages, no overflow at 360 px. Re-check the seed's dates if it is after
mid-November 2026 ("changed recently" is judged against today).
