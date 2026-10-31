# Provable raw-source capture for endorsement scraping

`plans/signed-source-capture.md`

## Goal

User request (2026-10-30): when scraping endorsement data, save the raw thing
the server served, plus enough proof that anyone can later show it came from
the group we summarised, even if that group's site goes offline. Smallest
verifiable unit: "here is the raw text we took in, it gets you to the same
slate we computed, and here is proof it came from them." Objectivity is the top
requirement.

This began as an exploration. The user then approved everything, so it's now built:
see "What was built" below. The research sections are kept as the reasoning behind it.

Status: **built, merged and live, 2026-10-30.** Captures run in
[`cinderblock/openslate-source-captures`](https://github.com/cinderblock/openslate-source-captures),
evidence pages show them, and 399 of 401 published slates sign their capture run. Desktop 0.2.0 is
public, published 2026-10-30 5:39 PM PDT (00:39Z). The user settled this thread that evening, and
what's left under "Next steps" is deferred.

## Decisions already made (don't re-ask)

On 2026-10-30, about 9:50 AM PDT (16:50Z), the user answered the open questions
with "Do it all. Boil the ocean." Read as: every recommendation in Q1 to Q8 is
accepted, and all 12 next steps are in scope, including the ones the plan deferred.

- The brief's limits still hold unless the user lifts them: no push to `master` of
  OpenSlate or the sibling repos (feature branches and PRs instead), no posts on
  other people's projects, no Cloudflare or DNS, never force-push.
- New repos, both the user's own: `cinderblock/openslate-source-captures` (public:
  tool, URL list, manifests, proofs, non-withheld bytes) and
  `cinderblock/openslate-source-captures-private` (withheld bytes).
- Publication rule (Q8), mechanical and public: a URL is withheld if its host is
  cited by a `news_organization` or `editorial_board` bundle. Hashes and proofs are
  public for everything.
