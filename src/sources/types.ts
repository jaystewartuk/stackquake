import type { Ctx } from "../context";
import type { EventKind, Source, SourceKind } from "../db/schema";
import type { FetchOutcome } from "./http";

/** A change a comparator wants turned into an event (SPEC §7.3 step 1). */
export interface DetectedChange {
  kind: EventKind;
  title: string;
  /**
   * What identifies "the same announcement" for dedupe, e.g. "licence MIT -> BUSL-1.1", so an npm
   * and a GitHub source of one catalog entry produce one event. Defaults to the title.
   */
  dedupeTitle?: string;
  quote?: string | null;
  quoteUrl: string;
  beforeText?: string | null;
  afterText?: string | null;
  effectiveDate?: string | null;
}

export interface CatalogLink {
  catalogId: string;
  filter: string[] | null;
}

export type PollOk = {
  type: "ok";
  status: number;
  etag: string | null;
  lastModified: string | null;
  /** What is hashed and stored in R2. Only fields we compare, so noise does not change it. */
  canonical: string;
  /** Small comparator state kept in D1 (sources.last_state). */
  state: unknown;
  changes: DetectedChange[];
};

export type KindPoll = PollOk | Exclude<FetchOutcome, { type: "ok" }>;

export interface PollInput {
  source: Source;
  /** Comparator state from the last successful poll, or null on the first (baseline) poll. */
  prev: unknown | null;
  links: CatalogLink[];
  /** Loads the previous canonical body from the blob store (only when needed). */
  prevCanonical: () => Promise<string | null>;
}

export interface KindHandler {
  kind: SourceKind;
  intervalMs: number;
  /** Hosts contacted by one poll (for the 1-request-per-host-per-tick gate). */
  hosts(source: Source): string[];
  poll(ctx: Ctx, input: PollInput): Promise<KindPoll>;
  /** Time-based checks that still run when the server says 304 Not Modified. */
  onUnchanged?(ctx: Ctx, input: PollInput): DetectedChange[];
}
