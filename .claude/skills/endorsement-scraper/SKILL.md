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
Capture tool and its rules: the
[`openslate-source-captures`](../../../../openslate-source-captures) checkout.

**Capture comes first, and it's objective.** The raw bytes a source served are
the record; everything after them is reading. Capture never filters, cleans,
summarises or picks: that's what makes the record worth having. Your judgement
belongs in steps 3 and later, where a reviewer can check it against the bytes.

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

1. **Capture each source verbatim.** Don't use WebFetch for evidence: it runs
   the page through a model, so what comes back isn't what the server sent.
   Every URL gets captured, whole, by the capture tool. A published slate's
   sources are picked up mechanically on the next scheduled run, but a new
   source needs its bytes now, so capture it from the
   [`openslate-source-captures`](../../../../openslate-source-captures) checkout:

   ```sh
   # Add the URL to discovered.json, with where you found it and why, then:
   bun src/sources.ts ../openslate-public-endorsements
   bun src/run.ts out --only-hosts <host>[,<host>...]
   bun src/seal.ts out
   ```

   `run.ts` reads only `sources.json`, so a URL that isn't listed there can't be
   captured. That's the point: selection is public. `--only-hosts` narrows a run
   to the hosts you name, and the manifest records that it did.
   - **Whole responses only.** No stripping, no cleaning, no byte ranges, and
     no choosing which part of a page to keep.
   - **Failures are results.** A 403, a 404, a timeout or a 212-byte stub with a
     200 stays in the record. A retry is another recorded exchange and never
     replaces the first. Note each one in `evidence/NOTES.md`.
   - **The user agent is honest,** and the tool sets it. Don't change it to get
     past a block. If a site refuses the tool, keep that refusal on record, then
     ask the user: a person may capture the page in a browser, and it's labelled
     as a human capture in `evidence/NOTES.md`. It's still a capture, but it
     can't claim the CI witness.
   - **Data loaded by script.** If the page's text isn't in its HTML, find the
     request that carries it and capture that response. If that's a vendor's
     domain, capture the organization's page linking to it too, or nothing ties
     the data to the organization. Add both to `discovered.json`.
   - **Check the capture.** Read `manifest.json`'s status for each URL before
     going on, and don't take a 200 to mean content.

2. **Derive evidence from the capture.** Write
   `research-bot/orgs/<slug>/<election>/evidence/<page-name>.md` from the
   captured response, with the URL, the run id, the response's `sha256` and the
   capture timestamp at the top of the file. One file per URL.
   - Evidence is a convenience for readers. The capture is the record, so a
     reviewer can always go back to the bytes.
   - Convert mechanically (the text of the page, in order). Don't drop parts of
     the page by judgement, and don't summarise.

