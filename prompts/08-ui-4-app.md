# Prompt 08 · UI stage 4 of 5: the signed-in app

Read prompts/ui/BRIEF.md, docs/design/DIRECTION.md and docs/design/PROGRESS.md first. Use and
extend the shared components.

Redesign every signed-in page (src/web/app.tsx, stack-view.tsx, events-view.tsx,
alerts-view.tsx, alert-links.tsx, team.tsx, billing.tsx, github.tsx) and give src/admin/ the
same foundation (a lighter touch: clear and dense is enough):
1. **Dashboard** `/app`: answers "does anything I depend on need my attention?" first: what
   changed recently and what needs action, then projects and deps grouped by risk. A great first
   run: the empty state leads straight into adding a stack.
2. **New project**: the picker (services first, search, common ones first) and repo import as
   the shortcut, with the import progress page; target under 60 s from start to a populated
   dashboard, and it must feel that fast (progress, no dead ends).
3. **Project**, **dep** (sources, usage profile questions, events, mute) and **alerts** pages.
4. **Settings**, **team**, **billing** (plan state, limits, upgrade path; 402 pages), **GitHub**
   connection pages, and the signed one-click alert-link pages.
5. Keep the HTML email templates (src/alerts/render.ts) as they are unless a change is tiny and
   clearly better; email is out of scope for this redesign.

Check every page at 390 and 1280 wide, light and dark, by keyboard, with seeded data and empty.
Run `npm run ui:shots -- stage4` and `npm run ui:audit -- stage4`: axe 0 violations on app pages,
no layout shift. Done when that holds, the check passes, PROGRESS.md has a stage 4 section, and
the work is committed.
