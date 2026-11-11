# Stackquake

> **Archived.** Stackquake was built in October 2026 (10 to 14 Oct) by one person working with Claude Code, one milestone at a time. It is kept here read-only as a record of how it was made, and is not running.

A change radar for the things your stack depends on: it watches package registries, GitHub metadata, licences, end-of-life data, vendor feeds and pricing pages, and sends an alert when one of them changes the deal. A language model reads each change, and an alert is published only if its supporting quote is found verbatim in the stored source.

## Where to look

- [`SPEC.md`](SPEC.md): the product as specified.
- [`OPPORTUNITY.md`](OPPORTUNITY.md) and [`MODEL_GUIDE.md`](MODEL_GUIDE.md): why this idea was picked, and which model and effort level suited each milestone.
- [`prompts/`](prompts): the prompt for each milestone.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): decisions made while building.
- [`testdata/golden/`](testdata/golden): the golden set the evaluation suite replays (`npm run eval`): `cases.json` and its README.

## What was removed

The saved third-party pages, posts and feeds that the golden set replayed (`testdata/golden/feeds`, `pages`, `posts`) were removed from every commit because they are other people's content, so `npm run eval` cannot be re-run from this copy. An email address in the decision log and the Cloudflare database IDs were replaced with placeholders.
