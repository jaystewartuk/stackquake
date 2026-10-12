// npm run ui:peek -- <page> [mobile|desktop] [light|dark] [scrollY]: one viewport-sized screenshot of a
// page from scripts/ui/lib.mjs at a scroll position, to .ui/peek.png. For looking closely while
// working; `ui:shots` is the record. Uses the last seed (run `npm run ui:seed` first).
import { join } from "node:path";
import { chromium } from "playwright";
import { BASE, OUT, VIEWPORTS, cookiesFor, pages, seedData } from "./lib.mjs";

const [name, vpName = "mobile", scheme = "light", y = "0"] = process.argv.slice(2);
const p = (await pages()).find((x) => x.name === name);
if (!p) {
  console.error(`no page named ${name}`);
  process.exit(2);
}
const vp = VIEWPORTS.find((v) => v.name === vpName);
const cookies = await cookiesFor((await seedData()).users);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme, reducedMotion: "reduce" });
await ctx.addCookies(cookies[String(p.as)] ?? []);
const page = await ctx.newPage();
await page.goto(BASE + (typeof p.path === "function" ? await p.path() : p.path), { waitUntil: "load" });
await page.evaluate((top) => window.scrollTo(0, top), Number(y));
const file = join(OUT, "peek.png");
await page.screenshot({ path: file });
console.log(`${file} (page height ${await page.evaluate(() => document.documentElement.scrollHeight)})`);
await browser.close();
