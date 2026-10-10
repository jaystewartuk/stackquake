// Which alerts go out at once and which wait for the weekly digest (SPEC §7.5).
import type { Event } from "../db/schema";
import type { Note } from "../llm/schemas";
import { DAY } from "../util";

export const EOL_URGENT_MS = 180 * DAY;
/** At most this many immediate alerts per user in any 24 hours; the rest go to the digest. */
export const IMMEDIATE_PER_DAY = 3;

/** An acquisition note that says the product or service ends (shuts down, is sunset…). */
const END_OF_SERVICE = /\b(shut(s|ting)?[ -]?down|sunset(s|ting)?|end[s]? of (life|service|support)|discontinu\w*|wind(s|ing)? down|will (end|stop|close|cease)|no longer (be )?(available|supported|offered|sold)|clos(e|es|ing) (down|the service))\b/i;

/** Start of the date an effective_date names: YYYY-MM-DD, or the first of the month for YYYY-MM. */
export function effectiveStart(date: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(date ?? "");
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1) : null;
}

/**
 * Immediate: `license`; `eol` whose effective date is within 180 days (or past); `acquisition`
 * whose note says the service ends; `free_tier`. Everything else waits for the digest. An EOL
 * month without a day counts from the first of that month, the earliest it can mean.
 */
export function isUrgent(e: Pick<Event, "kind" | "effectiveDate" | "note" | "quote">, now: number): boolean {
  switch (e.kind) {
    case "license":
    case "free_tier":
      return true;
    case "eol": {
      const start = effectiveStart(e.effectiveDate);
      return start !== null && start - now <= EOL_URGENT_MS;
    }
    case "acquisition": {
      const n = e.note as Note | null;
      return END_OF_SERVICE.test(`${n?.what_changed ?? ""}\n${n?.title ?? ""}\n${e.quote ?? ""}`);
    }
    default:
      return false;
  }
}
