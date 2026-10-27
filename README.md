# OpenSlate

**An open standard and toolkit for sharing verifiable endorsements — and using
them to plan your own vote.**

> [!WARNING]
> **OpenSlate is alpha software, written by AI with a human watching over it.**
> While it's in alpha, things might be wrong, change, or break: the app, the
> data it shows, and the slate format itself ([SPEC.md](./SPEC.md) is still a
> draft). Check anything that matters, like who's on your ballot or what an
> endorser actually said, against your official voter guide and the original
> source. Found a problem? Come help:
> [open an issue](https://github.com/cinderblock/openslate/issues/new/choose),
> use *Send feedback* in the app, or send a pull request.

OpenSlate lets anyone publish a tamper-evident block of endorsements — for
candidates, races, ballot measures, or any option people vote on — and share it
over *any* medium (your website, a social post, an email). Each block is a single
line of text carrying an [Ed25519](https://ed25519.cr.yp.to/) signature, so
recipients can verify it hasn't been altered and who issued it, completely
offline. Individuals, organizations, and candidates can publish both **who they
endorsed** and **who endorsed them**.

On the receiving end, the web app lines up the endorsements of the sources
*you* follow, race by race, so you can see at a glance where the orgs and people
you trust agree and split on each contest, and make **your own picks** from
sources you can verify, alongside live polls and (after polls close) results.
A self-hosted server can add Kalshi market forecasts (opt-in, see below).

The web app is built for voters first: most visitors come to get help voting,
so that's the whole front of the app. Publishing is there for whoever looks
for it. Its two sides:

- **My vote** (everything up front): *My ballot* shows the races for your election and
  area laid out like the real ballot: the official candidate list in ballot
  order where one is imported, how many to vote for (or rank), a bubble per
  choice, and beside it how many of your followed sources back that choice.
  You decide a candidate race by ranking it: drag names into your order (by
  mouse, touch, keyboard or screen reader), or tap a bubble to move a name
  into the marked places. The ballot marks your first choices: the first
  N of a ranked-choice contest, else as many as you vote for; anyone you
  rank after that is a backup. Your sources' own ranks show on their chips,
  and what you publish carries yours. Chips use their own words too: a chapter's
  "Recommended" reads as theirs, with what it means, not as "leans for". It
  also keeps your private notes, shows
  what you've already signed, and links each race to the official voter
  guide, Ballotpedia, CalMatters and a news search, plus any articles a slate
  attaches to it (news and analysis that anyone can sign and link to a race,
  shown as reading, never counted as endorsements; news coverage from the
  public catalog comes along on its own). *Print* makes a paper copy of your
  ballot, endorsement counts beside the bubbles and ranks in a ranked-choice
  contest's bubbles, shrunk to fit one page. Sources imported from the public
  catalog stay current: when the catalog has a newer version, it replaces
  yours. Work through it like an inbox: filter races by
  To do, Maybe, Picked or Against all, watch the "decided" count climb, and
  reach *ballot zero*. The search box at the top finds races by seat or
  measure, candidate, party, place, or a source that took a position on it
  ("sierra prop" lists the propositions Sierra Club weighed in on). Every
  page with a long list has one: Sources, the public catalog, Results and each
  slate's results, your picks and the elections under Publish, and the
  setup's organizations. Every word has to match, case and
  accents don't matter, and a number only matches a whole number ("prop 1"
  isn't Prop 10). *One at a time* shows a single race and
  moves on once it's decided: number keys pick a choice, Shift+number rules it out, arrow
  keys step back and forth. *Quick fill* marks many races at once: pick (or rule
  out) every candidate of a party, or agree with, or go against, everything
  one source recommends, followed or not. It only fills what you haven't
  marked and can be undone. A race's own page compares every source's
  position and, where the catalog lists the election's official **voter
  guide** (the state's, or a county's for Congress, the Legislature and local
  races), shows it too: what the office does or what the measure would do,
  each candidate's photo and statement in their own words, what a Yes and a No
  vote mean, the arguments and rebuttals with who signed them (and, where a
  county prints them, paid arguments with who paid), the official summary and
  analysis, and the full text. That material is reference, not
  endorsement: it's never counted as anyone backing anything. *Sources* is
  where you follow sources, follow them to *disagree* (their picks count the
  other way on My ballot: what they back counts against it, what they oppose
  counts for it; in a Yes/No measure or a two-name race you can have it count
  for the other side instead, under Settings → *My ballot*), or leave them
  imported just for comparison; browse the
  public catalog; and add slates from a link, file, QR code or paste. Each
  endorser shows its logo
  (from the catalog, else a monogram) and where it sits *left to right*: the
  share of its picks on the Democratic or the Republican side, counted only
  where the two parties split (races between a Democrat and a Republican, and
  races and measures the parties' endorsements disagree on). It's arithmetic
  on picks (`leanOf` in `@openslate/core`), not a rating; tap any meter for
  the counts. Where an official candidate list is imported, every source's
  choices are matched to it, so "Don Wagner" and the ballot's "Donald P. (Don)
  Wagner" are one candidate (by the list's `choice_id`, or by name: nicknames,
  middle initials). A name the list doesn't have is marked *Not on the
  ballot* (with the listed name it most resembles), and *Report it* sends a
  prefilled "wrong information" report; each imported catalog entry says how
  many of its names didn't match. Any candidate race takes a *write-in*: a
  name not printed on the ballot, signed as one, and flagged when the list
  doesn't certify it.
- **Publish** (a quiet *Publish* link in the header, the footer and Settings):
  create a signing identity (Compose walks you through your first one and its
  backup), sign your My-ballot picks (plus any other race or issue, on your
  ballot or not) as a slate, see the slates you've signed, and verify or
  inspect any block.

A first visit goes straight into setup, right on My ballot, with nothing to
choose first: *Where do you vote?* (the next election is picked already), then
*Whose endorsements do you trust?*, then your ballot. A folded *What is
OpenSlate?* says what it is: alpha software written by AI with a human
watching over it, no account, open source, and how to run your own copy
instead of using the website (linking here). Run setup again later from
*Add endorsements* on the Sources page. An *Alpha* badge beside the name
opens the same warning at the top of the page. On the public site
(openslate.us) that warning starts open, on every page, until you dismiss it;
a copy you run yourself keeps it to the badge.

**Browser agents (WebMCP).** In a browser that supports
[WebMCP](https://webmachinelearning.github.io/webmcp/), an AI agent working
for you in that browser can use My ballot through tools the page offers:
`list_elections`, `get_ballot` (a page of races at a time, searchable, with
your marks and your followed sources' counts), `get_race` (every source's
position, its own label for it, and statement), `mark_choices` (pick, maybe, against, clear, or
write in, applied together or not at all, and never toggling, so a retried
call can't undo itself), `rank_choices` (a candidate race's whole ranking:
the first as many as the ballot takes are picked, the rest backups) and
`set_race_note`. In a candidate race a pick joins your ranking as the bubble
does. The tools run in the page, on this browser's
own data, and write through the same store as the buttons, so an open My
ballot updates as the agent works. Nothing is sent anywhere, and the agent
can't publish or sign. Slates' text is marked untrusted, since anyone can
publish one. If you've turned on anonymous usage statistics, a tool call
counts as which tool and whether it worked, never what it read or marked.
Chrome and Edge offer WebMCP to real visitors only on sites in their
origin trials ([Chrome's](https://developer.chrome.com/blog/ai-webmcp-origin-trial),
Chrome 149 on), with a token for that exact origin; openslate.us sends both. A copy you host
yourself needs its own token, or use `chrome://flags/#enable-webmcp-testing`
locally. See `apps/web/src/lib/webmcp.ts`.

Setup works from the catalog's list alone: each entry says where its races
are, so the area and source steps are there at once, and only the lists you
pick are downloaded at the end (with the official ballot lists). That download
carries on in the background: the ballot opens straight away, and a banner with
a progress bar says your ballot is still filling in until it's done. Close the
tab (or reload it) part way and the next visit finishes the download, picks
and all. Tick
*Download all* to fetch every organization's list instead, in one request, so
the server can't tell whose recommendations you use; the ones you didn't pick
are kept unfollowed, for comparison. With an older catalog that doesn't list
races, setup reads every slate first, with a progress bar.

The goal: give citizens deeper insight into the things they care about, without
relying solely on simplified endorsements from a single newspaper or org.

## How to Run

OpenSlate is decentralized-first: signing and verifying always happen on your
machine, never on a server. The choice below is mostly about what fetches
*public* data (ballots, polls, results) on your behalf.

### Cloud

The easy path: open the hosted web app at **<https://openslate.us>**. Your
signing keys and slates live only in your browser; nothing is uploaded. Polls
and election results are fetched through project-operated Cloudflare Workers.
*Where you vote* fills itself in: pick your home on a map of California, or
use your device's location (both matched on your device, against district
boundaries shipped with the app), or type your address and pick who looks it
up: the US Census Bureau (through the project's relay, which keeps nothing),
OpenStreetMap (straight from your browser), or Google's Civic Information API.
Google answers with the contests on that address's ballot, two ways: with your
own Google API key (Settings → *Your Google API key*), straight from your
browser, so the address and the key go only to Google; or through the
project's relay, which asks Google with the project's key and keeps nothing.
Each address service asks before its first use and can be switched off in
Settings. The Elections page lists Google's elections the same way. The map lays the
districts over a street (or satellite) map from the US Geological Survey;
loading map images shows USGS roughly where you're looking, so the map says
so and can switch the background off. A district with no race
this election (e.g. an odd-numbered State Senate seat in 2026) says so on My
ballot. The lookups also find your school, community college, Board of
Equalization and county supervisorial districts, and your city council
district in the 80-odd cities that elect by district and publish a current
map, so a county's school board, college board and supervisor races, and a
city's council races, show only where you vote on them; races
only part of a county votes on that the app can't place (a water district, a
school board's trustee area) are listed apart, as *Might be on your ballot*.
Each asks *On my ballot* or *Not on my ballot*; saying yes to one city council
district (or trustee area) also takes that family's other districts off,
and the answers stay with your area (*Undo*, *Not sure after all* and *Show
them again* take them back).
A race or measure a voter guide covers links its official text, arguments or
candidate statements from its card on My ballot.
A regional measure (the Bay Area's transit measure, RTM) shows in each county
that votes on it, as its slates list them.
The lookup remembers which city and county it found, so if races for your
city start appearing after you set your area, they join it; a city that
shares its county's name (Orange, San Diego) gets the city's races only
inside the city. Marks on a race the catalog re-files (San Diego County's
moved off the City of San Diego's path on Oct 25, 2026) move with it.
Or skip all that and choose your city and district numbers from lists
yourself. The app is light or dark to match your device; Settings →
Appearance picks one for this browser instead.

### Your Own Servers

Two pieces you can run yourself: the **static web app** (`apps/web`) and one
or more **optional backends** for ballot lookup, polls, and results. See
[Hosting topologies](#hosting-topologies) below for the architectural view.

#### Cloud (Cloudflare)

```sh
bun install
bun run build                                      # → apps/web/dist
bun run --filter '@openslate/poll-cache' deploy    # → Cloudflare Workers
```

Deploy `apps/web/dist` to Cloudflare Pages (or any static host: GitHub Pages,
Netlify, Vercel, plain S3). Build the SPA pointed at your own Worker:

```sh
VITE_API_BASE=https://api.yourdomain.dev \
VITE_RESULTS_BASE=https://api.yourdomain.dev/api/results/v2 \
bun run build
```

#### Bare

Run it all locally — your laptop, a VM, a Raspberry Pi, anything with
[Bun](https://bun.sh):

```sh
bun install
bun run dev:web      # Vite SPA       — http://localhost:5173
bun run dev:server   # Hono backend   — http://localhost:8787 (optional)
```

The backend also relays the Census address lookup (`POST /api/geocode/census`)
and, with a Google key, Google's Civic Information API (`GET
/api/civic/elections`, `POST /api/civic/voterinfo`): the same routes as the
public Worker. To turn on Google through your server, copy `.env.example` →
`.env` and set `GOOGLE_API_KEY`. (Anyone can also use their own key straight
from the browser, with no server: Settings → *Your Google API key*.) Vite proxies `/api` → `localhost:8787` so the SPA finds the
backend automatically.

**Kalshi market forecasts are an opt-in for your own server.** Start it with
`KALSHI_FORECASTS=true` (in `.env`, or the environment) and it relays Kalshi's
public market data at `/api/forecasts/v2/*` and says `forecasts: true` in
`/api/health`; the app then shows a Forecast card on race pages. Without it,
and on the public app, there is no Kalshi anywhere: Kalshi only accepts
browser requests from kalshi.com, refuses Cloudflare Workers, and its terms
may not allow a public relay or mirror. Check
[Kalshi's terms](https://kalshi.com/legal) before turning it on for anyone but
yourself. See [plans/kalshi-forecasts-429.md](./plans/kalshi-forecasts-429.md).

The district boundaries (`apps/web/public/geo/us-ca.topo.json`, ~1.4 MB
gzipped, fetched only when someone opens the finder) are built by
`bun run --filter '@openslate/web' geo` from Census TIGERweb, and for what
Census doesn't map (Board of Equalization, community college, supervisorial
and city council districts) from the state's, the community colleges', each
county's (or its registrar's) and each city's GIS (`OTHER_SOURCES` in
`apps/web/scripts/build-geo.ts`; how each council map was checked is in
[plans/council-districts-lookup.md](./plans/council-districts-lookup.md));
rerun it after redistricting.

To serve the public catalog from your own copy too (for a site that works
offline, or doesn't depend on GitHub Pages), take a snapshot and point the
build at it, relative to the page:

```sh
VITE_PUBLIC_ENDORSEMENTS_CATALOG=catalog/index.json bun run build
bun run --filter '@openslate/web' snapshot --out "$PWD/apps/web/dist/catalog"
```

The snapshot (`apps/web/scripts/snapshot-catalog.ts`) holds every slate,
logo and voter guide the catalog lists, each verified as it's downloaded.
Take it after building: a build empties `dist`.

The same install gets you the CLI, for scripting or headless workflows:

```sh
# generate a keypair (keep me.identity.json secret)
bun run --filter '@openslate/cli' start -- keygen --name "Me" -o me.identity.json

# sign a set of positions
bun run --filter '@openslate/cli' start -- sign positions.json --key me.identity.json

# verify a block someone shared
bun run --filter '@openslate/cli' start -- verify "<paste block>"

# take on another slate's positions: copy them, or adopt them by reference
# (a live link, or with an embedded snapshot); see SPEC §3.10
bun run --filter '@openslate/cli' start -- adopt https://example.org/party.slate \
  --mode reference --match "Governor,Proposition" --into positions.json
```

Other useful scripts: `bun test`, `bun run typecheck`, `bun run schema`
(emits `packages/core/schema/openslate.schema.json`), `bun run lint` (Biome:
format, imports and lint; line endings follow the OS, so CRLF checkouts on
Windows pass) and `bun run format`, which fixes what lint can.

### Desktop

Download the app for Windows, macOS (Apple Silicon) or Linux from
[Releases](https://github.com/cinderblock/openslate/releases). It's the web
app in a native window ([Electrobun](https://blackboard.sh/electrobun), on
the system's own webview), in two editions:

- **OpenSlate** reads the public catalog live, like openslate.us.
- **OpenSlate Offline** carries a copy of the catalog: every organization's
  endorsements and the official voter guides, checked when the release was
  built. Ballot planning works with no internet at all; polls, forecasts,
  results and address lookups still need a connection.

The builds aren't code-signed yet; the release notes say how to get past
SmartScreen and Gatekeeper. The app updates itself, and installs an update
only once it has checked it's signed by OpenSlate's release key
([how](./apps/desktop/README.md#updates)). Build it yourself from
[`apps/desktop`](./apps/desktop) (each platform builds on its own; CI builds
all three, [`.github/workflows/desktop.yml`](./.github/workflows/desktop.yml)):

```sh
bun install
bun run --filter '@openslate/desktop' build                    # → apps/desktop/artifacts/
bun run --filter '@openslate/desktop' build --flavor offline   # with the catalog built in
bun run --filter '@openslate/desktop' dev                      # build and launch
```

## How it works

A **slate** is a [JWS-compact](https://www.rfc-editor.org/rfc/rfc7515) token:

```
base64url(header) . base64url(payload) . base64url(signature)
```

- The **payload** is canonical JSON ([RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785))
  listing your positions (`endorse`, `oppose`, `lean_for`, `lean_against`,
  `neutral`, `abstain`) with optional free-text statements.
- The **signature** is Ed25519 (EdDSA / [RFC 8037](https://www.rfc-editor.org/rfc/rfc8037)).
- Your **public key is your identity** (`ed25519:<base58>`); real-world trust is a
  separate, optional layer (e.g. domain attestation via `/.well-known/openslate.json`).
- Stored as a `.slate` file or transmitted with media type `application/openslate+jws`.

See **[SPEC.md](./SPEC.md)** for the normative format, **[`vectors/`](./vectors/)**
for cross-language conformance test vectors, and
**[`docs/PORTING.md`](./docs/PORTING.md)** to reimplement the format in another
language. The standard is decentralized-first: a block is self-contained and
verifiable without any server.

A **voter guide** carries an election authority's official material (candidate
statements and photos, a measure's summary, analysis, arguments and full text)
rather than positions, so it isn't a slate. It is one signed manifest
(`typ: openslate-guide+jws`, the same canonical JSON and Ed25519) listing every
published file with its SHA-256; clients fetch only the files a page needs and
check each one. `openslate guide check|sign|verify` builds and checks one. The
format lives in [`packages/core/src/guide.ts`](./packages/core/src/guide.ts) and
isn't part of SPEC.md yet. California's Nov 3, 2026 guides (the state's, and
San Francisco's pamphlet) are in
[openslate-ballot-ca-2026-11-03](https://github.com/cinderblock/openslate-ballot-ca-2026-11-03),
one repo per state and election with one manifest per publisher. A county
pamphlet is one large PDF, so its full texts are linked by page (with the
PDF's SHA-256) rather than mirrored. The catalog's `guides.json` lists each
guide's URL, key, and the jurisdictions it `covers`, so a race page finds a
county's statements for a congressional district.

## Repository layout

This is a [Bun](https://bun.sh) workspaces monorepo. Everything shares one core
library, so blocks are intercompatible across web, desktop, server, and CLI.

| Package | What it is |
| --- | --- |
| [`packages/core`](./packages/core) | `@openslate/core` — the standard's reference impl: types, schema, canonical JSON, Ed25519 sign/verify, JSON Schema export. Pure TS, minimal audited deps. |
| [`packages/cli`](./packages/cli) | `@openslate/cli` — `keygen` / `pubkey` / `sign` (incl. `--batch` for research bundles) / `validate` / `verify` / `inspect` / `adopt` (copy or reference another slate's positions). |
| [`apps/web`](./apps/web) | React + Vite SPA, voter-first. *My vote*: setup inline on My ballot, My ballot (your followed sources' endorsements by race, for your election and area, with private picks), and Sources (follow, disagree with, or leave off, the [public catalog](https://cinderblock.github.io/openslate-public-endorsements/), import from link/file/QR/paste). *Publish* (a quiet link): identities, sign your picks (or any race) as a slate and share it, verify and inspect slates; view live polls and election results (and Kalshi market forecasts, when a self-hosted server opts in); pick per-provider direct-vs-proxy routing. Data lives in **browser storage only**. |
| [`apps/server`](./apps/server) | Minimal **stateless** Hono backend. No user data. Verify helper + relays for ballot data ([VIP](https://www.votinginfoproject.org/) via Google Civic, with your `GOOGLE_API_KEY`), opinion polls ([VoteHub](https://votehub.com)), election results ([civicAPI](https://civicapi.org)), and, opt-in with `KALSHI_FORECASTS=true`, market forecasts ([Kalshi](https://kalshi.com)). |
| [`apps/poll-cache`](./apps/poll-cache) | `@openslate/poll-cache` — Cloudflare Worker that caches [VoteHub](https://votehub.com) polls and [civicAPI](https://civicapi.org) results behind permissive CORS, relays opt-in address lookups to the [Census geocoder](https://geocoding.geo.census.gov/) (`POST /api/geocode/census`; nothing cached, logged or stored), and answers Google Civic Information lookups with the project's key (`GET /api/civic/elections`, `POST /api/civic/voterinfo`; only for openslate.us pages, addresses never cached, logged or stored). Mirrors the Hono server's `/api/polls/*`, `/api/results/v2/*`, `/api/geocode/census` and `/api/civic/*` shapes so the web client treats either backend identically. Runs at `https://api.openslate.us`. |
| [`apps/desktop`](./apps/desktop) | [Electrobun](https://blackboard.sh/electrobun) desktop app around the web build, for Windows, macOS and Linux; standard and offline (catalog built in) editions, built and self-tested in CI, with signed self-updates. |

## Hosting topologies

OpenSlate is **decentralized-first**: a slate is fully verifiable offline, and
the web/desktop app works against browser storage alone. The optional Hono
server and Cloudflare Worker exist only to fetch *public* data on the user's
behalf (ballot contests, polls, election results); neither stores
user data, identity, or positions. Signing and verification always happen in
the browser.

Election results (civicAPI) already serve permissive CORS without an API key,
so the SPA hits civicAPI directly by default. Polls (VoteHub) restrict
cross-origin access, so the SPA *must* go through a proxy for those. So do
Kalshi's forecasts, which only a self-hosted server relays, and only when
its operator opts in. The Settings page lets each user pick direct-vs-proxy per provider
where both are possible. The Hono/Worker mirrors also help self-hosters who
want a uniform fetch surface or edge caching on election night.

The web app's **Sources** page (and setup) additionally imports pre-signed slates from a
sibling repo, [openslate-public-endorsements][ope] — published as static files
on GitHub Pages, fetched directly with no server in between. Its catalog also
carries each org's logo and left-right counts, so the app never contacts the
orgs' own sites, and where each slate's races are (`scope`, `jurisdictions`, and
`regions`: where the contests filed under a region like `us/ca/bay-area` are voted,
so setup lists a regional paper with its readers' local sources; all written by
`openslate sign --batch`), plus a `bundle` of every slate in one file.

[ope]: https://github.com/cinderblock/openslate-public-endorsements

```mermaid
flowchart LR
  classDef ext fill:#fff7d6,stroke:#7a5500,color:#000
  classDef opt stroke-dasharray:5 5

  Peer["Another OpenSlate user"]

  subgraph Browser["Your browser / desktop"]
    Client["Web SPA / Electrobun<br/>identity · sign · verify<br/>my ballot · sources · share<br/><i>IndexedDB + localStorage</i>"]
  end

  subgraph SelfHost["Optional — self-hosted"]
    Hono["Hono server<br/>apps/server<br/><i>stateless, no user data</i>"]
  end

  subgraph ProjectInfra["Optional — project-operated (api.openslate.us)"]
    Worker["CF Worker poll-cache<br/>apps/poll-cache<br/><i>15min edge cache</i>"]
  end

  GCI[("Google Civic Info<br/>VIP ballot data")]:::ext
  CEN[("US Census geocoder<br/>address → districts")]:::ext
  OSM[("OpenStreetMap Nominatim<br/>address → point")]:::ext
  USGS[("USGS The National Map<br/>street/satellite tiles")]:::ext
  VH[("VoteHub<br/>opinion polls<br/>CC BY 4.0")]:::ext
  CA[("civicAPI<br/>election results")]:::ext
  KS[("Kalshi<br/>market forecasts<br/>(opt-in)")]:::ext
  OPE[("openslate-public-endorsements<br/>signed catalog (GH Pages)")]:::ext
  VG[("openslate-ballot-* repos<br/>signed voter guides (GH Pages)")]:::ext

  Client -.->|"/api/civic/*, opt-in"| Hono
  Client -.->|"/api/civic/*, opt-in"| Worker
  Client -.->|"your own key, opt-in"| GCI
  Client -.->|"/api/polls/*"| Hono
  Client -.->|"/api/polls/*"| Worker
  Client -.->|"/api/results/v2/*"| Hono
  Client -.->|"/api/results/v2/*"| Worker
  Client -.->|"/api/forecasts/v2/*, opt-in"| Hono
  Client -->|"direct (default)"| CA
  Client -->|"index.json · signed.slate · guides.json"| OPE
  Client -->|"guide.jws · items · photos · PDFs"| VG
  Client -.->|"address, opt-in"| OSM
  Client -.->|"map tiles, on by default"| USGS
  Client -.->|"POST /api/geocode/census, opt-in"| Worker
  Client -.->|"POST /api/geocode/census, opt-in"| Hono

  Hono -->|"address (forwarded, not stored)"| GCI
  Worker -->|"address (forwarded, not stored)"| GCI
  Hono -->|"address (forwarded, not stored)"| CEN
  Hono -->|"subject filter"| VH
  Hono -->|"race id / search"| CA
  Hono -.->|"market lookup, KALSHI_FORECASTS=true"| KS
  Worker -->|"upstream fetch"| VH
  Worker -->|"upstream fetch"| CA
  Worker -->|"address (forwarded, not stored)"| CEN

  Client <-.->|"text block · URL · email · QR · file"| Peer

  class Hono opt
  class Worker opt
```

| Mode | What runs | Sign & verify | Catalog | Polls | Forecasts | Ballot lookup | Results |
| --- | --- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Pure client** (default) | Web SPA or desktop only | yes | yes (GH Pages) | — | — | map, location, OpenStreetMap; Google with your own key | yes (civicAPI direct) |
| **+ Self-hosted Hono** | Above + your own `apps/server` | yes | yes | yes (VoteHub) | opt-in (Kalshi, `KALSHI_FORECASTS=true`) | + Census; + Google with `GOOGLE_API_KEY` | yes (cached) |
| **+ Public Worker** (what `openslate.us` uses) | Above + project-operated Worker | yes | yes | yes (cached) | — | + Census; + Google once the Worker has its key | yes (cached) |

Modes are not mutually exclusive: run your own Hono for ballot lookup **and**
point `VITE_API_BASE` at the public Worker for cached polls. The web client
hits `/api/polls/*` on whichever backend the env var resolves to; the response
shape is identical either way. `VITE_RESULTS_BASE` works the same way for
civicAPI results (reached directly by default, but configurable). Kalshi
forecasts come from the same backend as `VITE_API_BASE`, when it says
`forecasts: true` in `/api/health`.

The public Worker has no Kalshi forecasts. Kalshi answers `429` to every
request from Cloudflare Workers (seen October 2026; it refuses Workers'
shared egress, whatever the request says), and a public relay or mirror of
its prices may not be something its terms allow. A self-hosted server can
opt in (see [Bare](#bare)); it doesn't cache Kalshi's errors, and serves its
last good answer, marked stale, when Kalshi refuses.

## Deployment

The hosted app is two Cloudflare Workers, each built and deployed by
**Cloudflare Workers Builds** on every push to `master`:

| Worker | Serves | Config |
| --- | --- | --- |
| `openslate-web` | `https://openslate.us`, the web build as static assets | [`apps/web/wrangler.jsonc`](./apps/web/wrangler.jsonc), build settings in [`apps/web/.env.production`](./apps/web/.env.production) |
| `openslate-poll-cache` | `https://api.openslate.us` | [`apps/poll-cache/wrangler.toml`](./apps/poll-cache/wrangler.toml) |

The workers themselves, their custom domains, the `www` redirect, Web
Analytics and the zone settings are managed in
[cinderblock/ops](https://github.com/cinderblock/ops)
(`cloudflare/config/projects/openslate.yaml`). Nothing in this repo holds a
Cloudflare credential.

`apps/web/.env.production` is committed on purpose: everything in it ships in
the public bundle anyway. Usage statistics and private feedback go to the
telemetry-collector at `VITE_TELEMETRY_ENDPOINT`, using its public ingest key.
That key isn't committed: [`apps/web/vite.config.ts`](./apps/web/vite.config.ts)
derives it at build time from the `TELEMETRY_COLLECTOR_APP_SECRET` build
variable (app `openslate`, channel `web`) and fails the build if the secret
itself ever lands in the output. A build without the secret, such as a local
build or a fork's, reports nowhere: no usage statistics, and the feedback
dialog offers GitHub issues only. A self-hosted copy can set
`VITE_TELEMETRY_KEY` in an `.env` file instead. The hosted app's address lookups are the Census
relay on `api.openslate.us`, OpenStreetMap, Google with the visitor's own
key, and Google through `api.openslate.us`. That last one needs the Worker
secret `GOOGLE_CIVIC_API_KEY` (a Google Cloud API key restricted to the Civic
Information API), set by hand with `wrangler secret put`; without it, the
relay answers 501 and the app doesn't offer it. Its CORS answers only the
origins in `CIVIC_ALLOWED_ORIGINS`
([`apps/poll-cache/wrangler.toml`](./apps/poll-cache/wrangler.toml)) and
localhost, and Cloudflare rate-limits `/api/civic/*` per IP at the edge
(10 requests per 10 s, set in the ops repo).

Workers Builds settings, one connection per worker, both on this repo with
production branch `master` and non-production branch builds off:

| Setting | `openslate-web` | `openslate-poll-cache` |
| --- | --- | --- |
| Root directory | `apps/web` | `apps/poll-cache` |
| Build command | `bun install --frozen-lockfile && bun run build` | `bun install --frozen-lockfile` |
| Deploy command | `bunx wrangler deploy` | `bunx wrangler deploy` |
| Build watch paths | `apps/web/*`, `packages/core/*`, `bun.lock` | `apps/poll-cache/*`, `bun.lock` |
| Build variables | `SKIP_DEPENDENCY_INSTALL=1`, `BUN_VERSION=1.4.2`, `TELEMETRY_COLLECTOR_APP_SECRET` (secret) | `SKIP_DEPENDENCY_INSTALL=1`, `BUN_VERSION=1.4.2` |

`SKIP_DEPENDENCY_INSTALL` stops the build image running its own install with a
different package manager; `BUN_VERSION` should match the Bun that wrote
`bun.lock` (the image's default Bun is older).

## Design principles

1. **Decentralized-first.** A slate is fully verifiable offline. Servers are
   optional discovery/convenience, never required for trust.
2. **No server-side user data.** Your identity and imported slates live in your
   browser (localStorage) or files you control. The backend stores nothing.
   **Usage statistics are opt-in.** A switch in Settings and in the footer
   (off until you turn it on) shares anonymous counts: which screen was opened
   and which features were used, never a candidate, race, measure,
   organization, slate or location, and no identifier for you. Every event is
   checked against a closed allowlist at runtime as well as by the types, and
   the hosted app's Content-Security-Policy
   ([`apps/web/public/_headers`](./apps/web/public/_headers)) only runs our own
   scripts, so no third-party analytics can load. The exact list is in
   Settings → Usage statistics; the rules are in
   [`apps/web/src/lib/usage.ts`](./apps/web/src/lib/usage.ts). Counts go in
   small batches to the developer's own telemetry-collector, and switching the
   setting off drops anything not yet sent
   ([`apps/web/src/lib/telemetry.ts`](./apps/web/src/lib/telemetry.ts)).
   **Feedback goes only where you send it.** "Send feedback" in the footer
   either opens a prefilled public GitHub issue (from the forms in
   [`.github/ISSUE_TEMPLATE/`](./.github/ISSUE_TEMPLATE/)) or sends a private
   report to the developer's telemetry-collector. A private report carries
   what you typed, the screen's route template (never the slate in the URL),
   the build, and, only if you ask for one and after you've seen it, a
   screenshot. See [`apps/web/src/lib/feedback.ts`](./apps/web/src/lib/feedback.ts).
3. **One source of truth.** Signing and the schema live only in `@openslate/core`.
4. **Reimplementable.** The format is plain JSON + Ed25519 + JCS — easy to build
   in any language. The published JSON Schema helps.
5. **Our own form controls.** The web app doesn't use bare native `<input>`,
   `<select>` or `<textarea>`. Switches, checkboxes and radios show the chosen
   option plainly; dropdowns can carry descriptions, badges and search; text
   fields can format what's typed. Use (or extend) the kit in
   [`apps/web/src/components/ui/`](./apps/web/src/components/ui/), built on
   [React Aria Components](https://react-spectrum.adobe.com/react-aria/) so
   keyboard and screen-reader behaviour stays right.

## License and disclaimer

[MIT](./LICENSE).

OpenSlate gathers public voter information and endorsements, plus any shared
with you privately, into one format filtered to where you vote. Endorsements are
their authors' views: OpenSlate endorses no one, being in the public catalog
isn't an endorsement, and showing a name or logo doesn't mean its owner endorses
OpenSlate. The app and its data are provided as is, without warranty; its
authors and whoever runs a copy aren't liable for errors or how it's used. It
isn't legal advice or an official election resource; your official voter guide
has the final word. The web app says the same in its footer, and printed picks
say they aren't an official ballot.
