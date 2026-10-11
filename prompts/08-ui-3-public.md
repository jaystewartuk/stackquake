# Prompt 08 · UI stage 3 of 5: public pages

Read prompts/ui/BRIEF.md, docs/design/DIRECTION.md and docs/design/PROGRESS.md first. Use the
stage 2 components; extend them rather than adding one-off styles.

Redesign every public page (src/web/site.tsx, public.tsx, auth.tsx, catalog-view.ts and the
error pages):
1. **Landing** `/`: services-first positioning (SPEC §2) in the first screen; a real example note
   (quote, source link, "what this means for you") as the centrepiece; how it works in three
   steps; where Stackquake differs from Dependabot, Snyk and Socket (keep it factual and short,
   docs/COMPETITORS.md has the facts); the catalog as proof (logos are not allowed: use names,
   categories and counts); pricing teaser; one clear call to action. No fake testimonials or
   numbers.
2. **Pricing** `/pricing`: plans side by side, the paid plan emphasised, FAQ. Prices and limits
   come from src/billing/plans.ts; do not change them.
3. **Catalog** `/catalog` and `/catalog/{id}`: browsable by category with search, each entry
   showing what is watched and recent events.
4. **Events** `/events` and `/events/{id}`: the event note is the product's core artefact; make
   it read beautifully and be shareable (good `<title>`, description and Open Graph tags without
   remote images; a self-generated SVG or no image).
5. **Sign in** and the magic-link pages, `/bot`, `/terms`, `/privacy`, 404 and other errors.
   Legal text keeps its meaning word for word (layout and typography may change).

Check each page at 390 and 1280 wide, light and dark, by keyboard. Run `npm run ui:shots -- stage3`
and `npm run ui:audit -- stage3`: public pages must reach axe 0 violations, Lighthouse mobile
accessibility 100 and performance 95+. Done when that holds, the check passes, PROGRESS.md has a
stage 3 section with before/after numbers, and the work is committed.
