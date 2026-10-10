// catalog.gen.json is built from catalog/*.yaml by scripts/build-catalog.mjs (run by npm scripts).
import generated from "./catalog.gen.json";
import type { CatalogEntry } from "./catalog";

export const CATALOG = generated as unknown as CatalogEntry[];
