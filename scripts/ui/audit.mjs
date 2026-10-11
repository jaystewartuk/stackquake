// npm run ui:audit -- <name> [page ...]: re-seeds, then runs axe-core on every page (390 px wide,
// light and dark, since contrast differs by scheme) and Lighthouse (mobile preset) on the public
// pages and /app. Also records each page's HTML size, raw and gzipped (the CSS is inline, so that
// is the brief's "HTML+CSS" budget). Writes JSON per page and summary.md to .ui/audit/<name>/.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import AxeBuilder from "@axe-core/playwright";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import { chromium } from "playwright";
import { BASE, OUT, SCHEMES, cookiesFor, only, pages, seed, stageName } from "./lib.mjs";

const name = stageName("ui:audit");
const dir = join(OUT, "audit", name);
mkdirSync(join(dir, "axe"), { recursive: true });
mkdirSync(join(dir, "lighthouse"), { recursive: true });

const s = await seed();
const cookies = await cookiesFor(s.users);
const list = (await pages()).filter(only());

// ---- axe ----
const browser = await chromium.launch();
const axe = [];
for (const scheme of SCHEMES) {
  const contexts = new Map();
  for (const p of list) {
    const key = String(p.as);
    if (!contexts.has(key)) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
      await ctx.addCookies(cookies[key] ?? []);
      contexts.set(key, ctx);
    }
    const page = await contexts.get(key).newPage();
    const path = typeof p.path === "function" ? await p.path() : p.path;
    await page.goto(BASE + path, { waitUntil: "load" });
    if (p.submit) {
      for (const [sel, v] of Object.entries(p.submit.fill)) await page.fill(sel, v.replace("@", `+audit-${scheme}@`));
      await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click(p.submit.click)]);
    }
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
    writeFileSync(join(dir, "axe", `${p.name}.${scheme}.json`), JSON.stringify({ url: result.url, violations: result.violations, incomplete: result.incomplete.map((i) => ({ id: i.id, impact: i.impact, nodes: i.nodes.length })) }, null, 2));
    axe.push({ page: p.name, scheme, violations: result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })) });
    await page.close();
  }
  for (const ctx of contexts.values()) await ctx.close();
}
const sizes = [];
for (const p of list.filter((p) => !p.submit)) {
  const path = typeof p.path === "function" ? await p.path() : p.path;
  const res = await fetch(BASE + path, { headers: { cookie: (cookies[String(p.as)] ?? []).map((c) => `${c.name}=${c.value}`).join("; ") }, redirect: "follow" });
  const body = Buffer.from(await res.arrayBuffer());
  sizes.push({ page: p.name, bytes: body.length, gzip: gzipSync(body).length });
}
const chromePath = chromium.executablePath();
await browser.close();
console.log(`axe: ${list.length} pages × ${SCHEMES.length} schemes`);

// ---- Lighthouse (mobile, one page at a time: the box has 2 vCPUs) ----
const lh = [];
const lhPages = list.filter((p) => p.public || p.lighthouse);
const chrome = await chromeLauncher.launch({ chromePath, chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"] });
// Chrome drops a Cookie set through Lighthouse's extraHeaders, so signed-in pages get the session
// cookie in the browser itself (over CDP) and Lighthouse is told not to clear storage.
const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`);
for (const p of lhPages) {
  const path = typeof p.path === "function" ? await p.path() : p.path;
  await cdp.contexts()[0].clearCookies();
  if (p.as) await cdp.contexts()[0].addCookies(cookies[p.as]);
  const run = await lighthouse(BASE + path, { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["performance", "accessibility", "best-practices", "seo"], disableStorageReset: !!p.as });
  if (run.lhr.finalDisplayedUrl !== BASE + path) console.log(`  ! ${p.name} ended at ${run.lhr.finalDisplayedUrl}`);
  const lhr = run.lhr;
  writeFileSync(join(dir, "lighthouse", `${p.name}.json`), run.report);
  const score = (k) => Math.round((lhr.categories[k]?.score ?? 0) * 100);
  const audit = (k) => lhr.audits[k]?.displayValue ?? "";
  const failing = Object.values(lhr.audits)
    .filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== "informative" && a.scoreDisplayMode !== "notApplicable" && a.scoreDisplayMode !== "manual")
    .map((a) => a.id);
  lh.push({ page: p.name, performance: score("performance"), accessibility: score("accessibility"), bestPractices: score("best-practices"), seo: score("seo"), fcp: audit("first-contentful-paint"), lcp: audit("largest-contentful-paint"), cls: audit("cumulative-layout-shift"), tbt: audit("total-blocking-time"), failing });
  console.log(`lighthouse ${p.name}: perf ${score("performance")} a11y ${score("accessibility")}`);
}
await cdp.close();
await chrome.kill();

// ---- Summary ----
const byRule = new Map();
for (const r of axe) for (const v of r.violations) {
  const k = `${v.id} (${v.impact})`;
  const e = byRule.get(k) ?? { help: v.help, pages: new Set(), nodes: 0 };
  e.pages.add(`${r.page}${r.scheme === "dark" ? " (dark)" : ""}`);
  e.nodes += v.nodes;
  byRule.set(k, e);
}
const md = [
  `# UI audit: ${name}`,
  "",
  `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC, ${BASE}, seeded data. axe-core at 390×844 in light and dark (WCAG 2.2 A/AA and best practices); Lighthouse mobile preset (simulated throttling, on a 2 vCPU box, so performance is indicative).`,
  "",
  "## Lighthouse (mobile)",
  "",
  "| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | CLS | TBT | Audits under 90 |",
  "|---|---|---|---|---|---|---|---|---|---|",
  ...lh.map((r) => `| ${r.page} | ${r.performance} | ${r.accessibility} | ${r.bestPractices} | ${r.seo} | ${r.fcp} | ${r.lcp} | ${r.cls} | ${r.tbt} | ${r.failing.join(", ")} |`),
  "",
  "## axe violations by rule",
  "",
  byRule.size ? "| Rule | Help | Nodes | Pages |\n|---|---|---|---|" : "None.",
  ...[...byRule.entries()].sort((a, b) => b[1].nodes - a[1].nodes).map(([k, e]) => `| ${k} | ${e.help} | ${e.nodes} | ${[...e.pages].join(", ")} |`),
  "",
  "## axe violations per page",
  "",
  "| Page | Light | Dark |",
  "|---|---|---|",
  ...list.map((p) => {
    const f = (scheme) => {
      const r = axe.find((x) => x.page === p.name && x.scheme === scheme);
      return r?.violations.length ? r.violations.map((v) => `${v.id}×${v.nodes}`).join(", ") : "0";
    };
    return `| ${p.name} | ${f("light")} | ${f("dark")} |`;
  }),
  "",
  "## HTML size (CSS is inline)",
  "",
  "| Page | Bytes | Gzipped |",
  "|---|---|---|",
  ...sizes.map((r) => `| ${r.page} | ${r.bytes} | ${r.gzip} |`),
  "",
];
writeFileSync(join(dir, "summary.md"), md.join("\n"));
writeFileSync(join(dir, "summary.json"), JSON.stringify({ lighthouse: lh, axe, sizes }, null, 2));
console.log(`audit written to ${dir}/summary.md`);
