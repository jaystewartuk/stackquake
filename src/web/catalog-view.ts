// Catalog lookups for pages: grouping, search and display names. Reads the bundled catalog
// (no D1 query needed).
import { CATEGORIES, type CatalogEntry, type Category } from "../catalog/catalog";
import { CATALOG } from "../catalog/entries";

export const CATEGORY_LABELS: Record<Category, string> = {
  hosting: "Hosting and compute",
  database: "Databases",
  storage: "Storage",
  auth: "Auth",
  email: "Email and messaging",
  payments: "Payments",
  ai: "AI APIs",
  monitoring: "Monitoring and analytics",
  ci: "CI/CD",
  runtime: "Runtimes and languages",
  infrastructure: "Infrastructure",
  security: "Security",
  self_hosted: "Self-hosted",
};

let byId: Map<string, CatalogEntry> | null = null;
export function catalogEntry(id: string | null | undefined, entries: CatalogEntry[] = CATALOG): CatalogEntry | undefined {
  if (!id) return undefined;
  if (entries !== CATALOG) return entries.find((e) => e.id === id);
  byId ??= new Map(CATALOG.map((e) => [e.id, e]));
  return byId.get(id);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Every name a user might type for an entry. */
const terms = (e: CatalogEntry) => [e.id, e.name, ...(e.aliases ?? [])].map(norm);

/** Entries whose name, id or alias contains the query (all words). */
export function searchCatalog(q: string, entries: CatalogEntry[] = CATALOG): CatalogEntry[] {
  const words = norm(q).split(" ").filter(Boolean);
  if (!words.length) return entries;
  return entries.filter((e) => {
    const hay = terms(e).join(" | ");
    return words.every((w) => hay.includes(w));
  });
}

/** An exact name, id or alias match, for the picker's free-text box. */
export function exactMatch(q: string, entries: CatalogEntry[] = CATALOG): CatalogEntry | undefined {
  const n = norm(q);
  return n ? entries.find((e) => terms(e).includes(n)) : undefined;
}

/** Category groups in picker order; within a group, common entries first, then by name. */
export function groupByCategory(entries: CatalogEntry[]): { category: Category; label: string; entries: CatalogEntry[] }[] {
  return CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    entries: entries.filter((e) => e.category === category).sort((a, b) => Number(!!b.common) - Number(!!a.common) || a.name.localeCompare(b.name)),
  })).filter((g) => g.entries.length > 0);
}

/** Lower-cased search text for the client-side filter. */
export const searchText = (e: CatalogEntry) => terms(e).join(" ");
