// npm run ui:shots -- <name> [page ...]: re-seeds, then screenshots every page (scripts/ui/lib.mjs)
// at 390×844 and 1280×800 in light and dark (and 360×780 in light), full page, to .ui/shots/<name>/<page>.<viewport>.<scheme>.png.
// Also writes index.json (status, final URL, console errors, horizontal overflow) so a broken
// page or a layout that scrolls sideways shows up without opening every image.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { BASE, OUT, SCHEMES, VIEWPORTS, cookiesFor, only, pages, seed, stageName } from "./lib.mjs";

const name = stageName("ui:shots");
const dir = join(OUT, "shots", name);
mkdirSync(dir, { recursive: true });

const s = await seed();
const cookies = await cookiesFor(s.users);
const list = (await pages()).filter(only());
const browser = await chromium.launch();
const index = [];
let problems = 0;

for (const vp of VIEWPORTS) {
  for (const scheme of vp.schemes ?? SCHEMES) {
    // One context per role, so sessions and CSRF cookies don't mix.
    const contexts = new Map();
    const ctxFor = async (role) => {
      const key = String(role);
      if (!contexts.has(key)) {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme, deviceScaleFactor: 1, reducedMotion: "reduce" });
        await ctx.addCookies(cookies[key] ?? []);
        contexts.set(key, ctx);
      }
      return contexts.get(key);
    };
    for (const p of list) {
      const page = await (await ctxFor(p.as)).newPage();
      const errors = [];
      // Chromium logs the document's own 4xx as a console error; that status is checked separately.
      page.on("console", (m) => m.type() === "error" && !/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text()) && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(String(e)));
      const path = typeof p.path === "function" ? await p.path() : p.path;
      let res = await page.goto(BASE + path, { waitUntil: "load" });
      if (p.submit) {
        for (const [sel, v] of Object.entries(p.submit.fill)) await page.fill(sel, v.replace("@", `+${vp.name}-${scheme}@`));
        [res] = await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click(p.submit.click)]);
      }
      const status = res?.status() ?? 0;
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const file = `${p.name}.${vp.name}.${scheme}.png`;
      await page.screenshot({ path: join(dir, file), fullPage: true });
      const expected = p.status ?? 200;
      const bad = status !== expected || overflow > 0 || errors.length > 0;
      if (bad) problems++;
      index.push({ page: p.name, path, viewport: vp.name, scheme, status, expected, url: page.url().replace(BASE, ""), overflowPx: overflow, errors, file });
      await page.close();
    }
    for (const ctx of contexts.values()) await ctx.close();
    console.log(`${vp.name} ${scheme}: ${list.length} pages`);
  }
}
await browser.close();
writeFileSync(join(dir, "index.json"), JSON.stringify(index, null, 2));
for (const r of index.filter((r) => r.status !== r.expected || r.overflowPx > 0 || r.errors.length)) {
  console.log(`  ! ${r.page} ${r.viewport} ${r.scheme}: status ${r.status} (expected ${r.expected}), overflow ${r.overflowPx}px${r.errors.length ? `, ${r.errors.length} console errors` : ""}`);
}
console.log(`${index.length} screenshots in ${dir}${problems ? `, ${problems} with problems (see above)` : ""}`);
