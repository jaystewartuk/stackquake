# Golden set (SPEC §11)

`npm run eval` replays each case in `cases.json` through the real watchers and pipeline, with
HTTP served from the files here and only the model live. It reports precision and recall per
kind, the quote-found rate and the cost, and fails unless the bar holds:

- no event (published or pending review) for any "no event" case;
- every deal change found, with the right kind;
- every event's quote found verbatim in the stored source;
- plus each case's own checks (effective date, quote text, note mentions old and new values,
  status, number of LLM calls).

Options (environment): `EVAL_ONLY=01,06` (case id prefixes), `EVAL_REPEAT=3`, and the model
settings `LLM_MODEL_CLASSIFY`, `LLM_MODEL_SUMMARISE`, `LLM_MODEL_SUMMARISE_HIGH`. Each run's
report is also written to `.eval/` (gitignored).

## How a case runs

- **feed**: baseline poll of the saved feed without the case's item, then a poll of the full
  feed, so the item arrives as a new post exactly as in production (catalog keyword filter
  included). The post URL serves the saved post.
- **page**: baseline poll of `before`, then `after`; the diff step decides whether there is
  an event.
- **npm / github**: registry JSON fixtures, polled before and after.

## Sources (fetched 2026-10-10 with the bot User-Agent, robots.txt allowed every one)

| Case | Source | Notes |
|---|---|---|
| 01 | `deno.atom` (trimmed to 3 entries), `deno-cloudflare.html` | Real Deno post of 2026-10-09. The feed carries only an excerpt, so the post is fetched. |
| 02 | `bitwarden-announcements.rss`, `bitwarden-published-version-update.md` | Real forum announcement linked from HN 50033407 ("Bitwarden Dual License Model"). The forum, blocked during the original research, served Markdown to our bot this time. The page includes the first 20 replies (staff answers among them). `refs/` keeps the forum topic JSON and the top HN comments for context; they are not given to the model. Nothing in the case is inferred from HN, so nothing had to be marked uncertain for lack of a source; the note's `uncertain` list covers what the post leaves open. |
| 03, 05 | `cloudflare-workers-pricing.md` (real, Markdown), plus two **synthetic** edits: `free-tier-edit` (Free plan requests 100,000 → 50,000 per day, and the "Last updated" date) and `timestamp-only` (only the date). | |
| 04, 08c, 09 | `cloudflare-blog.rss` (trimmed to 3 items), Markdown posts | |
| 06, 07 | fixtures in `cases.json` | **Synthetic.** |
| 08a, 08b | `deno.atom`, HTML posts | |
| 08d | `bitwarden-blog.rss` (trimmed to 2 items), HTML post | |
| 08e | `bitwarden-announcements.rss`, Markdown post | |

Case 09 is an addition: the Cloudflare Observability post was first picked as a routine
"no event" post, but section 4 moves existing Workers logs to volume-based pricing from
2026-12-01. The classifier flagged it; the label was wrong, so it became a positive case and
08c uses a different routine post.
