# Issues

## Sources: 9 catalog entries never count as imported

Seen 2026-11-06, about 2:25 PM PST (22:25Z), on a fresh profile against the
local build. Sources → "Import the other 383 to compare" finishes with
"Imported 383", then offers "Import the other 9 to compare"; pressing it says
"Imported 9" and still offers the same 9, every time. `CatalogBrowser.tsx`
`isImported` keys an entry by `sourceIdOf(entry)|entry.election` and the
imported side by each slate's `source.id|electionOf(position)`, so an entry
whose slate's id or elections don't match its index entry never shows as
imported. Matters because the button never reaches "All shown are imported",
and those rows keep offering Follow for something already there.

## Cited endorsement sources already gone, or answering a bot page

Seen 2026-10-30, about 3:15 AM PDT (10:15Z), by `experiments/signed-source-capture/03-survey-hosts.ts`
(one GET, honest user agent; full results in that directory's `results/host-survey.json`). These are
URLs cited in `openslate-public-endorsements`, whose slates are live:

- 404 from two clients: `cragop.org/2026/03/21/california-republican-assembly-june-2026-primary-election-endorsements/`
  (94 positions), `sfgop.org/nov-2026-endorsements` (25), `sfyimby.org/endorsements/2026-primary-election/` (10).
- 404 from one client, the second failed to connect: `oaklandrisingaction.org/homepage/2026-oakland-progressive-voter-guide/`
  (20), `www.peaceandfreedom.us/index.php/news/elections-campaigns/november-2026-voting-guide` (22).
- 403: `www.nfib.com`, `www.plannedparenthoodaction.org`.
- 200 with a 212-byte body instead of the page: `www.sierraclub.org`.

Why it matters: a voter following `source` finds nothing, or a different page. Four of the five
404s have Wayback copies, so `source` could fall back to them. A 403 or a stub may be aimed at
scripts only.

## The publish workflows write the signing key to the runner's disk

`openslate-public-endorsements/.github/workflows/publish.yml`, step "Stage signing key from secret",
writes `OPENSLATE_SIGNING_KEY` to `$RUNNER_TEMP/signing/key.json` so `sign --key` can read it. The
project rule is that the key never touches disk, and `sign` only accepts a path today. The runner is
ephemeral, so this is lower risk than it sounds, but the rule and the workflow disagree. The ballot
repo's `publish.yml` does the same with `OPENSLATE_GUIDE_SIGNING_KEY`.

## The catalog files many parties and papers as plain `organization`

Seen 2026-10-30 in `bundle.json`: 339 of 390 entries say
`attribution.of.kind: "organization"`, among them dozens of county parties
("Alameda County Democratic Party", "Republican Party of Orange County"),
editorial boards ("Los Angeles Times Editorial Board") and papers ("The Press
Democrat", "Marin Independent Journal", "San Mateo Daily Journal"). The web app
works around it with name rules in `apps/web/src/lib/raceTally.ts`
(`sourceGroup`), but a paper with no "editorial board" in its name lands in
*Other groups* on All slates, and the rules are a guess at what the data should
say. Fix it in `openslate-public-endorsements`, where each org is scraped.

## The archive workflow's hourly schedule skips slots

Seen 2026-10-30, about 8:50 PM PDT (2026-10-31 03:50Z), in `gh run list` for
`openslate-source-captures`. `archive.yml` has fired on schedule at 3:33 PM and 7:37 PM PDT
(22:33Z, 02:37Z). The 4:30, 5:30 and 6:30 PM PDT slots (23:30Z, 00:30Z, 01:30Z) left no run, each
falling inside another run. The 8:30 PM PDT slot (03:30Z) had none 18 minutes later, with nothing
running. `plans/archive-org-snapshots.md` forecasts the first pass from hourly runs.

## June primary slates quote nothing and cite nothing

Seen 2026-11-03 in `openslate-public-endorsements`. `orgs/courage-california/2026-06-02`,
`orgs/la-forward/2026-06-02` and `orgs/reform-california/2026-06-02` have no `evidence/` and no
`source` on any position (17, 36 and 27). Five of their statements are the researcher's own words
("Dual endorsement with Chad Bianco.", "Recommended to block Spencer Pratt."). `verify-positions`
requires a source, and checks quoting, only in bundles with evidence, so these pass.

Why it matters: a statement with no source can't be checked or read in full, which is what
`plans/statement-truncation.md` set out to rule out. The election is past, but the slates are
still published.

## Statements the quoting check can't see

Seen 2026-11-03: `verify-positions` with the private store reports 1,345 statements "not found in
the evidence text". Without it (CI), saved news pages are skipped, and it's 1,829. The
whole-passage check (`scripts/lib/quote-bounds.ts`) only judges quotes it can find, so a cut quote
whose words differ slightly from the evidence (a typo, a different capture, a paraphrase in quotation
marks) isn't checked. Neither is a hard wrap just before a capitalised word in unfenced evidence
(`scripts/lib/evidence-text.ts`).

Why it matters: these are the gaps left in "a statement can't cut its source short". Listing the
not-found statements per bundle, as `review/unanchored.md` does for anchoring, would show which
are quotes.

## Local contest order is guessed outside San Mateo, and San Mateo's is hand-entered

Seen 2026-11-03, checking a San Mateo County ballot (`plans/ballot-order-san-mateo-check.md`).
Local measures sort by letter, except San Mateo, whose order is typed into
`apps/web/src/lib/regions/us-ca/countyDrawings.ts` (`measures`) from the county's drawing PDF. San Mateo's
ballot printed L, AA, J, U, so letter order is wrong there, and likely in other counties. Local
offices use §13109 patterns, also unchecked against a real ballot.

Why it matters: the voter copies picks down in this order. The user, as site manager, never wants to
maintain it by hand: the order should come from official data, carried in the signed ballot
listings (a contest's place in the county's ballot, SPEC §3.14), not from app code. Candidate
sources: each county's sample ballots (PDF per ballot type, or the voter-guide lookup), the county's
election-night results / Statement of Votes Cast (exported from the election system in its contest
order), and the Civic/VIP feed's `ballotPlacement` (already found wrong for LA: `plans/ballot-order.md`).


## A county's "County" results group pulls every local contest onto a place (Sonoma, Ventura)

Seen 12:29 PM PST 2026-11-04 (20:29Z), headless on openslate.us (`plans/county-results.md`).
`contestsForPlace` (`apps/web/src/lib/regions/us-ca/countyResults.ts`) takes any contest whose category is
`County` as one the whole county votes on (added in `f918124` for LA's groups). But Sonoma's
Clarity feed files all 37 non-state contests under `County` (Calistoga, Two Rock, Windsor school
boards, Santa Rosa council districts, supervisors), so a Santa Rosa place got 41 local races.
Ventura's `County` group holds "Kern County Board of Education Trustee Area 7" and trustee-area
seats, which an Oxnard place got. Reproduce: a place `{ localities: ["us/ca/santa-rosa",
"us/ca/sonoma-county"] }` with county Sonoma on the Results page, or `contestsForPlace` on
Sonoma's `summary.json`.

Why it matters: the matcher is meant to be over-inclusive, but here the voter has to remove dozens
of races that aren't theirs. LA's `County Measures` / `Sheriff` groups are truly countywide;
a bare `County` category isn't.


## Towns and townships aren't found: a lookup in twelve states finds the county and no town

Seen 2026-11-10 (`plans/national-scale.md`). The boundary files and the address relay look a
point up in the Census's incorporated places (TIGERweb layer 28). In New England, New Jersey,
New York, Pennsylvania, Michigan, Minnesota and Wisconsin most people live in a town or township
the Census calls a county subdivision (layer 22, `FUNCSTAT` `A` for the ones that are
governments). The geocoder's answer for 1625 Massachusetts Ave, Lexington, MA has no
`Incorporated Places` at all, and a `County Subdivisions` entry `Lexington town`.

Why it matters: a race filed under `us/ma/lexington` won't be on a Lexington voter's ballot after
a lookup. It needs a path convention before code: township names repeat inside a state
(Pennsylvania has many Washington Townships, New York has towns and cities of one name, Ithaca),
so a bare `us/pa/washington-township` isn't one place. Nesting under the county
(`us/pa/greene-county/washington-township`) is unambiguous and already a valid path (SPEC §3.3).


## The desktop app's offline catalog copy reads the catalog whole

`apps/web/scripts/snapshot-catalog.ts` downloads `index.json` and `bundle.json` and every entry.
The catalog also publishes `shards.json` now (one shard per election and state), and the web app
reads only that. The whole files are still published, so the snapshot works today.

Why it matters: once the catalog covers more than California the whole files have to stop
growing or go, and the snapshot then needs to take the shards for chosen states. It also copies
no boundary files beyond what's in `public/geo`.


## The Live results page is built on California's contest ids

`apps/web/src/components/LivePanel.tsx` and `apps/web/src/lib/watch.ts` keep what a voter
watches as the California Secretary of State's contest ids (`governor`, `us-rep/district/16`)
and its counties' feeds. A voter whose area is in another state is told there's no live count
for it yet (`ResultsView.tsx`), which is true today.

Why it matters: the shared results code already asks each state's sources through
`apps/web/src/lib/counts.ts`; the Live page doesn't. When a second state's own count is read (a
Clarity feed, as many states and counties publish), the watch list needs contest ids that say
whose count they're from, and that is also what would show whether `StateCounts` is the right
shape.

## `bun run lint` fails on `apps/web/scripts/ca-district-overlaps/2-classify.ts`

Seen 2026-11-10 on `origin/master` at `2fa7d4f` ("Regions: a registry of every state,
California behind it"). Biome reports `noExplicitAny` at 19:72 and a run of `noNonNullAssertion`
from line 26 on. Reproduce: `bun run lint` at the repo root.

Why it matters: a whole-repo lint run fails, so it can hide new lint failures in other files.
