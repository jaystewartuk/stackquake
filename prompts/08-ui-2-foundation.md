# Prompt 08 · UI stage 2 of 5: foundation and components

Read prompts/ui/BRIEF.md, docs/design/DIRECTION.md, docs/design/AUDIT.md and
docs/design/PROGRESS.md first. Stage 1 chose the direction; build its foundation.

1. **Tokens and base styles.** Replace the CSS in src/web/layout.tsx with the direction's tokens
   (light and dark, `color-scheme`, focus rings, selection, reduced motion), base typography and
   layout primitives. Organise it so later stages add to it cleanly (for example
   src/web/styles/{tokens,base,components,pages}.ts joined in layout.tsx).
2. **Shell.** Header and navigation (signed out, signed in, admin; a mobile pattern that works
   without JS), footer, skip link, page title pattern, flash messages, and a consistent page
   header (title, description, actions).
3. **Components as JSX.** Build the shared pieces in src/web/ui.tsx (or a few files): buttons
   (primary, secondary, quiet, danger, sizes, disabled), form fields with labels, hints and
   errors, checkbox and radio cards (the picker's `.pick`), cards, badges and risk pills,
   tables that work on mobile, tabs or segmented control if the direction needs one, empty
   states with an action, a source quote block, a definition list for metadata, inline SVG
   icons, and the event note card. Each should be used by at least one existing page in this
   stage so they are real, not speculative.
4. **A component gallery** at `/__dev/ui` (behind DEV_ROUTES, local only) showing every
   component in every state, light and dark. Shoot it with `npm run ui:shots -- stage2`.

Existing pages may look half-done after this stage, but none may break: run the shots and look
at every page. Done when the foundation and components are in, the gallery renders, the check
passes, PROGRESS.md has a stage 2 section, and the work is committed.
