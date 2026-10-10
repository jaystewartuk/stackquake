# Prompt 02: implement M2 (event pipeline)

Saved 2026-10-10. `ANTHROPIC_API_KEY` is already in `.dev.vars` (gitignored; key
`stackquake-dev`, expires 2026-11-09). Top up API credit to about $25 first.
Paste this into a new Claude Code session in this repo (Opus 5.5 recommended for the session
itself: prompt and schema design matter more here than in M1).

---

Read SPEC.md in full, then docs/DECISIONS.md (M1 decisions and deviations; it wins where it
differs from the spec). Implement milestone M2 only (§12): the event pipeline. No user auth,
no alerts or email, no web app beyond the admin review page, no deploy.

## Constraints that carry over from M1
- Workers **Free plan** (10 ms CPU per invocation) stays. Every new step is its own job kind,
  idempotent, and takes the `HEAVY` gate token if it does real CPU work (HTML extraction,
  diffing, large JSON). LLM calls are mostly wall time, but measure them.
- Load the `claude-api` skill before writing any LLM code and verify current request shapes
  (structured outputs, `output_config.effort`, server-side fallbacks, refusals, prompt caching,
  token counting and pricing). If `@anthropic-ai/sdk` adds noticeable CPU per invocation on
  Workers, call the Messages API with `fetch` instead and say so.

## Scope (from SPEC §5, §6, §7.3, §7.4, §11)
1. **LLM client** behind an interface (`Llm`) with a production implementation and a fake for
   tests. **Haiku first (owner's decision):** the model per step comes from
   `LLM_MODEL_CLASSIFY` and `LLM_MODEL_SUMMARISE`, both defaulting to `claude-haiku-5-5`;
   switching a step to `claude-opus-5-5` must be a config change only. Haiku 5.5 has no
   server-side refusal fallback: a `refusal` stop goes to `pending_review`. Keep the spec's
   `fallbacks: "default"` only when the configured model supports it (Opus 5.5). Every call writes `llm_calls`
   (purpose, model, tokens, cost from current pricing). Fetched text is untrusted data: say so in
   the system prompt, keep it last, validate every output against its schema.
2. **fetch_post step** for new feed items whose feed text is short (an excerpt): fetch the post
   URL politely (robots, User-Agent, Markdown first, `article`/`main`), store the text in R2,
   use it for classification and the quote check. Respect the per-host gate.
3. **classify** (feed items): SPEC §7.4 input and output. Below 0.7 confidence or kind `other`
   → `rejected` (kept). Apply the catalog `filter` first (M1 already skips filtered items).
4. **summarise**: deterministic events, classified feed items, and page diffs. For page diffs
   the output also says whether the change is material; not material → `rejected`, no note.
   Writes `note`, `quote`, `effective_date`, `applies_when`, `confidence`, and a real `kind`
   and `title`.
5. **Semantic dedupe** after classify/summarise: recompute the dedupe key from (catalog_id,
   kind, normalised title). On a collision, mark the newer event as a duplicate of the older
   (add a column) instead of failing.
6. **Quote check and review gate** (§7.3 step 4): quote must be found verbatim after whitespace
   normalisation in the stored source text (feed/post text, page snapshot, registry fields).
   Auto-publish only if confidence ≥ 0.9, the quote is found, and kind is `license`, `eol`,
   `deprecated` or `archived`; otherwise `pending_review`. `stop_reason: "refusal"` →
   `pending_review` with a note.
7. **Admin review page** `/admin/events` (server-rendered Hono JSX, minimal): list
   `pending_review` with quote, before/after, source link; approve, edit, reject in one click.
   Until M3 adds real auth, protect `/admin` with an `ADMIN_TOKEN` secret: a login form that
   sets an HttpOnly, Secure, SameSite=Strict cookie. Escape all fetched text.
8. **Golden set** in `testdata/golden/` per SPEC §11 (all 8 cases), with saved source
   snapshots so it runs offline except for the model. Save the real Deno post of 2026-10-09.
   For Bitwarden, use whatever is fetchable plus the HN thread and mark uncertainty as the spec
   says. `npm run eval` runs it against the live model and reports precision and recall per kind,
   quote-found rate, and cost.
9. **Model choice (SPEC §14 Q2)**: run the eval on `claude-haiku-5-5` first and tune the
   prompts and schemas against it. Only if Haiku cannot reach the bar after tuning, run the
   failing step on `claude-opus-5-5` and report the difference. Prefer the cheapest per-step
   combination that passes (likely Haiku for classify even if summarise needs Opus). Keep eval
   spend under about $15 and report it.

## Done when
- Unit tests pass with the fake LLM: quote check (found, whitespace variants, made-up quote),
  review gate rules, semantic dedupe, refusal handling, page-diff "not material", idempotent
  retries of each new step. `npm test` and `tsc` are clean.
- `npm run eval` passes the §11 bar on the chosen model per step (Haiku unless it could not):
  no false positive among the "no event" cases, all deal changes found, every quote found
  verbatim.
- `npm run measure:cpu` still shows steady-state ticks around or under 10 ms with the new
  steps; report the numbers and anything over.
- docs/DECISIONS.md has an M2 section with decisions and deviations.

Work on a branch `m2-pipeline` from `main`, commit in logical steps, and stop when M2 is done.
Finish with a short summary: what was built, test and eval results (both models, with cost),
which model each step uses and why, and any deviations from the spec.
