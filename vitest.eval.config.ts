// `npm run eval`: the golden set (SPEC §11) against the live Claude API, inside the Workers
// runtime like the unit tests. The saved sources are passed in as a JSON binding (workerd has no
// filesystem). Model settings come from the shell, so `LLM_MODEL_SUMMARISE_HIGH=claude-haiku-5-5
// npm run eval` compares a different split without code changes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const dir = "testdata/golden";
const cases = JSON.parse(readFileSync(`${dir}/cases.json`, "utf8")).cases as { feed?: { file: string }; posts?: Record<string, { file: string }>; page?: { before: string; after: string } }[];
const files: Record<string, string> = {};
for (const c of cases) {
  const paths = [c.feed?.file, c.page?.before, c.page?.after, ...Object.values(c.posts ?? {}).map((p) => p.file)];
  for (const p of paths) if (p) files[p] ??= readFileSync(`${dir}/${p}`, "utf8");
}

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            GOLDEN: { cases, files },
            EVAL_OPTIONS: {
              models: {
                classify: process.env.LLM_MODEL_CLASSIFY ?? "",
                summarise: process.env.LLM_MODEL_SUMMARISE ?? "",
                summariseHigh: process.env.LLM_MODEL_SUMMARISE_HIGH ?? "",
              },
              only: process.env.EVAL_ONLY ?? "",
              repeat: Number(process.env.EVAL_REPEAT ?? "1"),
            },
          },
        },
      }),
    ],
    test: {
      include: ["eval/**/*.eval.ts"],
      // The report travels in the test's meta (console output from workerd is not shown).
      reporters: [
        "default",
        {
          onTestCaseResult(testCase: { meta(): { report?: string } }) {
            const report = testCase.meta().report;
            if (!report) return;
            console.log(`\n${report}\n`);
            mkdirSync(".eval", { recursive: true });
            writeFileSync(`.eval/report-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`, report);
          },
        },
      ],
      setupFiles: ["./test/setup.ts"],
      // Agent worktrees live under .claude/worktrees; their copies of the tests are not ours.
      exclude: ["**/node_modules/**", ".claude/**"],
      testTimeout: 60 * 60_000,
      hookTimeout: 60_000,
    },
  };
});
