# Prompt 08 · UI stage 1 of 5: audit, baseline and direction

Read prompts/ui/BRIEF.md first (it wins over this file where they differ), then SPEC.md §1–3 and
§7.6, and the M3 "Dashboard and pages" and M6 sections of docs/DECISIONS.md. Then read every file
in src/web/ and src/admin/ so you know each page.

1. **Tooling.** Set up the local environment from the brief. Write `scripts/ui/seed.mjs` (or a
   `/__dev/seed` route plus a script) with realistic, deterministic data: two projects (one from a
   monorepo import, one from the picker), 15–25 deps across risk levels, 8–12 published events of
   different kinds (licence change, EOL, pricing, acquisition) with quotes and "what this means",
   a muted dep, alerts in the inbox, a team with two members. Write `scripts/ui/shots.mjs`: signs
   in, visits every page (public, app, admin, error pages such as 404 and 402), and saves
   screenshots at 390×844 and 1280×800 in light and dark to `.ui/shots/<name>/`. Write
   `scripts/ui/audit.mjs`: axe-core on every page and Lighthouse (mobile) on the public pages and
   /app, saving JSON and a short summary to `.ui/audit/<name>/`. Add `npm run ui:seed`,
   `ui:shots -- <name>`, `ui:audit -- <name>` scripts.
2. **Baseline.** Run shots and audit as `baseline` before changing any page.
3. **Audit.** Write `docs/design/AUDIT.md`: page by page, what works, what doesn't (hierarchy,
   density, empty states, mobile, dark mode, forms, copy, consistency), with the axe and Lighthouse
   numbers. Look at the screenshots yourself (read the PNGs) rather than guessing from code.
4. **Direction.** Sketch three distinct directions in prose (each: personality, type, colour,
   density, signature element, how the dashboard and an event note would look), then choose one
   and say why in `docs/design/DIRECTION.md`. Make the chosen one concrete: type scale, colour
   tokens for light and dark (with contrast ratios checked, AA at least), spacing scale, radius,
   elevation, motion (and `prefers-reduced-motion`), iconography (inline SVG only), and a list of
   the components the next stages will build. Name the two or three pages that matter most
   (landing, dashboard, event note) and describe their target layout.

Done when: the scripts run end to end on the box, `.ui/shots/baseline/` and `.ui/audit/baseline/`
exist, AUDIT.md and DIRECTION.md are written, PROGRESS.md has a stage 1 section, and the work is
committed. Do not restyle pages in this stage.
