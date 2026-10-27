# Official text for local measures outside the covered counties

`plans/local-measure-text.md`

## Goal

ISSUES.md (2026-10-26): My ballot links a measure's official text only when a
voter guide in `guides.json` lists it (state, SF, LA, OC, Alameda, San Diego,
Santa Clara, San Mateo). A voter asked for "a link to the measure text for all
the measures, especially the local ones". Give every Nov 3, 2026 local measure
in the catalog a link to its official documents.

## Environment / context

- Guides: `packages/core/src/guide.ts` (format), `apps/web/src/lib/guides.ts`
  (the app matches a guide item to a race by `subjectKey`: exact title +
  jurisdiction + election), `guides.json` in the endorsements repo lists them
  with `covers`.
- Ballot repo: `~/git/Personal Projects/openslate-ballot-ca-2026-11-03`
  (`county/<c>/` per guide, CI signs and publishes to Pages). San Mateo's guide
  (`scripts/scrape-smc.ts`) is the model: measures only, each official
  document *linked* (URL + SHA-256 of what was retrieved), not mirrored. The
  app already renders linked documents.
- Survey (2026-10-27, ~3 AM PDT), from the live `bundle.json` and every
  guide manifest: 410 measure subjects, 144 without a guide item. 25 of those
  are June 2, 2026 primary measures (past election, fine). The rest: 125
  subjects (some are one measure titled two ways) in 17 counties plus Newport
  Beach's city-run special election:
  contra-costa 8, fresno 9, kern 1, marin 12, monterey 16, napa 2,
  newport-beach 3, placer 9, riverside 1, sacramento 9, san-bernardino 19,
  san-luis-obispo 2, santa-barbara 8, santa-cruz 3, sonoma 12, stanislaus 4,
  ventura 5, yolo 2. None carries a `uri`.

## Decisions (mine, with reasons)

- **Linked-document guides, one per county, from reviewed tables.** Same
  channel as every other official material (signed manifest, `covers`, the
  race page's existing rendering), so nothing new in the app. Each county
  publishes measures differently, so the per-measure links are researched
  and reviewed by hand into a table (`linked/<county>.json` in the ballot
  repo); one generic script (`scripts/link-measures.ts`) downloads each
  document, records its SHA-256 and writes the guide. A wrong link is worse
  than none: every link is checked against the document's own text.
- **Not an app-level "county elections office" fallback link.** It would
  need a city→county table and only gets a voter to a page that may list
  the measure; the guide links the document itself. Revisit if new local
  measures keep arriving without guides.
- **Not `subject.uri` in the endorsement bundles.** That's the slate's own
  link ("More info: linked by the slate itself"), not official material.

## Plan / steps

1. [x] Research each county's official measure documents (five parallel
   agents by county group) into draft tables.
2. [x] `scripts/link-measures.ts` in the ballot repo + table schema
   (`linked/<county>.json`).
3. [x] Review drafts, build guides, `bun run check`, commit, CI publishes
   (ballot `86d5d69` script, `427b225` guides; publish run green).
4. [x] Endorsements repo: `guides.json` entries with `covers`
   (endorsements `9c72e59`; its publish run green).
5. [x] Checked live on openslate.us (Monterey County Measure E: resolution,
   impartial analysis, argument in favor, each linking the county's PDF).
6. [x] READMEs (ballot repo section "Linked measure documents", OpenSlate's
   guide paragraph), ISSUES.md entry removed, burndown plan updated.

## Result (2026-10-27, ~1:55 AM PDT (08:55Z))

17 county guides, 113 items (one per catalog title), 320 official
documents, every link opened and checked against the document's own text
(the table's `checked` note). Counties: Contra Costa, Fresno, Kern, Marin,
Monterey, Napa, Placer, Riverside, Sacramento, San Bernardino, San Luis
Obispo, Santa Barbara, Santa Cruz, Sonoma, Stanislaus, Ventura, Yolo.

Nothing official online (listed under `missing` in the tables, recheck
before Nov 3 if time allows): Greenfield O (Monterey); Santa Ynez Valley
UHSD D2026, Isla Vista CSD E2026 and F2026, Santa Maria C2026 (the city
links files, but every request was refused, browser included) (Santa
Barbara); Santa Paula USD C, United Water CD D, Simi Valley A, Rio SD B
(Ventura).

## Findings / gotchas

- **Bot walls.** Bun's `fetch` speaks HTTP/1.1, and Monterey's, Kern's and
  Walnut Creek's hosts (Akamai and similar) refuse HTTP/1.1 clients with
  403. PowerShell `Invoke-WebRequest -HttpVersion 2.0` with a browser
  user agent gets every one. Git Bash's curl has no HTTP/2. So a table
  document can carry `manual: { sha256, bytes, retrieved_at, by }`, used
  when the script is refused and checked whenever it gets through. Marin,
  Napa and Contra Costa sit behind Cloudflare challenges for curl/WebFetch,
  but the script's requests got through on the second run.
- **HTML documents** (Marin's, Sacramento's, Contra Costa's, Yolo's pages)
  are linked without a hash: markup changes on every visit. Sacramento puts
  every measure on one page with no anchors; titles say "under Measure X".
- Dropped from the agents' drafts: San Bernardino's and Riverside's
  "Notice of measure to be voted on; last day to file arguments" PDFs and
  two resolutions that only set rules for filing arguments (not measure
  documents). Titles trimmed of research notes.
- **Newport Beach P, Q, R are called off** for Nov 3 (city notice), yet the
  catalog lists them: new ISSUES.md entry, no guide built for them.
- Catalog titles that misdescribe measures (Chino F, Upland M, Allan
  Hancock H): new ISSUES.md entry.
- Fresno County Measure S: the posted resolution calls the election for
  March 7, 2028 (AB 1923 dispute), yet the county lists S on its Nov 3 page
  with arguments and analysis. Linked as published.
- Kern Measure Z's argument in favor is the raw submission packet, with the
  signers' phone numbers and emails, as the county posts it.
- `itemStore` (ballot repo `scripts/lib/pamphlet.ts`) keys items by title
  minus its parenthetical, so two titles for one measure (Paso Robles G-26)
  would merge; `link-measures.ts` keeps its own keys, falling back to the
  full title.
- App: race pages are hash-routed (`https://openslate.us/#/race/<key>`);
  a `/race/...` path loads the home page.
- Side fix: "Monterey County Elections's" on the guide attribution (and
  results' possessive) → `possessive()` (`9aeb941`).
- The ballot repo's `bunx tsc` fails on `scripts/sync-subjects.ts` (from
  peer commit `68e0920`); not run by its CI, not mine, left alone.

## Progress log

- [x] Survey of uncovered measures (above)
- [x] Research (5 agents), tables, builder, guides, catalog, live check

## Open questions for the user

(none)

## Things not to do

- Don't guess a document URL from a naming pattern: link only what the
  county's page links, checked by opening it.
- Don't link the June 2 primary measures (past election) or Newport Beach
  P/Q/R (called off).
