# Candidate photos, statements, ballot arguments and measure text

`plans/candidate-info-and-official-text.md`

## Goal

User request (2026-10-22): race pages (`/race/$key`, `RacePanel.tsx`) have room
for candidate photos. Where do we get them? And: candidates' official blurbs,
the official arguments for and against a measure (with rebuttals), and the raw
text of a proposed law. Is there a standard published form we can load, and
should any of it be modelled as an "endorsement" that can be shared?

Status: phase 1 (the state guide) **done and live** (2026-10-22, about
1:25 AM PDT (08:25Z)): race pages on openslate.us show it, and 40
argument-signer organizations are in the catalog. **Phase 2, county guides,
in progress** (see below).

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

## Decisions already made (don't re-ask)

User, 2026-10-22, accepting the recommendations:

1. **Quote statements and arguments verbatim**, credited, with the guide's own
   "not checked for accuracy" line. Copyright is unconfirmed; the user accepted that.
2. **A candidate's statement about themselves never counts as backing.** Show
   it, never tally it.
3. **Organizations that sign ballot arguments become followable sources**
   (secondhand slates per signer org; joint argument adopted by reference, §3.10).
4. **The reference bundle starts as an app-level format.** It goes into
   SPEC.md once it settles.
5. **County guide PDFs stay out of git.** Store each race's extracted text
   plus the original's URL and sha256.

## Hosting today (checked 2026-10-22)

- The web app (`openslate.us`) is Cloudflare Workers static assets
  (`apps/web/wrangler.jsonc`, worker `openslate-web`, no Worker script).
- Endorsement data is **GitHub Pages**:
  `cinderblock.github.io/openslate-public-endorsements/index.json`
  (`Server: GitHub.com`, `Access-Control-Allow-Origin: *`, `max-age=600`).
  It's the app's `DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG` (`apps/web/src/lib/query.ts`).
- Keeping data on GitHub Pages keeps it on a host any fork can reproduce, apart
  from the project's own domain, which suits the no-central-server constraint.
  If we ever want the original PDFs archived, Cloudflare R2 is the place, not
  git. That is an infrastructure change: per-change authorization through the
  ops repo.

6. **One repo per state and election** for official ballot material, named
   `openslate-ballot-<state>-<election>`; first one
   `cinderblock/openslate-ballot-ca-2026-11-03`, served by GitHub Pages
   (user: "do it", 2026-10-22, after the per-election repo recommendation).

## Build design (decided while building; reasons given)

- **Statements and arguments live in the reference bundle, not in slates.**
  This changes the earlier proposal (a secondhand self-endorsement slate per
  candidate). Reasons: they are official guide content, shown only on the race
  page and never tallied (decision 2), so a slate per candidate would add
  catalog entries, follow state and tally exclusions for no visible gain. When
  a candidate signs a firsthand slate, that is a real source and supersedes
  nothing here. Argument *signer organizations* still become secondhand slates
  in the endorsements repo (decision 3).
- **The candidate list stays in the endorsements repo until after Nov 3.** The
  live app imports it from the catalog and users already hold it; moving it 12
  days before the election risks breaking ballots for no benefit. Revisit
  after the election.
- **Signed manifest + content-addressed files.** The ballot repo's CI signs one
  small manifest (JWS, header `typ: "openslate-ref+jws"`, same canonical JSON and
  Ed25519 as slates). The manifest lists every published file with its sha256
  and maps each subject to its item file. Item JSON, photos and PDFs are
  fetched lazily per race page and checked against the manifest's hash before
  use. A race page never downloads the whole election.
- **Full text stays a PDF.** CA law text marks additions and deletions with
  italics and strikeout; extracted plain text would lose that. The mirrored
  PDF (~100 KB each) opens after its hash checks.
- **Signing key: a new key per ballot repo.** The project key's private half
  exists only as the endorsements repo's Actions secret (by design, no local
  copy), so it can't be installed on a second repo. Each ballot repo gets its
  own researcher key, generated in memory and piped straight into
  `gh secret set`, never written to disk. The public half is committed in the
  repo's `keys/` and listed in the endorsements catalog next to the repo URL,
  which is how the app knows which key to expect.