3. **Extract positions.** For each clearly stated endorsement, draft a
   Position object:
   - `subject.title` — the race or measure title as it appears on the page.
   - `subject.kind` — `race`, `measure`, `candidate`, or `option`.
   - `subject.jurisdiction` and `subject.election` — copy from inputs.
   - `subject.id` — leave unset if you don't have a `vip:<id>` mapping.
   - `stance` — `endorse` / `oppose` / `lean_for` / `lean_against` /
     `neutral` / `abstain`. Pick the one that matches the language used.
     It's only how the position counts; the entity's own words go in `label`.
   - `label` — the entity's own term for the position, exactly as it writes
     it: "Endorsed", "Recommended", "No recommendation", "Cautious
     recommendation" (SPEC §3.17). Set it whenever the page uses its own
     terms, so voters read the entity's words instead of the app's stance
     wording ("leans for"). Never invent one: a page that just lists names
     gets no label.
   - `choice` — the named candidate or "Yes"/"No" for measures, spelled
     **exactly as the official ballot prints it** when an election authority
     bundle lists the race (see step 5b), e.g. `Donald P. (Don) Wagner`, not
     the page's "Don Wagner". Keep the page's own wording in `statement`.
   - `choice_id` — the listing's id for that choice (SPEC §3.11), copied
     from the election authority bundle. Don't type it:
     `normalize-choices.ts --apply` (step 5b) fills it in for every choice
     it can place. Never make one up for a race no authority lists.
   - `write_in: true` — only for a candidate who isn't printed on the
     ballot and has to be written in (SPEC §3.12). Never `false`; omit it.
   - `statement` — a short quote (~1–3 sentences) from the source page
     justifying the position. Quote, don't paraphrase: a statement that isn't
     in the captured text shows up as unanchored on the evidence page.
   - `source` — the exact URL the position came from. REQUIRED for every
     position; this is the audit trail.

   When the language is ambiguous (e.g. "we encourage support of" vs. "we
   endorse"), pick `lean_for` over `endorse`, and keep the page's term in
   `label`. When in doubt, ask the user
   or omit the position entirely and note it in `evidence/NOTES.md`.

   **Republished picks.** If the page merely republishes another entity's
   list (a county party reposting the state party's statewide picks, a
   state affiliate reposting its national union's House list, a joint
   statement), don't copy those positions. If a bundle for the other entity
   exists, adopt them by reference instead (SPEC §3.10):

   ```sh
   bun run packages/cli/src/index.ts adopt <other-entity-signed.slate-url> \
     --mode reference --match "Governor,Proposition" \
     --source <this-entity's-page> --into research-bot/orgs/<slug>/<election>/positions.json
   ```

   Otherwise, list them in `evidence/NOTES.md` under `## Republished from
   <entity>` so they can be adopted once that bundle exists.

4. **Write `positions.json`.** Wrap the extracted positions in the sign
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
       "retrieved_at": "<RFC 3339 UTC timestamp of the LATEST capture>",
       "sources": [ "<top-level endorsements page URL>" ]
     },
     "labels": [
       { "label": "Endorsed", "description": "<the page's own definition, quoted>" },
       { "label": "Recommended" }
     ]
   }
   ```

   `labels` lists every `label` the positions use, in the order the page
   presents them (SPEC §3.17); a position's label must be one of them.
   Give a `description` only when the page defines the term (a foreword
   saying how endorsements are decided), and quote it. Omit `labels`
   entirely when no position has a label.

   `mode` should be `transcribed` instead of `scraped` if any positions
   came from a PDF, video, or human transcription rather than HTML.
   `inferred` is reserved for positions derived from coalition membership
   etc. — flag these clearly and consider whether they belong at all.

   Leave `attribution.capture` unset unless the user asks for it (SPEC §3.9.1).
   The link from a slate to its captures is kept in the capture repo's
   provenance records, so a later sweep doesn't mean a new slate.

5. **Validate before signing.** Run the schema-only check:

   ```sh
   bun run packages/cli/src/index.ts validate research-bot/orgs/<slug>/<election>/positions.json
   ```

   Fix any issues. The closed schema rejects unknown fields, malformed
   URLs, and missing required fields — this is a free correctness pass.
   It is the same check `sign` applies to the file, so a bundle that
   validates here signs.

5b. **Check races and names against the ballot.** Copy the bundle into the
   [`openslate-public-endorsements`](../../../../openslate-public-endorsements)
   checkout (`orgs/<slug>/<election>/`) and run, from there:

   ```sh
   bun scripts/normalize-choices.ts <election>    # dry run: what it would fix
   bun scripts/verify-positions.ts                # the CI gate
   ```

   `normalize-choices.ts` edits only files git tracks, so `git add` the new
   bundle first (don't commit yet). In any jurisdiction an election authority
   bundle covers (California statewide and legislative races, San Francisco,
   Los Angeles and Orange County local races), the gate fails a race title
   that isn't on the authority's list, and a `choice` that isn't one of that
   race's ballot names spelled as the ballot spells it with its `choice_id`.
   The publish workflow runs the same check, so a failure here blocks
   publishing. For each failure:
   - **"is the ballot's …; fix with normalize-choices --apply"**: the same
     person by rule, or the right name without its id. Run
     `normalize-choices.ts <election> --apply`.
   - **"did you mean …? check the source"** or **"… is on the ballot for …:
     the wrong race?"**: only a resemblance (a typo, an unusual short form),
     or a listed candidate under another race. Check it against the evidence
     and the race's other names, then add `--suggested`, or fix it by hand.
     Note each one in `NOTES.md`.
   - **no suggestion, or a race failure**: fix the title or name by hand from
     the authority bundles (`orgs/ca-secretary-of-state/<election>/`,
     `orgs/sf-department-of-elections/<election>/`,
     `orgs/la-county-registrar/<election>/`,
     `orgs/oc-registrar-of-voters/<election>/`). If the org endorses someone
     who really isn't on the ballot, ask the user; a write-in candidate gets
     `"write_in": true` (it passes with a warning unless the authority lists
     them as a certified write-in). A seat that isn't on this ballot at all
     (uncontested, or not up this year) is a question for the user too.

   Races in jurisdictions no authority covers aren't checked; match their
   titles to other orgs' bundles by eye (`bun scripts/list-subjects.ts <election> [filter]`).

6. **Write `evidence/NOTES.md`** summarizing: which positions you
   extracted, which positions you skipped and why, any judgment calls the
   human reviewer should double-check, and every capture that failed, was
   blocked or came from a person's browser.

7. **STOP. Do NOT sign.** Tell the user:
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
- **Do not use WebFetch, a browser's reader text or a search snippet as
  evidence.** Use them to find a page if you must, then capture it.
- **Do not spoof a browser's user agent.** A block is a fact to record, and
  getting past it silently makes the record dishonest.
- **Do not describe a capture as proof the organization said something.** It
  shows what a domain served, and a domain isn't an organization (SPEC §3.9.1).
- **Do not edit positions.json by hand to "fix" a validate failure
  caused by an unknown field** — the closed schema is intentional; remove
  the field instead.
