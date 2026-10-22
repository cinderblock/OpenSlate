# Candidate photos, statements, ballot arguments and measure text

`plans/candidate-info-and-official-text.md`

## Goal

User request (2026-10-22): race pages (`/race/$key`, `RacePanel.tsx`) have room
for candidate photos. Where do we get them? And: candidates' official blurbs,
the official arguments for and against a measure (with rebuttals), and the raw
text of a proposed law. Is there a standard published form we can load, and
should any of it be modelled as an "endorsement" that can be shared?

Status: **research done, design proposed, nothing built.** Waiting on the
user's answers to the open questions below.

## Environment / context

- Official candidate lists today come in as a *ballot source*: a slate whose
  entity kind is `election-authority` (`apps/web/src/lib/sources.ts`), one
  `neutral` position per candidate, built from SOS `cert.txt` in the sibling
  repo `openslate-public-endorsements` (CI signs and publishes to Pages; the
  web app's catalog imports from there).
- Party and ballot designation already ride on the ballot source's per-choice
  `statement` (`ChoiceGroup.ballotNote`).
- Hard constraint: no central server ([[project_no_central_server]]). Static
  files on the endorsements repo's Pages site are fine.
- `research/<race>/<candidate>.md` holds researcher-written candidate bios
  with links (Ballotpedia, CalMatters, iVoterGuide). A separate, already
  existing source of bio text, but not official.

## Findings (checked 2026-10-22)

### California state Voter Information Guide (voterguide.sos.ca.gov)

- **Candidate statements** exist only for the statewide offices (Governor, Lt
  Governor, SoS, Controller, Treasurer, AG, Insurance Commissioner, SPI) plus
  Board of Equalization. Only candidates who accepted the voluntary spending
  limits may buy one; up to 250 words. Page per office:
  `/candidates/<office>-candidate-statements.htm`.
- **Photos come with the statement.** E.g. `/img/spi/barrera.jpg`,
  `/img/spi/shaw.jpg` (~21 KB JPEGs). A candidate without a statement gets
  `/img/no-photo.jpg` ("No Photo Submitted"). 2026 general: neither Governor
  candidate (Becerra, Hilton) submitted a statement or photo.
- Every statements page carries: "Statements on this page were supplied by the
  candidates and have not been checked for accuracy by any official agency."
- **Propositions**: `/propositions/<n>/` has `title-summary.htm` (AG's
  official title and summary), `analysis.htm` (LAO), `arguments-rebuttals.htm`,
  and the full text as PDF at
  `https://vig.cdn.sos.ca.gov/2026/general/pdf/prop<n>-text-proposed-laws.pdf`.
  Whole guide: `.../pdf/complete-vig.pdf`, in 10 languages.
- **Arguments are signed by named people, with titles and organizations.**
  Prop 1's argument in favour: Anni Chung (Self-Help for the Elderly), Jeffery
  Freitas (California Federation of Teachers), John H. Ing (US Vets). No
  argument against was submitted. Disclaimer: "Arguments printed on this page
  are the opinions of the authors and have not been checked for accuracy by
  any official agency."
- **No CORS.** HTML, images and PDFs are served from S3 with no
  `Access-Control-Allow-Origin` header (curl with an `Origin` header, 2026-10-22).
  The browser can't read the text directly. Images would display in an `<img>`,
  but the hotlink tells SOS each viewer's IP and can't be integrity-checked.
- Old guides move to `vigarchive.sos.ca.gov/<year>/<election>/...`, so links
  rot after the election.
- No machine-readable feed found: HTML and PDF only.

### County guides

- Congress, the Legislature, judges and local offices get statements in the
  **county** guide, not the state one: 250 words for Congress and the
  Legislature, 200 for local offices (Sonoma County's rules). Local measures
  get arguments of up to 300 words, with 250-word rebuttals (Elections Code
  §9162, §9167), plus county counsel's impartial analysis and the full text.
- These are PDFs in 58 county formats. No structured feed found. Some counties
  say electronic distribution of statements is "not currently offered".

### Standards

- **VIP spec** `BallotMeasureContest` has `FullText`, `SummaryText`,
  `ProStatement`, `ConStatement`, `InfoUri`, `PassageThreshold` and
  `EffectOfAbstain`. **`Candidate` and `Person` have no photo, bio or
  statement field**: the closest is `ContactInformation.Uri`. Google Civic's
  `voterinfo` exposes `photoUrl`, `candidateUrl` and `referendumText`/`Pro`/`Con`,
  but in practice those are only as full as the state's VIP feed.
- So no standard carries candidate statements or photos. Measure text and
  arguments do have standard fields, though CA doesn't fill them in a form we
  can reach.

### Photo sources beyond the state guide

- **Congressional incumbents**: `github.com/unitedstates/images`, public-domain
  official portraits keyed by bioguide ID.
- **Wikidata P18 / Wikimedia Commons**: incumbents and prominent challengers,
  each with an explicit licence (usually CC BY or CC BY-SA, so attribution is
  required).
- **Avoid**: scraping Ballotpedia, Voter's Edge or campaign sites. The images
  are campaign-supplied, rights are unclear, and the sites' terms forbid it.

### Copyright: unresolved

I found no statute putting candidate statements or ballot arguments in the
public domain. They are printed and published by the state as public records,
but candidates and signers wrote them. Not confirmed either way.

## Proposed design

Three kinds of material, three treatments:

1. **Candidate statement = a secondhand self-endorsement.** "Vote for me
   because..." *is* an endorsement. Publish it as a secondhand slate (§3.9):
   `attribution.of = { name: <candidate>, kind: "candidate" }`, `mode:
   "scraped"`, stance `endorse` on their own choice, `statement` = the text,
   `source` = the guide page. No spec change is needed. When the candidate
   later signs a slate themselves, the existing rule (prefer firsthand, offer
   to supersede) already applies. The UI shows it on the race page as "In
   their own words (official voter guide)", **not** in the backing tallies,
   quick fill or "N sources" counts, much as ballot sources are kept out of
   them.
2. **Ballot argument = a secondhand endorsement by its signers.** Argument for
   → `endorse` choice `Yes` (against → `No`), `statement` = argument text, the
   rebuttal as a second position or appended, attributed to the signers ("Signers
   of the argument for Prop 1: ..."). Bonus: the signers' organizations are
   real endorsement data (the CA Federation of Teachers backs Prop 1), worth
   offering as their own sources or folding into existing org bundles.
3. **Neutral reference material** (full text, AG title and summary, LAO or
   county counsel analysis, photos): not a position, so it doesn't go in a
   slate. Ship a per-election **reference bundle** from the endorsements repo:
   JSON keyed by subject id, holding text, original URL, `retrieved_at`, and
   the sha256 of each mirrored original. Photos are mirrored next to it with
   credit and licence. It is signed with the project key over canonical JSON
   (the same machinery as slates) and fetched lazily by the race page, never
   embedded in a token. Proposition PDFs (~100 KB each) and the complete guide
   are far too big for one-line tokens.

Why mirror rather than hotlink: SOS has no CORS, URLs rot into vigarchive,
hotlinks leak viewer IPs (the same concern we disclose for USGS map tiles), and
mirrored files can be pinned by hash.

The long-term photo and bio answer is **firsthand**: a candidate signs a
profile (photo URL plus hash, bio, links) with their own key. Leave room for it
in the spec, but don't block on it.

Scope order: (a) state guide (statewide candidates, all propositions), (b)
Congress and Legislature incumbent photos from public-domain and Wikidata
sources, (c) county guides, one county at a time, starting where users are (SF,
LA, San Mateo, given the bundles we have).

## Open questions for the user

1. **Reuse of statement and argument text.** Reproduce verbatim with the
   source link and the guide's own disclaimer? *Recommendation: yes.* They are
   official public election materials, and we'd quote them whole and attributed.
   Copyright isn't confirmed (see Findings), so this is the user's call.
2. **Should a candidate's statement about themselves count anywhere as backing?**
   *Recommendation: no.* Show it, never tally it.
3. **Should ballot-argument signers become sources** (followable, quick-fillable)?
   *Recommendation: yes, as secondhand slates per signer org*, with the joint
   argument recorded once and adopted by reference (§3.10).
4. **Hosting photos**: mirror on the endorsements Pages site (recommended) or
   hotlink SOS and Commons?
5. **Spec**: add a "reference bundle" document type to SPEC.md, or keep it an
   app-level format for now? *Recommendation: app-level first, spec once it settles.*

## Progress log

- [x] Survey of current data model and ballot-source pipeline
- [x] Research: state guide, county guides, VIP / Civic, photo sources, CORS
- [ ] User answers to the open questions
- [ ] Scraper for state-guide statements, photos, arguments and text (endorsements repo)
- [ ] Reference bundle format, signing and publishing
- [ ] Race page: photo, "in their own words", arguments, analysis and full text
- [ ] Collation: keep candidate self-statements out of the tallies

## Things not to do

- Don't embed full measure text or images in slate tokens.
- Don't fetch voterguide.sos.ca.gov from the browser (no CORS), and don't route
  it through a project server (no central server).
- Don't scrape Ballotpedia or Voter's Edge for photos or bios.
- Don't present a candidate statement or ballot argument as checked fact: carry
  the guide's own "not checked for accuracy" line.
