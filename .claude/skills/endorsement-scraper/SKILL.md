---
name: endorsement-scraper
description: Build an OpenSlate secondhand-report bundle from a public endorsements page. Use when the user wants to scrape an organization's published endorsements (Sierra Club, a union, a newspaper editorial board, etc.) into a researcher-signed slate. Produces positions.json, attribution.json, and an evidence/ folder — STOPS before signing so a human can review.
---

# Endorsement scraper

You're producing a **secondhand report**: an OpenSlate slate signed by the
researcher's key that reports another entity's publicly stated endorsements.
You are NOT impersonating the entity. The signature proves the researcher
captured this data, not that the entity blessed it.

Spec references: [SPEC §3.9 Attribution](../../../SPEC.md#39-attribution--secondhand-reports),
[§7.1 Researcher identities](../../../SPEC.md#71-researcher-identities-informative).
Bundle layout: [`research-bot/README.md`](../../../research-bot/README.md).

## Inputs

Ask the user for whatever you don't already have:

- **URL(s)** of the endorsements page(s). Required.
- **Org slug** — short kebab-case identifier for the entity (e.g.
  `sf-sierra-club`). Used as the directory name.
- **Election** — date or short label (e.g. `2026-11-03`).
- **Jurisdiction** — slash-separated, e.g. `us/ca/sf`.
- **Researcher identity file** — path to a `.identity.json` from
  `openslate keygen --kind researcher`. *Only needed at sign time, not
  scrape time.* If they don't have one yet, point them at `openslate keygen
  --name "..." --kind researcher -o me.identity.json` (SPEC §7.1).

## Procedure

1. **Fetch each page with WebFetch.** Save the rendered text into
   `research-bot/orgs/<slug>/<election>/evidence/<page-name>.md` along
   with the URL and the fetch timestamp at the top of the file.
   - One file per URL. Strip obvious chrome (nav, footer) but preserve the
     endorsement-bearing text verbatim, with surrounding context.
   - Do NOT rely on AI summary alone — keep the source quotes so a human
     reviewer can verify what was extracted.

2. **Extract positions.** For each clearly stated endorsement, draft a
   Position object:
   - `subject.title` — the race or measure title as it appears on the page.
   - `subject.kind` — `race`, `measure`, `candidate`, or `option`.
   - `subject.jurisdiction` and `subject.election` — copy from inputs.
   - `subject.id` — leave unset if you don't have a `vip:<id>` mapping.
   - `stance` — `endorse` / `oppose` / `lean_for` / `lean_against` /
     `neutral` / `abstain`. Pick the one that matches the language used.
   - `choice` — the named candidate or "Yes"/"No" for measures.
   - `statement` — a short quote (~1–3 sentences) from the source page
     justifying the position. Quote, don't paraphrase.
   - `source` — the exact URL the position came from. REQUIRED for every
     position; this is the audit trail.

   When the language is ambiguous (e.g. "we encourage support of" vs. "we
   endorse"), pick `lean_for` over `endorse`. When in doubt, ask the user
   or omit the position entirely and note it in `evidence/NOTES.md`.

3. **Write `positions.json`.** Wrap the extracted positions in the sign
   input shape the CLI expects:

   ```json
   {
     "context": { "election": "<election>", "jurisdiction": "<jurisdiction>" },
     "positions": [ ... ],
     "attribution": {
       "of": {
         "name": "<full entity name as it appears on their site>",
         "uri":  "<entity homepage>",
         "kind": "organization"
       },
       "mode": "scraped",
       "retrieved_at": "<RFC 3339 UTC timestamp of the LATEST fetch>",
       "sources": [ "<top-level endorsements page URL>" ]
     }
   }
   ```

   `mode` should be `transcribed` instead of `scraped` if any positions
   came from a PDF, video, or human transcription rather than HTML.
   `inferred` is reserved for positions derived from coalition membership
   etc. — flag these clearly and consider whether they belong at all.

4. **Validate before signing.** Run the schema-only check:

   ```sh
   bun run packages/cli/src/index.ts validate research-bot/orgs/<slug>/<election>/positions.json
   ```

   Fix any issues. The closed schema rejects unknown fields, malformed
   URLs, and missing required fields — this is a free correctness pass.

5. **Write `evidence/NOTES.md`** summarizing: which positions you
   extracted, which positions you skipped and why, and any judgment calls
   the human reviewer should double-check.

6. **STOP. Do NOT sign.** Tell the user:
   - the bundle path
   - how many positions you extracted
   - which ones you flagged for review
   - the sign command they should run after reviewing

   ```sh
   bun run packages/cli/src/index.ts sign \
     research-bot/orgs/<slug>/<election>/positions.json \
     --key <their-researcher.identity.json> \
     -o research-bot/orgs/<slug>/<election>/signed.slate
   ```

The signing step is theirs because (a) only they hold the secret key and
(b) a human MUST review the attribution claim before publishing it on the
network — once signed and shared, the slate is essentially permanent.

## What NOT to do

- **Do not put the entity's name in `issuer.name`.** The issuer is the
  researcher; the named entity goes in `attribution.of`.
- **Do not fabricate a `subject.id`.** Leave it absent unless you have a
  real catalog mapping (e.g. a verified VIP id).
- **Do not skip the `source` URL on a position.** Without it, the
  position is unverifiable.
- **Do not sign with `inferred` mode unless the inference is obvious and
  documented in `NOTES.md`.** Inferred positions are the easiest way to
  inject incorrect data; default to omitting them.
- **Do not re-fetch on every invocation.** If `evidence/<page>.md` already
  exists and the user hasn't asked for a refresh, reuse it and update
  `attribution.retrieved_at` only if the user asks to re-scrape.
- **Do not edit positions.json by hand to "fix" a validate failure
  caused by an unknown field** — the closed schema is intentional; remove
  the field instead.
