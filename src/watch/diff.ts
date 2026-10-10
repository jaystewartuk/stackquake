// Line diff of normalised page text. Pages change in a few places, so the common prefix and
// suffix are trimmed first and an LCS runs only on the middle (capped).

export interface Hunk {
  context: string[];
  removed: string[];
  added: string[];
}

const MAX_LCS_CELLS = 250_000;
const CONTEXT_LINES = 2;

export function diffLines(before: string, after: string): Hunk[] {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length === 0 && midB.length === 0) return [];

  // Each op: [type, line, index in a] where type is "=", "-" or "+".
  const ops: ["=" | "-" | "+", string, number][] = [];
  if (midA.length * midB.length > MAX_LCS_CELLS) {
    midA.forEach((l, i) => ops.push(["-", l, start + i]));
    midB.forEach((l) => ops.push(["+", l, -1]));
  } else {
    const n = midA.length;
    const m = midB.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        ops.push(["=", midA[i], start + i]);
        i++;
        j++;
      } else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) {
        ops.push(["+", midB[j], -1]);
        j++;
      } else {
        ops.push(["-", midA[i], start + i]);
        i++;
      }
    }
  }

  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let lastA = start - 1;
  for (const [type, line, idx] of ops) {
    if (type === "=") {
      cur = null;
      lastA = idx;
      continue;
    }
    if (!cur) {
      const ctxEnd = type === "-" ? idx : lastA + 1;
      cur = { context: a.slice(Math.max(0, ctxEnd - CONTEXT_LINES), ctxEnd), removed: [], added: [] };
      hunks.push(cur);
    }
    if (type === "-") {
      cur.removed.push(line);
      lastA = idx;
    } else cur.added.push(line);
  }
  return hunks;
}

/** How much text changed: the larger of removed and added characters. */
export function changedChars(hunks: Hunk[]): number {
  let removed = 0;
  let added = 0;
  for (const h of hunks) {
    for (const l of h.removed) removed += l.length;
    for (const l of h.added) added += l.length;
  }
  return Math.max(removed, added);
}

/** Before/after excerpts for the event, each with the hunk's context lines. */
export function excerpts(hunks: Hunk[], max: number): { before: string; after: string } {
  const render = (side: "removed" | "added") =>
    hunks
      .map((h) => [...h.context, ...h[side]].join("\n"))
      .join("\n…\n")
      .slice(0, max);
  return { before: render("removed"), after: render("added") };
}
