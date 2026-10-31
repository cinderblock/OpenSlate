# IGS Library endorsement table: use as a lead list, not a source

## Goal

The user asked whether to add the UC Berkeley Institute of Governmental Studies
Library's table for the November 3, 2026 election:
https://igs.berkeley.edu/library/california-ballot-proposition-guides/november-3-2026-general-election/november-3-2026

## Environment / context

- The table covers 34 organizations across Props 1–5 and 37–45, in four groups:
  newspapers, non-profits, parties, unions. Marked "updated as of" October 26, 2026.
- Coding: Y, N, NP (no position or neutral); a dash means staff could not find a
  position; a blank means not yet checked. Neither a dash nor a blank is a position.
- IGS takes no positions itself. It compiles other organizations' published ones.
- Bundles live in `../openslate-public-endorsements/orgs/<slug>/2026-11-03/`.

## Recommendation (awaiting the user's decision)

Don't add IGS as a slate. Its rows would duplicate positions voters can already
follow, under an institution that endorsed nothing. Use it to find gaps, and
build each missing organization from that organization's own page.

## Findings

Compared 2026-10-30 about 9:30 PM PDT (2026-10-31 04:30Z) against the bundles,
with the private news captures for the disputed cells.

27 of the 34 organizations are in the catalog. The 7 that aren't:

| Organization | Primary source | State |
| --- | --- | --- |
| Libertarian Party of California | https://ca.lp.org/ballot-propositions/ | Read: 12 positions, 2 "No Position" |
| AFSCME California | https://calafscme.org/afscme-federal-election-endorsements/afscme-california-ballot-measure | Read: 10 positions |
| MALDEF | https://www.maldef.org/resources/california-2026-ballot-recommendations/ | Read: 7 positions |
| Friends Committee on Legislation of California | `FCLCA 2026 Ballot Recommendations.pdf`, linked from the IGS page | Text extracts; Props 1–5 seen, the rest not read |
| California Church IMPACT | https://churchimpact.org/wp-content/uploads/2026/09/CA-2026-Ballot-Guide.pdf | Downloaded, text extracts; positions not yet read |
| California Pan-Ethnic Health Network | https://cpehn.org/about-us/blog/prop-endorsements-2026/ | Not read: WebFetch gets 403, curl fails. Needs the browser |
| American Independent Party of California | https://www.aipca.vote/endorsements | Not read: connection reset. IGS shows dashes in every cell, so it may have nothing |

Every cell where IGS disagrees with a bundle checked out in the bundle's favor:

| Bundle | Cell | IGS | Ours | Evidence |
| --- | --- | --- | --- | --- |
| `spur` | Props 41, 42, 43 | Y | No | SPUR's guide says "Vote NO" on each (re-read today) |
| `southern-california-news-group` | Prop 39, OC Register row | N | Yes | Roundup: "Proposition 39: Yes"; editorial slug `endorsement-yes-on-proposition-39`. The IGS Register row is identical to its San Diego Union-Tribune row, so a copy error is likely. IGS's Press-Enterprise row says Y |
| `california-federation-of-teachers` | Prop 44 | N | Neutral | CFT PDF: "Prop 44 NEUTRAL" |
| `sf-chronicle` | Prop 40 | NP | No | Capture of 2026-10-19 says "Coming Soon", 2026-10-28 says "Proposition 40: No". IGS may simply be stale |

The IGS OC Register article of 2026-10-20 could not be opened (WebFetch blocks the
domain, curl fails), so the Register row was disproved from SCNG's other pages.

Real gaps on our side:

- `caltax` has 5 of 14 props, all inferred from signed ballot arguments. IGS shows
  14 but cites only the CalTax homepage, which shows a "Voters Guide" graphic with
  no readable text. Find the guide itself; don't copy the IGS cells.
- `ca-labor-federation` Prop 38: the PDF says "No Recommendation", and NOTES records
  it as deliberately omitted. `spur` Prop 40, also "No Recommendation", is recorded
  as neutral. The two bundles treat the same term differently.

Where the catalog goes further than IGS: `courage-california`,
`press-democrat`, `california-nurses-association` and `la-times` hold positions on
props that IGS dashes. `mcclatchy-california-editorial-boards` holds the Sacramento
Bee's 14 props, and they match the IGS row; the `sacramento-bee` bundle has none.

## Decisions

- Approved 2026-10-31: skip an IGS slate and build from primary sources.
- A published "No Recommendation" on a measure is `neutral` or `abstain`. On a candidate
  race it's omitted.
- Bryan's Oakland Voter Guide is published with `kind: individual`, as the user asked to add it.

## Built and pushed 2026-10-31 (endorsements repo `0e135f3`..`2a6857e`)

| Bundle | Positions | Note |
| --- | --- | --- |
| `maldef` | 7 | |
| `cpehn` | 14 | Live page blocks clients; read from a Wayback copy of 2026-10-08 |
| `ca-libertarian-party` | 16 | 14 props, 2 candidates |
| `afscme-california` | 147 | IGS cites only its props page; two more hold the candidates |
| `friends-committee-on-legislation-california` | 14 | |
| `california-church-impact` | 14 | No logo found |
| `wellstone-democratic-renewal-club` | 60 | EBMUD Ward 4 and Peralta Area 3 picks aren't on the ballot listing |
| `oakland-review-of-books` | 41 | News org; 27 pages withheld to the private store |
| `bryans-oakland-voter-guide` | 48 | Personal guide; a first name only |
| `caltax` | 15 | Now the published guide, read from an image; was 5 inferred |
| `ca-labor-federation` | +1 | Prop 38 `neutral` |

Courage California needed no change: the Progressive Voter Guide is its own guide, already
the bundle's source. The one card updated after our capture is Prop 40, still "Support".

American Independent Party is not built. `aipca.vote` resets every client tried, and its only
readable copy (Wayback, July) is headed "2026 Primary", so those picks can't stand for November.

The 10-20 OC Register article, reached with Bun, says "Yes on Prop 39", confirming that IGS cell is wrong.

Every new prop pick matches its IGS row on a separate scripted reading.

Fetching: curl fails on many of these hosts; Bun's `fetch` works. Git Bash's `/tmp` paths and
relative paths for `pdftotext` are unreliable here; use Windows paths.

## Progress

- [x] Read the IGS table and compared it to the catalog
- [x] Verified each disagreement
- [x] User approved
- [x] Bundles built, verified (413 OK, 0 failed; 101 tests) and pushed

## Things not to do

- Don't copy IGS cells into a bundle. It has at least 4 wrong cells, and it isn't
  where those positions were published.
- Don't "correct" our bundles from this table. No disagreement went IGS's way.
- Don't treat a dash or blank as a position.
