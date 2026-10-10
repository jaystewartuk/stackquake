// The quote check (SPEC §7.3 step 4): a note's quote must appear verbatim in the stored source
// text. "Verbatim" is compared after removing whitespace (HTML extraction splits lines at inline
// tags, so "See <a>docs</a>." is stored as "See \ndocs\n."), unifying typographic quotes and
// dashes, and dropping Markdown markup (links, emphasis, list and heading markers), which the
// model reasonably leaves out. Words, numbers and their order must match exactly.

/** Shortest quote (after canonicalisation) that counts: a lone "MIT" proves nothing. */
export const MIN_QUOTE_CHARS = 8;

export function canonicalText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛′´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/^[ \t]*(?:[-*+•]|\d+[.)]|>|#{1,6})[ \t]+/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, "");
}

export function quoteFound(quote: string | null | undefined, sources: (string | null | undefined)[]): boolean {
  if (!quote) return false;
  const q = canonicalText(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  return sources.some((s) => !!s && canonicalText(s).includes(q));
}
