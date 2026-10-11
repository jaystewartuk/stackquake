// The site's one stylesheet, inlined into every page by src/web/layout.tsx. Modules in cascade
// order: tokens, element defaults and layout, components, then page layouts.
import { BASE } from "./base";
import { COMPONENTS } from "./components";
import { PAGES } from "./pages";
import { TOKENS } from "./tokens";

/** Drops comments and needless whitespace; the source stays readable, the page stays light. */
export const minifyCss = (css: string) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{};,>])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();

export const CSS = minifyCss(TOKENS + BASE + COMPONENTS + PAGES);
