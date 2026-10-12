// npm run ui:keys -- <name> [page ...]: walks the keyboard path through the pages that matter for it
// (sign-in, new project, a dependency's settings, by default) at 390×844 in light and dark. For each
// Tab stop it records what has focus and checks three things: the focus indicator is visible (an
// outline or box-shadow on the element, or on the label/tile wrapping a visually hidden input), the
// element is on screen, and nothing sticky covers it. Writes .ui/audit/<name>/keyboard.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { BASE, OUT, SCHEMES, cookiesFor, pages, seed, stageName } from "./lib.mjs";

const name = stageName("ui:keys");
const dir = join(OUT, "audit", name);
mkdirSync(dir, { recursive: true });
const wanted = process.argv.slice(3).length ? process.argv.slice(3) : ["signin", "app-new-project", "app-dep", "app-profiles"];
const MAX_STOPS = 80;

const s = await seed();
const cookies = await cookiesFor(s.users);
const list = (await pages()).filter((p) => wanted.includes(p.name));
const browser = await chromium.launch();
const lines = [`# Keyboard path: ${name}`, "", `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC, 390×844, Tab from the top of the page until focus leaves the page or returns to the start.`, ""];
let failures = 0;

for (const scheme of SCHEMES) {
  for (const p of list) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, reducedMotion: "reduce" });
    await ctx.addCookies(cookies[String(p.as)] ?? []);
    const page = await ctx.newPage();
    await page.goto(BASE + (typeof p.path === "function" ? await p.path() : p.path), { waitUntil: "load" });
    const stops = [];
    for (let i = 0; i < MAX_STOPS; i++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const visible = (node) => {
          const cs = getComputedStyle(node);
          const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
          const shadow = cs.boxShadow && cs.boxShadow !== "none" && /0px 0px 0px [1-9]/.test(cs.boxShadow);
          return outline || shadow;
        };
        const r = el.getBoundingClientRect();
        const hiddenInput = r.width <= 2 || r.height <= 2;
        // Visually hidden inputs (pick tiles, choice chips) show focus on their label.
        const shown = hiddenInput ? el.closest("label") ?? el.parentElement : el;
        const sr = shown.getBoundingClientRect();
        const onScreen = sr.bottom > 0 && sr.top < innerHeight && sr.right > 0 && sr.left < innerWidth;
        const cx = Math.min(Math.max(sr.left + sr.width / 2, 0), innerWidth - 1);
        const cy = Math.min(Math.max(sr.top + Math.min(sr.height, 40) / 2, 0), innerHeight - 1);
        const top = document.elementFromPoint(cx, cy);
        const covered = !!top && !shown.contains(top) && !top.contains(shown);
        const label = (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("name") || el.id || "").trim().replace(/\s+/g, " ").slice(0, 48);
        return { tag: el.tagName.toLowerCase() + (el.type && el.tagName === "INPUT" ? `[${el.type}]` : ""), label, ring: visible(shown) || visible(el), onScreen, covered, key: el.outerHTML.slice(0, 120) };
      });
      if (!stop || (stops.length && stop.key === stops[0].key)) break;
      stops.push(stop);
    }
    const bad = stops.filter((x) => !x.ring || !x.onScreen || x.covered);
    failures += bad.length;
    lines.push(`## ${p.name} (${scheme}): ${stops.length} stops, ${bad.length} problems`, "", "| # | Element | Name | Ring | On screen | Covered |", "|---|---|---|---|---|---|");
    stops.forEach((x, i) => lines.push(`| ${i + 1} | ${x.tag} | ${x.label.replace(/\|/g, "/")} | ${x.ring ? "yes" : "**no**"} | ${x.onScreen ? "yes" : "**no**"} | ${x.covered ? "**yes**" : "no"} |`));
    lines.push("");
    await ctx.close();
  }
}
await browser.close();
writeFileSync(join(dir, "keyboard.md"), lines.join("\n") + "\n");
console.log(`${join(dir, "keyboard.md")}: ${failures} problems`);
process.exit(failures ? 1 : 0);
