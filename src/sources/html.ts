// Text extraction from HTML with HTMLRewriter (native and streaming). CPU is the constraint
// (SPEC §4.2), so JS callbacks are limited to text inside the selected region and to skipped
// elements, and parsing stops as soon as a unique selector (main, article, #id) has closed.
// Each text node ends a line. That splits sentences at inline tags ("See\ndocs\nfor details"),
// which diffs and the M2 quote check (whitespace-normalised) tolerate; a callback per block
// element to place line breaks exactly cost about twice as much CPU on table-heavy pages.
import { decodeEntities } from "./normalise";

const SKIP = ["script", "style", "noscript", "template", "svg", "iframe", "canvas", "nav", "select", "button"];
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

export interface ExtractResult {
  text: string;
  /** False when the selector matched nothing (the page layout probably changed). */
  matched: boolean;
  tooLarge: boolean;
}

export interface ExtractOptions {
  selector: string;
  exclude?: string[];
  /** Cap on extracted characters (SPEC §7.2: 200 KB). */
  maxChars: number;
  /** Cap on HTML bytes read. */
  maxBytes: number;
}

/** A selector that matches once, so parsing can stop when it closes. */
export function isUnique(selector: string): boolean {
  // Not `article`: pages often have several, or nest them.
  return /^(main|body|#[\w-]+)$/.test(selector.trim());
}

/**
 * Extracts the text inside `selector` (a comma-separated list is allowed), skipping scripts,
 * styles, nav, buttons and anything matching `exclude`.
 */
export async function extractText(body: ReadableStream<Uint8Array>, opts: ExtractOptions): Promise<ExtractResult> {
  const parts: string[] = [];
  let chars = 0;
  let skipping = 0;
  let matched = false;
  let tooLarge = false;
  let stop = false;

  const push = (s: string) => {
    if (tooLarge) return;
    chars += s.length;
    if (chars > opts.maxChars) {
      tooLarge = true;
      stop = true;
    } else parts.push(s);
  };
  /** True if `fn` will run at the end tag. Void and self-closing elements have none. */
  const onEnd = (el: Element, fn: () => void): boolean => {
    if (VOID.has(el.tagName)) return false;
    try {
      el.onEndTag(fn);
      return true;
    } catch {
      return false;
    }
  };
  const skip = {
    element(el: Element) {
      // Count only elements whose end will be seen, or the counter never comes back down.
      if (onEnd(el, () => void skipping--)) skipping++;
    },
  };
  const selectors = opts.selector.split(",").map((p) => p.trim()).filter(Boolean);
  const unique = selectors.length === 1 && isUnique(selectors[0]);
  let rewriter = new HTMLRewriter();
  for (const part of selectors) {
    rewriter = rewriter.on(part, {
      element(el) {
        matched = true;
        push("\n");
        onEnd(el, () => {
          push("\n");
          if (unique) stop = true;
        });
      },
      // Element text handlers receive the text of all descendants.
      text(t) {
        if (skipping > 0) return;
        // Line breaks inside a text node are only whitespace in HTML.
        if (t.text) push(t.text.replace(/\s+/g, " "));
        if (t.lastInTextNode) push("\n");
      },
    });
    for (const tag of SKIP) rewriter = rewriter.on(`${part} ${tag}`, skip);
    for (const ex of opts.exclude ?? []) rewriter = rewriter.on(`${part} ${ex}`, skip);
  }

  // Feed the rewriter chunk by chunk so it can stop early and enforce the byte cap.
  const reader = body.getReader();
  let bytes = 0;
  let overBytes = false;
  const input = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (stop) {
        await reader.cancel();
        controller.close();
        return;
      }
      const { done, value } = await reader.read();
      if (done) return controller.close();
      bytes += value.byteLength;
      if (bytes > opts.maxBytes) {
        overBytes = true;
        await reader.cancel();
        return controller.close();
      }
      controller.enqueue(value);
    },
  });
  await rewriter.transform(new Response(input)).body?.pipeTo(new WritableStream());
  const large = tooLarge || overBytes;
  return { text: large ? "" : decodeEntities(parts.join("")), matched, tooLarge: large };
}
