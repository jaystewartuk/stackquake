// Structured-output schemas for classify and summarise (SPEC §7.4), and a validator for the
// subset of JSON Schema they use. The API enforces the schema; validation here is the backstop
// for refusals, truncation and anything the API cannot express (number ranges, date shapes).
import { EVENT_KINDS, type EventKind } from "../db/schema";

type Schema = Record<string, unknown>;

const nullable = (s: Schema): Schema => ({ anyOf: [s, { type: "null" }] });
const obj = (properties: Record<string, Schema>): Schema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

export const HOSTING = ["hosted", "self_hosted"] as const;
export const USE = ["commercial", "personal"] as const;
export const TIER = ["free", "paid"] as const;

export const CLASSIFY_SCHEMA = obj({
  kind: { type: "string", enum: [...EVENT_KINDS] },
  confidence: { type: "number", description: "0 to 1" },
  effective_date: nullable({ type: "string", description: "YYYY-MM-DD, or YYYY-MM when only the month is known" }),
  one_line: { type: "string" },
  quote: { type: "string" },
});

/** Usage profiles a change applies to (matched against deps.profile in M4). Empty list = any. */
export const APPLIES_WHEN_SCHEMA = obj({
  hosting: { type: "array", items: { type: "string", enum: [...HOSTING] } },
  use: { type: "array", items: { type: "string", enum: [...USE] } },
  tier: { type: "array", items: { type: "string", enum: [...TIER] } },
});

export const SUMMARISE_SCHEMA = obj({
  material: { type: "boolean" },
  kind: { type: "string", enum: [...EVENT_KINDS] },
  title: { type: "string" },
  what_changed: { type: "string" },
  quote: { type: "string" },
  effective_date: nullable({ type: "string", description: "YYYY-MM-DD, or YYYY-MM when only the month is known" }),
  applies_when: APPLIES_WHEN_SCHEMA,
  who_is_not_affected: nullable({ type: "string" }),
  options: { type: "array", items: obj({ catalog_id: nullable({ type: "string" }), name: { type: "string" }, why: { type: "string" }, effort: { type: "string", enum: ["low", "medium", "high"] } }) },
  uncertain: { type: "array", items: { type: "string" } },
  confidence: { type: "number", description: "0 to 1" },
});

export interface Classification {
  kind: EventKind;
  confidence: number;
  effective_date: string | null;
  one_line: string;
  quote: string;
}

export interface AppliesWhen {
  hosting: (typeof HOSTING)[number][];
  use: (typeof USE)[number][];
  tier: (typeof TIER)[number][];
}

export interface Note {
  material: boolean;
  kind: EventKind;
  title: string;
  what_changed: string;
  quote: string;
  effective_date: string | null;
  applies_when: AppliesWhen;
  who_is_not_affected: string | null;
  options: { catalog_id: string | null; name: string; why: string; effort: "low" | "medium" | "high" }[];
  uncertain: string[];
  confidence: number;
}

/** Problems with `value` against `schema` (the subset used above). Empty means valid. */
export function checkSchema(schema: Schema, value: unknown, path = "$"): string[] {
  if (schema.anyOf) {
    const options = schema.anyOf as Schema[];
    return options.some((s) => checkSchema(s, value, path).length === 0) ? [] : [`${path}: matches no allowed shape`];
  }
  switch (schema.type) {
    case "null":
      return value === null ? [] : [`${path}: expected null`];
    case "boolean":
      return typeof value === "boolean" ? [] : [`${path}: expected boolean`];
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? [] : [`${path}: expected number`];
    case "string":
      if (typeof value !== "string") return [`${path}: expected string`];
      return schema.enum && !(schema.enum as string[]).includes(value) ? [`${path}: ${JSON.stringify(value)} not allowed`] : [];
    case "array":
      if (!Array.isArray(value)) return [`${path}: expected array`];
      return value.flatMap((v, i) => checkSchema(schema.items as Schema, v, `${path}[${i}]`));
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [`${path}: expected object`];
      const props = schema.properties as Record<string, Schema>;
      const o = value as Record<string, unknown>;
      const errs = (schema.required as string[]).filter((k) => !(k in o)).map((k) => `${path}.${k}: missing`);
      for (const k of Object.keys(o)) errs.push(...(props[k] ? checkSchema(props[k], o[k], `${path}.${k}`) : [`${path}.${k}: unexpected`]));
      return errs;
    }
  }
  return [`${path}: unsupported schema`];
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

function common(v: { confidence: number; effective_date: string | null }): string[] {
  const errs: string[] = [];
  if (v.confidence < 0 || v.confidence > 1) errs.push("$.confidence: outside 0..1");
  if (v.effective_date !== null && !DATE.test(v.effective_date)) errs.push(`$.effective_date: ${JSON.stringify(v.effective_date)} is not YYYY-MM[-DD]`);
  return errs;
}

export function validateClassification(value: unknown): { ok: true; value: Classification } | { ok: false; errors: string[] } {
  const errors = checkSchema(CLASSIFY_SCHEMA, value);
  if (errors.length) return { ok: false, errors };
  const v = value as Classification;
  const more = common(v);
  return more.length ? { ok: false, errors: more } : { ok: true, value: v };
}

export function validateNote(value: unknown): { ok: true; value: Note } | { ok: false; errors: string[] } {
  const errors = checkSchema(SUMMARISE_SCHEMA, value);
  if (errors.length) return { ok: false, errors };
  const v = value as Note;
  const more = common(v);
  if (!v.title.trim()) more.push("$.title: empty");
  return more.length ? { ok: false, errors: more } : { ok: true, value: v };
}
