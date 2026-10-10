// Compiles catalog/*.yaml into src/catalog/catalog.gen.json for the Worker bundle.
// Full validation runs in the Worker (syncCatalog) and in test/catalog.test.ts.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
// Written only when it changes: wrangler dev watches this file and runs this script on every
// rebuild, so an unconditional write would reload the server in a loop.
const out = new URL("../src/catalog/catalog.gen.json", import.meta.url);
const json = JSON.stringify(entries, null, 2) + "\n";
if (!existsSync(out) || readFileSync(out, "utf8") !== json) writeFileSync(out, json);
console.error(`catalog: ${entries.length} entries`);