- **Discovery: the endorsements catalog lists ballot references.** `index.json`
  gains `references: [{ election, jurisdiction, url, key }]` (from a
  `references.json` in that repo). The race page reads the catalog it already
  caches, picks the reference for its election and jurisdiction, then checks
  the manifest's `kid` against `key`.
- **Named "guide", not "reference"**: SPEC §3.5 already has `Reference`
  (cross-endorsements). Format in `packages/core/src/guide.ts`, header
  `typ: "openslate-guide+jws"`, catalog file `guides.json`.
- **Format and verification in `@openslate/core`; signing in the CLI**
  (`openslate guide check|sign|verify`). The CA guide scraper lives in the ballot repo,
  and the repo is a GitHub template, so the next CA election starts from it.

## Build plan

1. [x] Core: `guide.ts` (types, manifest, sign, verify, sha256) + tests
2. [x] CLI: `openslate guide check|sign|verify`
3. [x] Ballot repo scraper (`scripts/scrape-ca-vig.ts`): 90 items: 12 races
   (20 statements with photos), 14 propositions (summary, Yes/No meaning,
   AG title and summary, LAO analysis with figures and tables, 50 arguments
   and rebuttals with signers, text PDF), 65 justice retentions (Supreme Court
   statements of qualifications; Courts of Appeal bio links or "no
   biographical information"). Evidence pages kept byte-exact.
4. [x] Ballot repo `cinderblock/openslate-ballot-ca-2026-11-03`: CI signs and
   publishes; live at https://cinderblock.github.io/openslate-ballot-ca-2026-11-03/,
   `guide verify --files` passes over HTTPS (132 files). Marked a template.
   Key `ed25519:CdNuyS5e7RAMhAa9kH6RSCNE3tracD4jSS9dr3Br3JQH`, private half
   only in the `OPENSLATE_GUIDE_SIGNING_KEY` secret (generated into it via pipe).
5. [x] Endorsements repo: `guides.json` published beside `index.json` (`a1d31bf`)
6. [x] Web: `lib/guides.ts` + `components/GuideContent.tsx` on the race page;
   checked in the dev server against the live guide (Superintendent, Prop 1,
   Prop 39, Governor)
7. [x] Argument-signer organizations: `scripts/ca-ballot-arguments.ts` in the
   endorsements repo (`3956a00`), 56 positions in 40 new bundles (`inferred`,
   evidence notes link the saved guide pages at the ballot repo's `5f20bcb`).
   A signature counts only from a senior officer (president, CEO, executive
   director, chair, director, chief); 25 signatures left out (board members,
   past or incoming officers, members, staff, former officials, government
   bodies, a city). The 28 signatures from organizations already in the
   catalog all **agree** with their recorded positions, so none changed.
8. [x] READMEs (OpenSlate, endorsements, ballot repo). SPEC note deferred by
   decision 4.

## Next

- After Nov 3: move the CA candidate list (ballot source) into the ballot repo.
- **County guides: in progress**, see *Phase 2* below.
- Incumbent photos from public-domain sources: **proposed to drop** (asked
  2026-10-22). Photos of incumbents only would put a face next to the
  officeholder and a blank next to every challenger, which tilts the page. An
  official guide gives every candidate the same chance to print one. Keep to
  guide photos (and later, photos candidates sign themselves).

## Phase 2: county guides (started 2026-10-22, about 3:40 PM PDT (22:40Z))

User: "let's get county guides."

### What a county guide adds

- Statements for Congress and the Legislature (the state guide has none), and
  for every local office.
- Local measures: a digest or impartial analysis, what Yes and No mean, a
  fiscal statement, the official arguments and rebuttals, and the legal text.

### San Francisco first

SF is the only county whose local races the app knows (ballot source
`orgs/sf-department-of-elections`). The guide only appears on races the app
already shows, so a county without a ballot source only gains its Congress and
Legislature statements.

Findings (checked 2026-10-22):

- The Nov 3 Voter Information Pamphlet is one 252-page PDF,
  `https://media.api.sf.gov/documents/N26_EN_VIP.pdf` (7.9 MB; also CH, SP,
  FI, VI). The "HTML edition" its cover mentions is the personalised Voter
  Portal (login), and the old `voterguide.sfelections.org` site is gone
  (Pantheon "404 Unknown site"). So the PDF is the public source.
- `sfelections.gov` returns 403 to curl's default user agent; a browser user
  agent works.
- **No photos.** No image XObjects on any candidate page (pdf.js operator
  list); only the page-footer form. SF prints statements as text only.
- Statement layout: "Candidates for <office>" heading (20 pt Arial Black),
  each name in capitals (15 pt), "My occupation is …", "My qualifications
  are:", the text, often a web address, and the candidate's name as a
  sign-off. Two columns, one candidate per column. Footer caveat: "Statements
  are volunteered by the candidates and have not been checked for accuracy by
  any official agency. Statements are printed as submitted. Spelling and
  grammatical errors have not been corrected."
- Measures: the question and vote threshold; a digest by the Ballot
  Simplification Council ("The Way It Is Now", "The Proposal", what a Yes and
  a No vote mean); the Controller's statement; "How X Got on the Ballot" (the
  Supervisors' votes); proponent's and opponent's arguments with rebuttals;
  then **paid arguments**, each ending "The true source(s) of funds for the
  printing fee of this argument: …"; legal text from printed page 148.
- Text extraction: pdf.js (`pdfjs-dist`, Apache-2.0) gives every run with its
  position and font (`fontExtraProperties: true` resolves names such as
  `Arial-Black`, `ArialMT`, `Arial-ItalicMT`). Items are not in reading order,
  so sort by column, then by y.
- The pamphlet also prints "Party Endorsements of Candidates" (official
  party endorsements filed with the county). Possible endorsement data; not
  in scope.

### Design (phase 2)

- **Same repo**, one guide per county: `county/<county>/` holds `guide.json`
  and `items/`, published at `/county/<county>/guide.jws`. Each county is its
  own manifest because each is a different authority's publication
  (`attribution.of`), and one manifest for all 58 would grow large. The
  repo's one key signs all of them.
- **guides.json gains `covers`**: the jurisdictions a guide has items for.
  Congress and Legislature subjects are `us/ca/cd-N`, `us/ca/ad-N`,
  `us/ca/sd-N`, which a county jurisdiction (`us/ca/sf`) doesn't contain, so
  prefix matching can't find them. The app tries every guide that covers the
  subject's jurisdiction and uses the first whose manifest lists the subject.
- **The pamphlet PDF stays out of git** (decision 5). The scraper caches it
  outside git and records URL, SHA-256, size and retrieval time in
  `evidence/county/<county>/index.json`. Each passage's `source` is the PDF
  URL with `#page=N`.
- **Legal text is linked, not extracted.** SF prints additions and deletions
  both in italics, telling them apart by underline and strikethrough drawn as
  lines, not as font properties. Extracted text would silently drop the
  difference between added and deleted law. A `document` may now omit `file`
  and give `page` (and the original's SHA-256) instead; the app links to the
  official PDF at that page.
- **Paid arguments** are kept, marked `paid: true`, with the printed
  `funding` line. The app shows them after the official arguments, collapsed
  and labelled as paid.

### Phase 2 steps

1. [x] Core: `argument.paid`, `funding`, `title`, `footnote`; `document.file`
   optional with `page` and `sha256`; `passage.title`; tests (`936c05f`,
   `d20e8d2`)
2. [x] App: `covers` matching across guides; paid arguments; linked
   documents; passage titles; recovery from a republished guide (`aa38d3e`,
   `450d7d5`, `232c37e`); README (`0323559`). Live on openslate.us.
3. [x] Ballot repo: `scripts/lib/pdf-layout.ts`, `scripts/scrape-sf-vip.ts`,
   shared `scripts/lib/guide-common.ts` (state guide rebuilds byte-identical)
   (`637f9dd`, `dec0e00`). SF guide: 26 items, 46 statements, 44 official and
   121 paid arguments (`ff024a3`).
4. [x] Ballot repo: CI signs and verifies every guide; site publishes
   `county/sf/`; pinned OpenSlate `0323559` (`2792587`). `guide verify
   --files` over HTTPS: SF 26/26 files, state 132/132.
5. [x] Endorsements repo: SF entry and `covers` for both guides (`cd906a8`)
6. [ ] Check live on openslate.us ← **current**
7. [ ] Signer organizations from SF's official and paid arguments (decision 3)
8. [ ] Next counties: decide by what's publishable and where users are

### Findings while building phase 2

- **Telling a wrapped line from a deliberate break.** The pamphlet is ragged
  right, and candidates and signers break their own lines (lists of
  endorsers, signature blocks). Geometry alone can't decide within a few
  points of the margin. What works: a line joins the next with a space unless
  the next line's first word would *clearly* have fit (by 25 pt); in a
  paragraph that is mostly breaks (a list), an uncertain join is a break
  unless the line above is partway through a comma-separated run. Column edges
  are per page (digest columns are narrower than statement columns), from the
  90th percentile of line ends, because a stray wide line (a vote threshold)
  throws off a maximum.
- **Signatures.** A signature ending in `*` or `.` is complete; "Name, Title"
  starts a new one; a capitalised wrap shows itself by carrying the signer's
  `*` ("Development Center*"). A trailing "*For identification purposes
  only…" paragraph is the argument's `footnote`. Six arguments with unusual
  sign-off layouts come out with no signers; their names stay in the text.
- **Paid arguments** end with "The true source(s) of funds…" and may continue
  with "The three largest contributors…" or "The sole contributor…"
  paragraphs. Count check: 121 funding lines in the PDF, 121 paid arguments.
- **Names that differ from the ballot:** "Mano Raju" (ballot: Manohar Raju),
  "Lisa Palagi Wynn II" (Lisa Wynn), "Joaquín Torres" (Joaquin Torres). The
  matcher's last-name fallback handles them and the scraper lists them.
- **The app persists its query cache** (`react-query-persist-client`), so a
  manifest outlives reloads for up to an hour. After a republish, a page
  would reject new files as not matching. Fixed: a mismatched file is fetched
  again past the browser cache, then the manifest is refetched once per file
  and hash (so real tampering can't loop), and manifests revalidate with
  `cache: "no-cache"`.
- Local testing without touching the real key: serve a local catalog mirror
  (files present locally, everything else proxied to Pages, with CORS), sign
  the county guide with a throwaway key generated in `%TEMP%`, and run vite
  with `VITE_PUBLIC_ENDORSEMENTS_CATALOG` pointing at it. Use the incognito
  preview profile: the default one holds the user's ballot data.
- Biome flagged the scrapers' generated JSON (state guide too). Generated
  `guide/`, `county/`, `evidence/` are now ignored by biome.

## Progress log

- [x] Survey of current data model and ballot-source pipeline
- [x] Research: state guide, county guides, VIP / Civic, photo sources, CORS
- [x] User answers to the open questions (2026-10-22)
- [x] Hosting decision: one repo per state and election
- [x] Build plan steps 1–8 (2026-10-22)

## Findings while building

- The guide's pages declare UTF-8 and are UTF-8; `parse5` handles their
  mis-nested `<strong><em>…</strong></em>`.
- Signers: the last paragraph of each argument section, opening with a bold
  name; a single signer may have no `<br>` (Prop 38's "Robert M Kaplan, Ph.D.").
- Courts of Appeal pages only link to courts.ca.gov bios; six justices have
  "(No biographical information available.)" instead of a link.
- Biome's `--write` turned a `[\u0300-\u036f]` regex class into literal
  combining characters; use `\p{M}` with the `u` flag instead.
- Git `text=auto` rewrote the saved evidence pages' line endings, so
  `evidence/** -text` keeps them byte-exact.

- Race pages only show a guide when the race itself is known (an imported
  ballot source or slate covers it); a bare `/race/<key>` with nothing
  imported shows nothing, as before.

## Things not to do

- Don't embed full measure text or images in slate tokens.
- Don't fetch voterguide.sos.ca.gov from the browser (no CORS), and don't route
  it through a project server (no central server).
- Don't scrape Ballotpedia or Voter's Edge for photos or bios.
- Don't push the main checkout's master: other threads' unpushed commits ride
  along. Ship from a worktree cut from `origin/master` (as done for this work).
- Don't present a candidate statement or ballot argument as checked fact: carry
  the guide's own "not checked for accuracy" line.
