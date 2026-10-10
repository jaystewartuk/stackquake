// Compiles catalog/*.yaml into src/catalog/catalog.gen.json for the Worker bundle.
// Full validation runs in the Worker (syncCatalog) and in test/catalog.test.ts.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const dir = new URL("../catalog/", import.meta.url).pathname;
const entries = readdirSync(dir)
  .filter((f) => f.endsWith(".yaml"))
  .sort()
  .map((f) => {
    const entry = parse(readFileSync(join(dir, f), "utf8"));
    if (entry?.id !== f.replace(/\.yaml$/, "")) throw new Error(`${f}: id must match the file name`);
    return entry;
  });
writeFileSync(new URL("../src/catalog/catalog.gen.json", import.meta.url), JSON.stringify(entries, null, 2) + "\n");
console.error(`catalog: ${entries.length} entries`);
