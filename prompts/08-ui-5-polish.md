# Prompt 08 · UI stage 5 of 5: polish, review and hand-off

Read prompts/ui/BRIEF.md, docs/design/DIRECTION.md and docs/design/PROGRESS.md first.

1. **Critique pass.** Look at every screenshot from `npm run ui:shots -- stage5` next to the
   baseline as a demanding design reviewer would: alignment, rhythm, type, contrast, density,
   copy, empty and error states, long names and long quotes, 360 px wide, dark mode. Fix what
   you find; repeat until a second pass finds nothing worth fixing.
2. **Consistency.** Remove leftover one-off styles and dead CSS; every page uses the shared
   components; the `/__dev/ui` gallery matches what pages use.
3. **Accessibility and performance.** axe 0 violations on every page; keyboard path through
   sign-in, new project and dep settings; visible focus everywhere; Lighthouse mobile on public
   pages: performance 95+, accessibility 100, best practices 100, SEO 100. Run `npm run
   measure:cpu` if it works locally and note any page whose CPU grew.
4. **Review material.** Write `docs/design/REVIEW.md`: a page-by-page before/after list (paths
   to the screenshots in `.ui/shots/baseline/` and `.ui/shots/stage5/`), the final audit numbers
   against the baseline, what was deliberately left out, and risks for the owner to check
   (anything that changes behaviour a user would notice).
5. **Close out.** A "UI redesign" summary in docs/DECISIONS.md, the final PROGRESS.md section, and
   a prompt for the next session in `prompts/09-ui-follow-ups.md` (what is left, what to watch
   after deploy). Do not deploy or push.

Done when all of the above is committed and the check passes. End with a short summary.