- CI captures first, because a home-machine capture could put the user's IP in a
  public blob (block pages often print the visitor's address). Local capture is for
  hosts that refuse CI, and any response containing that IP stays private.
- Needs an account I don't have, so it stops at the boundary: a second CI witness on
  GitLab (Q6). Save Page Now accepts anonymous requests, but rate-limits GitHub's
  addresses after a few, so a key is what would make it useful from CI.

On 2026-10-30, about 2:00 PM PDT (21:00Z), the user asked why the PRs weren't merged and
why slates shouldn't carry the field now, deferred GitLab, and said to set up archive.org
soon. Read as:

- Both PRs merge, and the field goes in now rather than after Nov 3. The earlier reason
  was the reissue, which is weak: the 10-30 re-scrape reissued 362 slates anyway.
- The second CI witness on GitLab is deferred. Don't raise it again unprompted.
- The archive.org key comes from the user soon. Nothing is built for it yet.

## What was built

| Piece | Where | State |
| --- | --- | --- |
| Capture, seal, publish | `openslate-source-captures` `src/` | Live |
| Scheduled workflow | `.github/workflows/capture.yml` | Daily through Nov 5, then weekly |
| Verifier CLI | `src/verify.ts` | Our WebCrypto core and the reference Sigstore library must agree |
| Browser verifier | [cinderblock.github.io/openslate-source-captures](https://cinderblock.github.io/openslate-source-captures/) | Live; verified a real run in Chrome, from the live repo and from `file://` offline |
| Withheld store | `openslate-source-captures-private` | Live; deploy key only the publish job can read |
| Provenance per slate | `provenance/<org>/<election>.json` | Rebuilt by each run |
| Internet Archive | `src/archive.ts`, `archive.yml` | Hourly through Nov 5, with a key. See `plans/archive-org-snapshots.md` |
| XHR discovery | `src/discover.ts`, `discovery-report.md` | Run on all 18 low-text hosts |
| Browser capture | `src/render.ts`, `render-hosts.json` | Beside the GET, for listed hosts and any page a GET got almost no text from |
| Statement check, evidence page | endorsements [#1](https://github.com/cinderblock/openslate-public-endorsements/pull/1), `02b7aab` | Live |
| `attribution.capture`, SPEC, skill | OpenSlate [#2](https://github.com/cinderblock/OpenSlate/pull/2), `f41bf95` | Live; the app accepts the field |
| Slates point at their run | endorsements [#2](https://github.com/cinderblock/openslate-public-endorsements/pull/2), `03f9228`: `scripts/pin-capture.ts`, `pin-capture.yml` | Live; 399 of 401 slates pinned, the other 2 wait for a capture |

Changes from the design below, made while building:

- **Provenance lives in the capture repo**, not in each `evidence/` folder, so a sweep
  that changes no position doesn't republish a slate.
- **The URL list is generated inside the capture job** from the public endorsements
  commit, and stored in the run by hash. Committing it first would make the attested
  commit differ from the one that ran.
- **A browser capture can carry the CI witness.** Q5 ruled out witness labels for
  browser-like captures to stop spoofing. Headless Chrome here uses the same honest
  user agent and runs the same public code, so the witness statement stays true. The
  record is marked `headless-chrome` and the evidence page says it's a browser's view.
- **Which pages get a browser is a rule, not a list.** The first list was hand-kept and
  missed the Chronicle. Now any 200 HTML response with under 500 readable characters
  also gets a browser load, and the record says what triggered it. `render-hosts.json`
  stays for hosts that fail outright. That threshold catches 31 of 643 HTML pages.
- **A slate's pointer is sticky.** It's signed content, so moving it reissues the slate.
  A slate takes the newest witnessed run holding every source it cites, and keeps it
  until that run no longer holds them all. Moving it with each run would make every
  voter's app download every slate daily. `provenance` is a URL at a fixed commit, so
  the record the signature names can't change underneath it.
- **The field is added to `positions.json` as text, not by reformatting.** 39 of 401
  bundles aren't laid out as `JSON.stringify` would, so `pin-capture.ts` edits the text
  and checks that nothing else moved.
- **Publication uses a host list as well as the kind rule.** Many papers are filed as
  plain `organization`, so `withheld-hosts.json` adds nine news hosts, plus Facebook
  and Instagram for personal-data risk.

## The short version

**A saved HTTPS session cannot prove what a server sent.** That part of the idea
doesn't work, and the spike shows why rather than just saying so. The instinct
behind it is half right: the TLS handshake really is signed by the domain's
certificate key, and no one can fake that. But the signature stops at the
handshake. The page itself is protected by a key both ends know, so whoever
captured it can rewrite it. `01-forge-saved-handshake.ts` does exactly that: it
replaces a real response with a fake one, keeps the real server signature, and
passes the strictest verifier a saved handshake allows. It's a property of TLS,
not a flaw in the plan: the designers made it deniable on purpose.

**What works is a layered record of who saw what.** Recommended:

1. Capture each response verbatim, and record every failure too.
2. Timestamp the run with two independent authorities. Proves when, and stops
   anyone, including us, from editing a capture afterwards.
3. Capture inside a public GitHub Actions run with a Sigstore attestation. This
   needs no keys and no new servers, and it makes GitHub and a public log the
   witness that this reviewed code fetched these bytes. That's the rung that
   stops us forging a capture, unless GitHub or Sigstore lies.
4. Point at the Internet Archive as an independent copy.
5. Prefer the origin's own signature whenever one exists. Today none does: 0 of
   203 hosts.

Each source then carries the exact set of claims it can back up, and the app
says only that. Skip TLSNotary and zkTLS for now: for public pages they buy the
same trust as a CI witness, at much more cost, in alpha.

The extraction half matters as much as the proof half. On the one source
tested, a pure extractor run offline on a raw capture reproduced the published
Santa Clara evidence **byte for byte**. Most slates can't be rebuilt that way,
because a person or model read them, so for those a mechanical check that each
position's statement is really in the raw text does the job: on a slate whose
source page has since vanished, **25 of 25 statements anchored** to the Internet
Archive's raw copy.

**The one hard limit:** no rung proves a *domain* is the *organization*. A
certificate says "this is sfgop.org". That sfgop.org speaks for the party is our
claim (`attribution.of.uri`), and 11% of positions cite a host other than the
org's own. The design has to show that gap, not hide it.

## Environment / context

- Worktree: `explore-signed-source-capture`, branch
  `explore/signed-source-capture`, from `origin/master`. Windows 11, Bun 1.4.2,
  `core.autocrlf=true`.
- Spikes: `experiments/signed-source-capture/`, not a workspace member. See its
  `README.md`. `tsc` clean, Biome clean. Results and example bundles are under
  `results/`.
- Sibling repos, read only: `openslate-public-endorsements` (391 attributed
  bundles at survey time, about 14,600 positions, 766 cited URLs on 203 hosts,
  `orgs/` is 27 MB), `openslate-ballot-ca-2026-11-03` (`evidence/` 15 MB,
  uncommitted `.cache/` 1.5 GB, largest file 78 MB).
- Pipeline today: scrapers write `orgs/<slug>/<election>/positions.json` plus
  `evidence/`. CI signs slates with an ed25519 key from GitHub secrets. Slates
  carry `attribution` (`mode`, `retrieved_at`, `sources`), whose Zod schema in
  `packages/core/src/schema.ts` is `.strict()`, so an unknown field is rejected.
- Both repos are public, which a Sigstore CI witness requires.

## Threat model

Who is convincing whom: OpenSlate (or anyone re-running it) is convincing a
voter, journalist or the organization itself that "this slate fairly reports
what X published around time T".

| Adversary | What they try | What stops it | What doesn't |
| --- | --- | --- | --- |
| **Us, misreporting** | Invent or edit a page, or backdate it | CI witness (invented bytes need a public commit); timestamps (no later edits) | A saved TLS session: spike 01 |
| **Us, selecting** | Capture only what suits us | Committed, mechanical URL list; every outcome recorded; one tool and one cadence for all | Any cryptography: this is process |
| **The org, later** | Edit or delete, then deny having said it | Timestamps plus a witness; the Internet Archive | Nothing makes denial impossible short of their own signature |
| **A third party** | Publish a fake "capture" | Verifier pins the workflow identity and timestamp roots | Trusting a bundle just because it has a signature |
| **The site** | Serve bots different content; a compromised site | Multi-vantage comparison raises the cost a little | Nothing here proves the page wasn't hacked or cloaked |
| **The network** | DNS or BGP hijack, misissued certificate | Certificate Transparency after the fact; several vantages | Any single fetch: the same limit TLSNotary's proxy mode states |
| **A witness** | GitHub, a timestamp authority or the Archive lies | Using several that don't share an operator | Each is trusted for what it signs: test 4 in spike 02 |
| **Domain is not the org** | Lookalike domain, a Google Doc, user content on a big platform | Show the host against `attribution.of.uri`; capture the org's page linking to it; `.well-known/openslate.json` | No cryptography at all: this is a human claim |

## Options

"Offline" means a verifier can check it later from the stored bundle with no
network. Byte figures were measured here unless marked.

| # | Option | Proves | Does not prove | Trust assumption | Bytes and moving parts | Offline / browser | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | **Saved handshake, keys and ciphertext** | A live handshake with the domain's key happened | **Anything about the content** | n/a | About 5 KB of handshake plus the ciphertext | Yes / yes | **Rejected.** Forged in spike 01 |
| 1 | **TLSNotary** | A notary saw this TLS session, with selective disclosure | Origin intent; only as good as the notary | Non-colluding notary. Proxy mode also assumes no MITM on the verifier-to-server path | MPC: about 30 MB up front; proxy mode benchmarks stop at 51 KB (their figures). Rust/WASM, alpha | Rust verifier; WASM "very experimental" (their words) | **Not now.** See finding 7 |
| 2 | **Proxy witness / zkTLS** (Reclaim; Opacity builds on TLSNotary) | A witness saw this ciphertext from the host | The same; ZK adds privacy that public pages don't need | The attestor(s). Reclaim's docs name this as a trust point | 429-byte attestation in spike 02, plus the witness service; Reclaim is AGPL-3.0 | Yes | **Not now.** Spike 02 shows the mechanism; it needs someone independent to run it |
| 3 | **Origin signs** (SXG, RFC 9421, `.well-known`, firsthand slate) | The org's own key said this | That its key wasn't stolen | The org's key | Free when present | Yes / yes | **Detect and prefer.** 0 of 203 today; SXG is ending |
| 4 | **Sigstore in public CI** | This repo, commit, workflow and GitHub-hosted runner produced these hashes, by this time, in a public log | That the origin really sent them | GitHub and Sigstore; the code at that commit is public to review | About 10 KB per run. No keys, no server | Yes, in Bun. Browser port not tested | **Recommended: the main rung** |
| 5 | **Timestamps** (RFC 3161 twice; OpenTimestamps optional) | These bytes existed by T, unchanged | Origin; that they didn't exist earlier | Each authority for time; Bitcoin for OTS | 6.0 and 6.6 KB per run; OTS 207 bytes pending | Yes; pkijs is WebCrypto-based. OTS needs Bitcoin headers | **Recommended.** Cheapest rung, and independent of GitHub |
| 6 | **Multi-vantage** | Several fetchers saw the same text | Origin; any fetcher can be fooled the same way | Fetchers don't share a fault | One more CI provider | Yes | **Later.** Byte comparison fails for 34% of pages, so compare extracted text |
| 7 | **Third-party archives** | Someone unconnected to us saw it | Nothing cryptographic | The Archive's honesty | A URL and digest in our record | Needs the Archive at check time, unless its bytes are also captured | **Recommended** as independent corroboration, not a dependency |
| 8a | **WACZ/WARC** | Who packaged it (anonymous or domain-signed) | Origin. WACZ signing is another witness signature | The signer | Container format | Yes | **Export format only.** See finding 9 |
| 8b | **DKIM on emailed endorsements** | The domain's mail server signed this email | That the sender's mail provider didn't sign for them; old keys rotate out of DNS | The mail domain's key, with the key archived at capture time | Needs a subscribed inbox | Yes, if the key is kept | **Idea to keep.** Real origin signatures nobody has to opt in to. Not researched further |
| 8c | **Certificate Transparency** | A certificate existed for the domain | Anything about content | CT logs | None | n/a | **Context only.** Explains why storing a chain proves nothing: the chain is public |

Not evaluated, so no claim is made: Primus (no useful sources found), Perma.cc
and archive.today (search returned nothing on their APIs or raw-byte handling).

## Findings

Times are from the spike runs on 2026-10-30.

### 1. A saved handshake is forgeable (spike 01)

`experiments/signed-source-capture/lib/tls13.ts` is a small TLS 1.3 client,
written so the verifier can be handed the client's ephemeral key and recompute
the **entire** RFC 8446 key schedule from the wire bytes. A keylog-based verifier
checks strictly less, so this is the strongest "saved handshake" verifier that
can exist: chain to a public root, hostname, validity, the server's
CertificateVerify signature, both Finished MACs, and every AEAD tag.

```
$ bun experiments/signed-source-capture/01-forge-saved-handshake.ts https://openslate.us/
1. Real capture: ACCEPTED                  body 1667 bytes, certificate CN=openslate.us
2. FORGED response, same handshake,
   re-encrypted by the client: ACCEPTED    body 74 bytes, certificate CN=openslate.us,
                                           '{"forged":"this body never came from the server...
3. Control: one bit flipped in real ciphertext, no keys used: REJECTED
4. Control: one bit flipped in the ServerHello: REJECTED
5. Control: claim the capture was for another host: REJECTED, certificate is not valid
6. Control: claim a capture date outside the cert's validity: REJECTED
7. Forged handshake (new client_random; every MAC redone, only the server signature
   reused): REJECTED, server's CertificateVerify signature does not verify
```

Also run against `ca.omniballot.us` (RSA-PSS, Amazon-issued certificate); same outcome.
`openslate.us` used ECDSA, so it isn't specific to one key type.

Test 7 is the most instructive. A forger can redo all the symmetric crypto,
Finished MACs included, and the one thing it cannot reproduce is the server's
signature. So that signature is real, transferable proof, and it covers only the
handshake transcript, which says nothing about the page.

### 2. A witness stops the forgery, and the witness becomes the trust (spike 02)

A TCP relay that knows nothing about TLS hashes both byte streams and signs them.

```
1. Real capture with its witness: ACCEPTED, body 1667 bytes
2. The same forgery as 01, against the witness: REJECTED, server bytes differ from what the witness saw
3. Forger signs its own statement with its own key: REJECTED, witness signature does not verify
4. The witness itself colludes and signs the forgery: ACCEPTED, body 74 bytes
```

Test 4 is the honest limit of every witness design, TLSNotary included. For
public pages there's no privacy to protect, so a witness relaying someone else's
TLS and a witness that simply fetches the page and signs carry the same trust.
The second is much simpler. That's why option 4 beats options 1 and 2 here.

### 3. Capture, timestamp, verify offline, re-extract: works end to end (spikes 04, 05)

```
$ bun .../05-verify-bundle.ts .../results/example-json --expect <evidence/measures.json>
  stamp digicert.tsr: 2026-10-30 3:17 AM PDT (10:17Z), root CN=DigiCert Trusted Root G4, 6007 bytes
  stamp sectigo.tsr:  2026-10-30 3:17 AM PDT (10:17Z), root CN=USERTrust RSA Certification Authority, 6635 bytes
  200 https://ca.omniballot.us/published/06085/1968/vg/lookups.json
    certificate CN=ca.omniballot.us, matches host: true, valid at the stamp: true, chain links: true
    re-extracted 3376 bytes, sha256 e34f2732...cec1; published evidence sha256 e34f2732...cec1: IDENTICAL
```

- The evidence was published from a fetch on 2026-10-24. A fresh capture six days
  later re-extracted to exactly the same bytes.
- `openssl ts -verify` agrees with the Bun verifier on both tokens: a second,
  independent implementation.
- Tampering: one edited byte in the manifest gives `token is over a different
  document`; one edited byte in a raw response gives `raw/73c5... does not match
  its name`.
- Certificates are judged at the timestamp's time, not today's, so the check gives
  the same answer years after they expire.
- Both authorities answered first try over plain HTTP, which is fine because the
  token itself is signed.

### 4. A real Sigstore bundle verifies offline in Bun (spike 06)

I did **not** create an attestation: that writes a permanent public log entry,
so it's Q2. This verifies an existing one, npm provenance for `@sigstore/verify`,
which uses the same Fulcio, Rekor and workflow identity as `actions/attest`.

```
Bundle verifies, with the network off.     size 10437 bytes, trust root 5747 bytes
  build_signer_uri: https://github.com/sigstore/sigstore-js/.github/workflows/release.yml@refs/heads/main
  source_repository_digest: 769a53d8...  runner_environment: github-hosted
  run_invocation_uri: https://github.com/sigstore/sigstore-js/actions/runs/30952660040/attempts/1
  dsse 0.0.1, log index 2341448712, integrated 2026-08-04 2:31 PM PDT (21:31Z)
1. Point the attestation at different bytes: REJECTED, DSSE payload hash mismatch
2. Flip one bit of the signature: REJECTED, tlog entry signature mismatch
3. Remove the transparency log entry: REJECTED, expected 1 timestamps, got 0
```

The certificate carries what a verifier needs to pin: repository, commit,
workflow file, trigger, run URL, and `runner_environment`, which must be
`github-hosted` (a self-hosted runner would let us feed it anything). `actions/attest`
accepts up to 1,024 subjects, or one manifest naming everything by hash, which is
what the design uses: **one attestation per run, not per page.**

`@sigstore/verify` uses `node:crypto`, so it won't run in a browser as is. A
browser port is unbuilt. The check is ECDSA plus a Merkle path, so it should be
feasible, but that's unproven.

GitHub's *immutable release* attestations are something else. `gh attestation
download` for `cli/cli` returned a bundle with no transparency log entry, signed
by GitHub's own Fulcio intermediate. That's GitHub vouching for a release asset,
not a workflow identity in a public log, and it doesn't substitute for the above.

### 5. The cited sources, measured (spike 03)

One GET per host, honest user agent, no retries, and a second GET 2 minutes later
to test stability. 2026-10-30, about 3:15 AM PDT (10:15Z).
`results/host-survey.json` has every host.

| Measure | Result |
| --- | --- |
| Hosts | 203, from 766 cited URLs: a small, sweepable set |
| HTTP outcome | 195 200, 5 404, 2 403, 1 timeout |
| **Origin signature headers** (`Signature`, `Content-Digest`, `Repr-Digest`, `Digest`) | **0 of 203** |
| **Signed Exchange served**, when offered | **0 of 203** |
| TLS negotiated | 200 on 1.3, 3 on 1.2. 4 hosts have no TLS 1.2 at all |
| Behind Cloudflare | 75 (`cf-ray`) |
| Text is in the raw HTML | 114 of 135 HTML hosts have at least 80% of the slate's surnames there; 3 partial; **18 under 20%** |
| **Bytes changed within 2 minutes** | **65 of 192 compared (34%), all HTML** |
| HTML size | Median 161 KB, 34 KB gzipped; p90 815 KB, 124 KB gzipped; max 2.4 MB |
| PDF size (14 hosts) | Median 283 KB; p90 1.0 MB; max 11.7 MB; one more truncated at my 12 MB limit |
| Certificate chain | Median 4.8 KB |
| Response headers | Median 913 bytes |

What that means:

- **Honest user agents mostly work**, at least from a home IP: 2 of 203 refused.
  GitHub runner IPs may do worse, which only a real run can tell (Q2). The Santa
  Clara scraper already records that the county's Cloudflare sometimes refuses
  scripts outright.
- **HTTP 200 doesn't mean content.** `www.sierraclub.org` answered 200 with a
  212-byte body in place of a page that 100 positions cite. Capture records that
  as is; only extraction or anchoring can notice. The 18 low-text hosts include
  apps that load data by XHR (`apps.lavote.gov`, `linkjar.to`,
  `maps.cartifact.com`, `lagop-endorsement-lookup.vercel.app`). I didn't classify
  the rest; some may keep their picks in an image or a linked PDF.
- **Comparing raw bytes between vantages won't work** for a third of hosts.
  Compare extracted text instead. Normalise only when comparing, never in storage.
- **Sources disappear.** 5 URLs, cited by 171 positions, now 404, for a live
  election. 3 of those were confirmed with a second client; for the other 2 the
  second client failed to connect. Logged in `ISSUES.md`.

### 6. Reproducing the slate from raw (spike 07)

Two kinds of slate:

- **Deterministic scrapers** (the registrar bundles): a pure extractor reproduces
  the evidence exactly, as in finding 3.
- **Read by a person or model** (most org slates, via the `endorsement-scraper`
  skill): no pure function rebuilds these, because stance mapping is a judgement.
  What can be checked mechanically is that the supporting text is really there.

```
$ bun .../07-anchor-positions.ts .../results/example-dead-page .../sf-republican-party/2026-11-03/positions.json
source text: 6126 comparable characters, from https://web.archive.org/web/20261018233112id_/https://sfgop.org/nov-2026-endorsements
25 positions
statements: { exact: 25, "quoted-parts": 0, unanchored: 0, "no statement": 0 }
```

That page answers 404 today, so this is the design working in its intended
failure case: origin gone, independent copy still there, slate still checkable.

Across the catalog, against the *existing* `evidence/` text with punctuation
normalised:

| Mode | Statements | Exact | At least 90% of words | Not anchored |
| --- | --- | --- | --- | --- |
| `scraped` | 6,650 | 4,649 | 1,472 | 529 (8%) |
| `transcribed` | 2,081 | 1,425 | 620 | 36 (2%) |

So about 92% and 98% anchor. That's against processed text, not raw bytes, so
treat it as an indication rather than a measurement of the raw case. Many
statements are descriptions wrapping a quote (`Listed under "CALIFORNIA ASSEMBLY":
"Diane Papan"`), which the `quoted-parts` rule exists for. 4,473 scraped positions
have no statement to anchor, and 21 non-inferred bundles have no evidence.

Today's evidence isn't raw, which matters for objectivity. The skill's step 1
says to fetch with WebFetch, which runs pages through a small model, and to "strip
obvious chrome". Both are judgement calls at capture time. Under the new design,
evidence becomes derived from the capture, not a substitute for it.

### 7. TLSNotary today

- Latest release `v0.1.0-alpha.15` (2026-05-21), still pre-release. Its FAQ says
  "TLSNotary currently supports TLS 1.2"; the proxy-mode post describes only the
  TLS 1.2 PRF. That's less of a blocker than it sounds: 199 of 203 hosts still
  speak 1.2. Four don't, including `www.plannedparenthoodaction.org` and
  `www.peaceandfreedom.us`.
- `notary-server` and `notary-client` were dropped in alpha.13, and the
  `tlsn-attestation` crate "will continue to be maintained but will not receive
  new features". I found no public notary to rely on.
- The new proxy mode (alpha.15) has the verifier forward real TLS traffic, which
  is much cheaper than MPC, and it "assumes attacker cannot MITM the
  verifier-to-server connection".
- A third party can verify a presentation; the example's own output asks "do you
  trust this key?" That's the same question CI answers with GitHub, except here
  someone also has to run the notary.
- Not built here: it needs a Rust build and a notary to mean anything, and it
  wouldn't change the recommendation. Proof sizes are therefore not measured.
- Revisit if a public, independently run notary appears. A notary run by us adds
  nothing.

### 8. Signed Exchanges are ending

Google Trust Services announced it would stop issuing SXG certificates around 2026-09-30:
"The Signed HTTP Exchange standard was not widely adopted and it is not being
evolved." Cloudflare's support reached end of life, disabled since October 2025.
So SXG needs no detector work. RFC 9421 and `Content-Digest` are cheap to detect, but a
`Content-Digest` alone proves nothing, and a signature is only as good as its
key, so a verifier must check that the key belongs to the org.

### 9. The Internet Archive is a real independent witness

- 4 of the 5 dead URLs have Wayback snapshots, including
  `sfgop.org/nov-2026-endorsements` from 2026-10-18.
- Raw bytes are preserved. `web/<timestamp>id_/<url>` matched the CDX digest on 4
  of 4, once fetched without decompression, and 9 to 23 original headers came back
  as `x-archive-orig-*`.
- Coverage is uneven: `lookups.json`, the XHR-only source, has **0 snapshots**,
  and the `peaceandfreedom.us` guide has none. So we'd have to ask it to capture,
  and Save Page Now's API needs an archive.org key. Reported rate limits are
  roughly 4 captures a minute anonymously and 6 to 12 authenticated (not verified),
  so a full sweep takes one to two hours. Corrected in `plans/archive-org-snapshots.md`:
  3 and 7 a minute by the API docs, and about 3 in practice.
- I only read from it here, and triggered no captures.

WACZ and WARC: the WARC format could hold these exchanges, but each record has
its own timestamp, so identical bodies wouldn't deduplicate. Content-addressed raw
files do, and 66% of responses didn't change between fetches. So the raw file
stays canonical, with WARC as a possible export for tools like ReplayWeb.

### 10. Gotchas that cost time

Mistakes of mine, kept because a future build would make the same ones.

- **Git silently corrupts captures on Windows.** With `core.autocrlf=true`,
  `git add` rewrote a raw response from 122,908 to 122,891 bytes, and a fresh clone
  failed with `token is over a different document`. The proofs caught it. Fix:
  mark captures `-text` in `.gitattributes`, and format tools must skip them
  (`biome.jsonc` now does). Verified from a fresh `autocrlf=true` clone.
- **Certificate chains don't end where you expect.** Servers and timestamp tokens
  send a cross-signed certificate above the real root. My first verifier checked
  only the top of the chain and falsely rejected `openslate.us`, and DigiCert's
  chain ends the same way. Stop at the first trusted root. This bug made the
  verifier stricter, so it never helped a forgery pass.
- **Don't let a token pick its own anchor.** Pin timestamp roots to fingerprints
  and require the timestamping key-usage on the signer, or any TLS certificate
  could pose as a timestamp authority.
- **Python on Windows reads files as cp1252.** That mangled the em dash in a
  Rekor checkpoint, and Sigstore correctly refused it. Handle evidence as bytes.
- **`fetch()` decompresses.** Hashing what it returns gives the wrong digest. The
  capture tool uses a raw socket for this reason; set `decompress: false` if you
  must use fetch.
- **My first statement-match figure of 15.5% was wrong**, because a naive substring
  check tripped on punctuation. The real figures are in finding 6.

### 11. The live source check keeps nothing

On 2026-10-30, about 9:32 AM PDT (16:32Z), the "Import Group Endorsements for Voter
Tools" thread started a pre-election re-scrape, including a sweep of every Nov 3
bundle's cited pages (`%TEMP%/os-round2/sweep.ts`). It's the right tool for its job, which
is finding quietly changed picks, but it isn't a capture:

| | That sweep | Capture design |
| --- | --- | --- |
| Bytes | Tags stripped in memory, then discarded. `pages.json` keeps only status and length | Whole response, verbatim |
| PDFs and images | Skipped | Kept: 155 cited URLs |
| Coverage | First 40 URLs per bundle | Every URL |
| User agent | Browser string | Honest and recorded |
| Headers, certificate chain | Not kept | Kept |
| Proof of time | None | Two timestamps |

The pages it read are changing right now, which is the case for capturing them: the
Bay Area News Group roundup was updated at 9:23 AM PDT that morning, and the
Chronicle's Governor pick arrived on Oct 28. The raw bytes of those pages as they
stood before those updates weren't kept. The evidence from that thread's last pass
is processed text ("HTML converted to text"), so finding 6's point still applies.

**Raw pages can't simply go in a public repo.** Reading that thread raised a gap in
this design. Some cited pages are news articles under copyright, and some of those
may be paywalled; I haven't counted them. The bundles already hold extracted text
from them, but a full public mirror of raw pages is a bigger step. So a sweep can run now only if its bytes stay
private until Q3 and Q8 are settled. That costs nothing in proof: the timestamp
authorities only ever see a hash, and a hash published later still pins the bytes.

### 12. What a real run showed

First CI run, 2026-10-30, 10:00-10:17 AM PDT (17:00-17:17Z), run `2026-10-30T1700Z`:
913 URLs: 852 returned 200, 36 another status, 25 no response. Verified offline by both
Sigstore implementations, in Chrome, and from a fresh `autocrlf=true` clone.

- **The witness works end to end.** The attestation is 11.5 KB, log index 3598270138,
  and its certificate names this repo, workflow, commit and `github-hosted` runner.
- **CI is blocked more than a home address.** Of 31 URLs that were neither 200 nor 404
  on GitHub's runner, a run from home got 200 on 23, including
  `files.santaclaracounty.gov`, `www.lacdp.org`, `www.stonewalldems.org` and
  `www.southbaylabor.org`. So these are blocks on datacenter addresses, not on honest
  clients. Those sources are Time-stamped only. `www.sf.gov` and `ballotpedia.org` answer
  CI with an HTTP 202 challenge.
- **Blocked from both:** `www.nfib.com`, `www.smdailyjournal.com`,
  `www.sanbenitocounty-ca-cre.gov` (403), and `www.sacbee.com` (25 URLs, no response).
- **HTTP 200 still doesn't mean content.** All 12 `www.sierraclub.org` URLs, cited by 365
  positions, answer a GET with about 726 bytes. Headless Chrome with the same honest
  user agent got the real page, about 107 KB.
- **The byte estimate was too low.** 889 MB of responses, not 80 to 250 MB: 770 MB is 81
  files over 5 MB, nearly all official voter guides from `media.api.sf.gov`,
  `acvote.alamedacountyca.gov` and `www.sdvote.com`. The repo holds 116 MB of smaller
  blobs. Most of that doesn't repeat: bytes are stored once by hash.
- **Requests were higher than they should have been.** That first run fetched a PDF once
  per `#page=` fragment. Fixed, but the sites took those requests.

Second CI run, 2026-10-30, about 10:47-11:05 AM PDT (17:47-18:05Z), run
`2026-10-30T1747Z`: 914 URLs: 861 returned 200, 37 another status, 16 no response.
Verified offline and in Chrome, and provenance was rebuilt in the publish job.

- **Browser capture works on GitHub's runner.** Sierra Club (9 pages) and `www.sf.gov` (2)
  came back 200 with real content. `www.sacbee.com` refuses Chrome too, with
  `ERR_HTTP2_PROTOCOL_ERROR`, so it has no capture from anywhere.
- **Local runs fill the gap, unwitnessed.** `2026-10-30T1731Z` (56 URLs from the hosts CI
  couldn't get) and `2026-10-30T1808Z` (4 URLs, including the Chronicle, which sends
  CI a 3 KB challenge and sends a home address the page). No response contained
  the home address, so the guard moved nothing.
- **Statements found in the raw bytes: 7,105 of 9,091 (78%).** That's the bundles at
  run time, and it isn't an accuracy figure. Spot checks of the biggest misses: the
  Chronicle was a challenge page; Lincoln Club's statements quote an image; Westside
  Forward's differ only by run-together text (`NOProp A`). Many slates cite an app's page
  while the data sits behind it. A miss is a fact about text, as designed.
- **A slate can outrun a run.** 1,842 positions showed "no capture yet" because the Import
  thread published new sources, mostly Reform California's county guides, after the list
  was fixed. The next scheduled run covers them, and the record was right to say so.
- **What a slate was read from wasn't being captured.** 38 slates say `transcribed`, most of them
  read from images or PDFs, but their positions cite the page around those files. On 2026-10-30
  about 4:45 PM PDT (23:45Z), 149 documents across 19 of them were missing from the list, Abundant
  Housing LA's 48 cards and San Joaquin's 23 among them. The discovery report had flagged seven pages for a person,
  but the slates' own `evidence/` notes already named the files, so none needed one.
- **The three slates whose notes named no document.** Checked 2026-10-30, about 5:45 PM PDT
  (2026-10-31 00:45Z), against the saved captures, each slate's evidence and build history, and two
  GETs (Riverside's cover and PDF) plus one of `sf.gov/ranked-choice-voting`, with the honest user
  agent. No position changed.

  | Slate | Read from | `mode` | Recorded |
  | --- | --- | --- | --- |
  | `riverside-county-republican-party` | Eight JPEGs, pages 02 to 09 of its guide, read again by eye and matching the transcription. All 75 positions already cite them, and CI has held them from the first run. The notes only looked empty: they named the files by relative path, which `documentsIn` can't read | Right | Full URLs in `NOTES.md` (`6884a83`), plus the cover and the PDF. No run has those two yet. The PDF is the same nine pages: no text layer, one image a page, same size, under 1 of 255 grey levels apart |
  | `sf-department-of-elections` | No document. The HTML text of two sf.gov pages, through WebFetch, then `scripts/sf-elections-ballot.ts`. All 65 values are in CI's Chrome capture. `ballot.ranks` comes from a third page the slate doesn't cite, so no capture holds it | Looks wrong | New `NOTES.md` (`f8bd0f5`). Nothing to add to the list |
  | `newport-beach-city-clerk` | No document. The city page's HTML text, entered by hand. The page says only "Measure H", so the title and ids are the Orange County Registrar's | Looks wrong | `NOTES.md` (`5ab10e9`). Nothing to add to the list |

  Riverside's two new documents make it the one slate this moves. The next capture lists them, and
  the pin after it reissues Riverside. `mode` is an open question below.
- **Nothing shows these pages as they were read.** The saved copies start on 2026-10-30, and
  `archived.json` has no snapshot of any of them. So SF (read 2026-10-19) and Newport (read
  2026-10-27) can only be shown to carry the same values now. Riverside's files are dated 2026-10-05
  by the server, before its reading, but no hash from that day exists to prove they're the same
  bytes. Two things aren't recorded anywhere: how WebFetch's output became SF's evidence files, and
  whether `sf.gov/ranked-choice-voting` was opened in October or just remembered. It does say 10.
- **The notes rule reads absolute URLs only.** Riverside wasn't alone: a filename scan finds names
  no URL in the slate carries in ten more transcribed slates. It's rough, and logged in the
  endorsements repo's `ISSUES.md` (`3d6dda0`).
- **Working Families' list sits behind a POST.** The page holds 10 rows of 221, and its View More
  button POSTs for the rest. This plan had said nothing needed POST capture. One request held all
  31 names.
- **The workflow's publish job runs the commit the run started on.** Code pushed during a run isn't
  used until the next one. So `2026-10-31T0003Z`'s provenance predates the change that lists these
  documents in a slate's record.
- **Some hosts refuse a home address too.** In `2026-10-31T0024Z`, `www.nfib.com`,
  `www.smdailyjournal.com` and `www.sanbenitocounty-ca-cre.gov` sent 403 and `ballotpedia.org` 202,
  and `www.sacbee.com` didn't answer. Everything else CI couldn't read came back, `smcdems.org`
  included. No response contained the home address.
- **A status can't show every block.** The Chronicle answers CI with a 200 holding a challenge. Treating
  every stub as a block pulled in Facebook, Instagram and ordinary script apps, which a home run
  doesn't help, so `src/blocked.ts` names that one host instead.
- **The dead-page case works from the Archive's own bytes.** `archive.ts compare` found
  25 of 25 `sf-republican-party` statements in the 2026-10-18 snapshot.
- **Bumping the OpenSlate pin moved no slate.** Pin `2416fe3` to `f41bf95` is 28 commits.
  Signed with a throwaway key, all 401 said what the published ones say, and the real
  publish reported 401 unchanged.
- **Pinning changed only the field.** 2026-10-30, about 2:15 PM PDT (21:15Z): 399 slates
  reissued, about 290 bytes each, no other payload change, all 401 valid against the live
  catalog, and the signed hash equals the hash of the real manifest. Reform California
  and Lookout Santa Cruz wait: they cite sources no run holds yet.
- **`.strict()` means any new field breaks every older release.** Desktop 0.1.0's core
  already rejected 85 of 401 slates for fields added after it (`voted_in`, `articles`,
  `ballot`, `rank`, `label`), and now rejects nearly all of them. Its installers show zero
  downloads, so nobody seems affected. In `ISSUES.md`.
- **Cutting 0.2.0 turned up two build breaks, both caught by the PR's dry run.** GitHub is
  retiring `macos-14` on 2026-11-02 and its brownouts cancel the job, so builds moved to
  `macos-15`. And one signed San Luis Obispo item has a 105-character name, past the
  100 ustar allows, so the offline build failed. The snapshot now saves that file under
  a short name, listed in `saved_as` in its own `guides.json`, and the manifest still
  checks it by the original path.
- **The Archive reads well from CI and writes slowly.** The first workflow run looked up
  400 URLs (313 have snapshots) and compared 194, of which 108 hold every statement.
  Save Page Now answered 429 after 3 requests from GitHub's address, with 1 accepted, so
  anonymous snapshots will trickle in at a few an hour.

Three bugs a build would hit again:

- A fragment isn't part of the request, so dedupe on the URL without it.
- `gh release upload --clobber` would re-upload 770 MB every run. Upload only new names.
- Bun on Windows throws `EEXIST` from a recursive `mkdir` of an existing `..\\` path. Use
  absolute paths. It hid behind a `tail`, and the half-finished publish it left is why
  placement is now resumable.

## Recommended minimal design

### Claims, not a score

Each source records the set of claims it can back. The app shows the strongest as
a label, but the claims are independent, and a verifier recomputes them rather
than trusting stored text.

| Label | Requires | Says | Does **not** say |
| --- | --- | --- | --- |
| **Reported** | A source URL | We say it came from here | Anything checkable. This is every slate today |
| **Captured** | Raw bytes, hash committed | Here are the exact bytes we used | When, or from where |
| **Time-stamped** | Two RFC 3161 tokens | These bytes existed by T, unchanged | That the server sent them |
| **Witnessed by public CI** | Sigstore bundle, pinned workflow, `github-hosted` | Public code, on GitHub's runner, fetched this and hashed it by T | That the server wasn't cloaking, hacked or hijacked |
| **Independently archived** | Archive snapshot whose text matches | Someone unconnected to us saw the same text | Anything cryptographic |
| **Notary-attested** (later, optional) | A public notary's attestation | A named third party saw the TLS session | More than that notary's honesty |
| **Origin-signed** | Signature from a key tied to the org's domain | The org's key said this | That the key wasn't stolen |

Separately, always shown and never folded into a label:

- **Host:** does the source's host match `attribution.of.uri`? (Exact, or "hosted
  elsewhere: docs.google.com".)
- **Derivation:** rebuilt by a pure extractor, or statements anchored (N of M), or
  transcribed by hand.

### Flow

1. **Intended list.** `sources.json` is generated mechanically from every
   `position.source` and `attribution.sources`, plus hand-added XHR URLs, and
   committed before a run. That makes selection public and reviewable.
2. **Capture**, in a public GitHub-hosted workflow. Same tool, cadence and rules
   for every org. No org-specific code exists in this step.
3. **Seal.** Hash the run manifest, get two timestamps, attest once with Sigstore.
4. **Corroborate**, best effort: ask Save Page Now for each URL. Never blocks.
5. **Extract**, as a separate offline step that reads only captured bytes.
6. **Sign** the slate in the existing publish job, unchanged. Capture needs no
   signing key at all, so the rule that the key never touches disk isn't at risk
   from this. (`publish.yml` itself writes it to the runner's temp disk today; that's
   in `ISSUES.md`.)

### Objectivity rules

These are the design, not nice-to-haves.

- Capture stores whole responses verbatim: no stripping, cleaning, filtering or
  summarising. Normalising happens only inside a comparison, on a copy.
- Every intended URL gets an outcome, including DNS errors, timeouts, 403s and
  stubs. A retry is another recorded exchange, never a replacement.
- **No selective disclosure.** Public pages have nothing to hide, and byte ranges
  are a cherry-picking risk. Always the whole response. A huge document keeps its
  whole-file hash; page numbers may point into it, but the proven unit stays the
  whole file.
- No model anywhere in capture or verification. Models may read the page to draft
  positions, in a step that's labelled as such.
- A failed anchor is reported as a fact, without interpretation.
- The user agent is honest by default and always recorded. A browser-like user
  agent or human-in-a-browser capture is a recorded per-source exception, and
  can't earn the CI witness label (Q5).

### Smallest unit

- **Text in the HTML:** the HTML response only.
- **Text from XHR on the org's domain:** only that response.
- **Text from XHR on a vendor's domain** (Santa Clara's `ca.omniballot.us`): that
  response, plus the org's page linking to it where one exists, because otherwise
  nothing ties the vendor's data to the org. This refines the request's "save just
  that", and it's the one case where the page earns its bytes.
- **Text that is an image or PDF:** that file. 32 cited URLs are images (slate
  cards) and 123 are PDFs, so "no images" means no *page furniture*, not no images.
- Never: CSS, scripts, fonts, or images that don't carry the text.
- XHR discovery is a separate, human-reviewed step that needs a browser once. Its
  output is URLs in the committed list, and capture stays a plain fetch.

### Data layout

```
captures/                            separate repo or release assets, see Q3
  runs/2026-11-01T1000Z/
    manifest.json                    intended URLs, every exchange by hash, tool hash, git commit
    manifest.sigstore.json           about 10 KB
    stamps/digicert.tsr              about 6 KB
    stamps/sectigo.tsr               about 6.6 KB
  blobs/ab/abcd...                   requests, responses, cert chains, named by SHA-256
                                     marked -text; gzip at rest only if the name stays the raw hash

orgs/<slug>/<election>/evidence/
  provenance.json                    this slate's sources -> run + exchange + claims + derivation
```

```jsonc
// provenance.json, one entry
{
  "url": "https://sfgop.org/nov-2026-endorsements",
  "exchange": { "run": "2026-11-01T1000Z", "index": 214, "response_sha256": "..." },
  "archived": { "url": "https://web.archive.org/web/20261018233112id_/...", "sha1": "GWQJ..." },
  "derivation": { "kind": "anchored", "exact": 25, "quoted_parts": 0, "unanchored": 0 }
}
```

The slate ties to this through a new optional attribution field, once the app
understands it (Q4). Because the schema is `.strict()`, the field must ship in the
schema and app **before** any slate uses it. A new capture that changes no
position shouldn't change the slate, or every sweep would make every voter's app
re-download. It adds a run to `provenance.json` instead.

### Byte estimate

| Item | Size | Notes |
| --- | --- | --- |
| One HTML capture | About 35 to 40 KB | Median 34 KB gzipped, plus headers and manifest entry |
| One JSON capture | About 16 KB | `lookups.json`: 122 KB raw, 14.9 KB gzipped |
| Certificate chain | 4.8 KB per host | Deduplicated by hash |
| Proof per **run**, not per page | About 23 KB | Two timestamps plus one Sigstore bundle |
| Full first sweep, HTML | About 34 MB | 605 URLs at the 56 KB gzipped mean |
| Full first sweep, PDFs and images | About 45 to 220 MB | 155 URLs. Median-based vs mean-based, as a few PDFs dominate |
| Repeat sweep | About 12 MB plus real changes | 34% of HTML churns; unchanged bytes store once |

Extrapolated from one URL per host, so read these as rough. The total is several
times `orgs/` (27 MB) and sweeps add noise, so raw bytes shouldn't enter that
repo's ordinary history.

**Big documents (a 78 MB pamphlet):** commit the URL, size, hash and proofs, as the
ballot repo's `.cache` policy already does, and keep the bytes as GitHub Release
assets. The manifest already names the hash, so the attestation covers the file
wherever it lives. The ballot repo's approach needs only the same capture and
sealing added.

## Open questions for the user

Settled on 2026-10-30, kept for the reasoning: Q1 sweep, Q2 CI run, Q3 storage, Q4
schema field, Q5 blocked sites, Q6 second witness (deferred), Q7 evidence page first, Q8
publication rule, and the merges and the field going in now.

Open:

1. **Should `sf-department-of-elections` and `newport-beach-city-clerk` say `scraped`?** Both say
   `transcribed`, which SPEC §3.9 defines by a non-machine-readable source (PDF, video, in-person
   notes), and `SecondhandBanner.tsx` shows voters "transcribed from a non-machine-readable source".
   Both were read from HTML, so that label is false for them. Recommendation: `scraped` for both.
   It fits SF exactly: a script built the slate from web pages, and the six county registrars' ballot
   sources already say it. Newport is a looser fit, because a person entered it and SPEC has no mode
   for that, but "scraped from public sources" is true there and today's label isn't. For SF, also
   change `scripts/sf-elections-ballot.ts:134` so a rebuild doesn't undo it, and add
   `sf.gov/ranked-choice-voting` to `attribution.sources` there and in the script, so the slate cites
   and captures that page. Both slates reissue and no position changes. The notes rule stops applying
   to them, which loses nothing, since they name no document. Not applied, because it changes what
   the slates claim: both `NOTES.md` files say it's waiting on this.

## Next steps

| Item | Needs |
| --- | --- |
| Confirm the first scheduled capture, 2026-10-31 3:00 AM PDT (10:00Z). Its provenance is the first to list the documents each slate was read from | Nothing: the daily task below reports it |
| Confirm the first scheduled pin, 2026-10-31 4:30 AM PDT (11:30Z). A dry run moved 20 slates to a run holding those documents, pinned 4 for the first time (Reform California, Lookout Santa Cruz, both Green Party slates) and left none waiting. Los Angeles GOP moves too, for its refreshed script URL | Nothing: the daily task below reports it |
| GitHub's scheduler: the first `schedule` run in the capture repo was `archive`, 2026-10-30 3:33 PM PDT (22:33Z), after it missed 18:30Z, 19:30Z, 20:30Z and 21:30Z. So schedules do fire there, late at first; a missed one sends no failure email. `capture` and `pin-capture` haven't had a scheduled slot yet | A T3 scheduled task, daily at 5:00 AM PDT (12:00Z) through Nov 5, starts `capture` and `pin-capture` if they didn't run, runs the home fill-in, and reports. It needs this machine awake |
| Five hosts refuse CI and a home address: `www.nfib.com`, `www.smdailyjournal.com`, `www.sanbenitocounty-ca-cre.gov`, `ballotpedia.org`, `www.sacbee.com` | Nothing for now: each failure is on the record |
| `alamedacountyca.gov/rov_app/candidatelist/` may need a form post | Someone finds the request. Capture can now send one |
| Second CI witness on GitLab | Deferred by the user |

## Things not to do

- Don't describe a saved TLS session as proof of content, anywhere. Spike 01.
- Don't compare raw bytes across vantages. A third of pages change on their own.
- Don't let Git or a formatter touch captures: `-text`, and exclude them from Biome.
- Don't treat HTTP 200 as success, or a signature as trustworthy without pinning
  whose it is.
- Don't add byte-range selective disclosure, or a filtering step, to capture.
- Don't run a notary ourselves and call it independent.
- Don't build SXG detection; it's ending.
- Don't put a new field in a slate before the schema and app accept it: they're
  `.strict()`.
- Don't move a slate's capture pointer on every run. It's signed content, so that
  reissues every slate.
- Don't let a capture depend on workflow inputs. The URL list comes from a commit.
- Don't count a change sweep as a capture, or publish raw news pages before Q8.
- Don't write a document's full URL in a transcribed slate's notes unless it was read or belongs to
  what was. The rule captures every URL it finds and reports it as a source, so describe the rest.

## Progress log

- [x] Read the pipeline (scrapers, schema, skill, CI, evidence layout)
- [x] Forgery spike: forgeable, shown on two server stacks (`01`)
- [x] Witness spike: stops the forgery, up to witness collusion (`02`)
- [x] Host survey of all 203 cited hosts (`03`)
- [x] Capture, RFC 3161, offline verify, re-extraction (`04`, `05`)
- [x] Sigstore offline verification of a real public bundle (`06`)
- [x] Position anchoring against a dead page's archived copy (`07`)
- [x] Option research, with gaps stated
- [x] Recommendation, design, byte estimate, next steps
- [x] Side issues logged in `ISSUES.md`
- [x] Compared against the Import thread's live re-scrape (finding 11), read only
- [x] The user's decisions on the open questions ("Do it all. Boil the ocean.")
- [x] Steps 1 to 12, see "What was built" (POST capture left out: nothing needs it yet)
- [x] Merged OpenSlate #2 and endorsements #1, 2026-10-30, about 2:10 PM PDT (21:10Z)
- [x] First full `build-site`, then live: 401 slates, 382 evidence pages
- [x] `attribution.capture` on 399 of 401 published slates, endorsements #2
- [x] Desktop 0.2.0 tagged and drafted, 2026-10-30, about 3:10 PM PDT (22:10Z)
- [x] Desktop 0.2.0 published on the user's word, 2026-10-30 5:39 PM PDT (00:39Z). Both update
  feeds serve 0.2.0 on all three platforms
- [x] CI browser capture on the thin-page rule: 22 pages in `2026-10-31T0003Z`
- [x] Documents named in transcribed slates' notes, 148 of 149 fetched (`7c1272b`)
- [x] POST capture, for Working Families (`7c1272b`), which was step 3
- [x] Home fill-in decided and scripted: `src/fill-in.ts`, run daily through Nov 5. A self-hosted
  vantage isn't needed, and it couldn't earn the CI witness anyway
- [x] `2026-10-31T0024Z`: 53 URLs from home, 26 of them 200
- [x] `pin-capture` asks a run to hold what a slate was read from (endorsements #3)
- [x] The three transcribed slates with no named document: all recorded in their notes, 2026-10-30,
  about 5:50 PM PDT (2026-10-31 00:50Z), endorsements `5ab10e9`, `6884a83`, `f8bd0f5`
- [ ] First scheduled capture and pin, 2026-10-31 3:00 and 4:30 AM PDT (10:00Z, 11:30Z)

**Not done:** TLSNotary wasn't built, so its proof sizes are unmeasured. OpenTimestamps
was only probed once (a 207-byte pending proof in 1.8 s) and that proof was never
upgraded.

**Requests made:** most hosts got two GETs and one TLS 1.2 handshake.
`ca.omniballot.us` got six GETs, over the one-or-two guidance; it's a static file on
CloudFront, and I moved the later re-runs to `openslate.us`. `web.archive.org` got
about a dozen reads.

## Sources

- [TLSNotary FAQ](https://tlsnotary.org/docs/faq/),
  [releases](https://github.com/tlsnotary/tlsn/releases),
  [proxy mode](https://tlsnotary.org/blog/2026/04/22/proxy-mode),
  [proxy benchmarks](https://tlsnotary.org/blog/2026/05/10/blog-proxy-mode),
  [attestation example](https://github.com/tlsnotary/tlsn/tree/main/crates/examples/attestation)
- [Reclaim attestor-core](https://github.com/reclaimprotocol/attestor-core),
  [What is Reclaim](https://blog.reclaimprotocol.org/posts/what-is-reclaimprotocol),
  [zkTLS overview covering Opacity](https://oasis.net/blog/zktls-blockchain-security)
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations),
  [offline verification](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations/verifying-attestations-offline),
  [`actions/attest`](https://github.com/actions/attest),
  [Sigstore bundle format](https://docs.sigstore.dev/about/bundle),
  [OIDC in Fulcio](https://docs.sigstore.dev/certificate_authority/oidc-in-fulcio/)
- [GTS ends SXG issuance](https://developers.google.com/public-key-infrastructure/updates/july2026-sxg-deprecation),
  [Cloudflare SXG end of life](https://developers.cloudflare.com/changelog/post/2026-06-23-amp-sxg-end-of-life/)
- [WACZ signing and verification](https://specs.webrecorder.net/wacz-auth/0.1.0/),
  [raw mementos proposal](https://mementoweb.org/rfc-extensions/raw-memento/),
  [Save Page Now 2 API](https://docs.google.com/document/d/1Nsv52MvSjbLb2PCpHlat0gkzw0EvtSgpKHu4mk0MnrA/mobilebasic)
- [FreeTSA](https://freetsa.org/). RFC 8446 (TLS 1.3), RFC 3161 (timestamps), RFC
  9421 (HTTP Message Signatures), RFC 9530 (digest fields).
