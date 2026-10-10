// Text extraction from HTML with HTMLRewriter (native and streaming, so it costs little CPU).
import { decodeEntities } from "./normalise";

const SKIP = new Set(["script", "style", "noscript", "template", "svg", "iframe", "canvas", "nav", "select", "head"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "br", "caption", "dd", "details", "dialog", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li",
  "main", "ol", "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

export interface ExtractResult {
  text: string;
  /** False when the selector matched nothing (the page layout probably changed). */
  matched: boolean;
  tooLarge: boolean;
}

/**
 * Extracts the text inside `selector` (a comma-separated list is allowed), skipping scripts,
 * styles, nav and anything matching `exclude`. Block elements become line breaks.
 */
export async function extractText(
  body: ReadableStream<Uint8Array>,
  opts: { selector: string; exclude?: string[]; maxChars: number },
): Promise<ExtractResult> {
  const parts: string[] = [];
  let chars = 0;
  let inside = 0;
  let skipping = 0;
  let matched = false;
  let tooLarge = false;

  const push = (s: string) => {
    if (tooLarge) return;
    chars += s.length;
    if (chars > opts.maxChars) tooLarge = true;
    else parts.push(s);
  };
  const onEnd = (el: Element, fn: () => void) => {
    if (VOID.has(el.tagName)) return;
    try {
      el.onEndTag(fn);
    } catch {
      // Elements without an end tag cannot take a handler; nothing to undo for them.
    }
  };

  let rewriter = new HTMLRewriter();
  for (const part of opts.selector.split(",").map((p) => p.trim()).filter(Boolean)) {
    rewriter = rewriter
      .on(part, {
        element(el) {
          matched = true;
          if (VOID.has(el.tagName)) return;
          inside++;
          push("\n");
          onEnd(el, () => {
            push("\n");
            inside--;
          });
        },
      })
      .on(`${part} *`, {
        element(el) {
          if (SKIP.has(el.tagName)) {
            skipping++;
            onEnd(el, () => void skipping--);
          } else if (BLOCK.has(el.tagName)) {
            push("\n");
            onEnd(el, () => push("\n"));
          }
        },
      });
    for (const ex of opts.exclude ?? []) {
      rewriter = rewriter.on(`${part} ${ex}`, {
        element(el) {
          skipping++;
          onEnd(el, () => void skipping--);
        },
      });
    }
  }
  rewriter = rewriter.onDocument({
    text(t) {
      // Line breaks inside a text node are just whitespace in HTML; block elements make lines.
      if (inside > 0 && skipping === 0 && t.text) push(t.text.replace(/\s+/g, " "));
    },
  });

  await rewriter.transform(new Response(body)).body?.pipeTo(new WritableStream());
  return { text: tooLarge ? "" : decodeEntities(parts.join("")), matched, tooLarge };
}
