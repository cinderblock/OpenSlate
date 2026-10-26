# OpenSlate Specification — v1 (draft)

This document defines the **OpenSlate** wire format: a compact, signed, tamper-evident
token that carries a set of endorsement *positions* and is shareable over any medium.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as
described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

Status: **draft**. Stable enough to build against; breaking changes bump `v`.

---

## 1. Overview

An OpenSlate **slate** is a [JWS Compact Serialization](https://www.rfc-editor.org/rfc/rfc7515)
token signed with EdDSA (Ed25519, [RFC 8037](https://www.rfc-editor.org/rfc/rfc8037)):

```
BASE64URL(UTF8(header)) "." BASE64URL(UTF8(payload)) "." BASE64URL(signature)
```

- All BASE64URL is **without padding** (RFC 7515 §2).
- `header` and `payload` are JSON, serialized in canonical form (§4).
- The signature covers the ASCII bytes of `BASE64URL(header) "." BASE64URL(payload)`.

Because the token is a standard JWS, generic JOSE tooling can verify it given the
issuer's public key. Because the payload is canonical JSON, the token is trivial to
reproduce and to reimplement in any language.

A slate is **self-contained**: anyone can verify integrity and issuer authorship
offline. Mapping an issuer key to a real-world identity is a separate, optional
trust layer (§7).

---

## 2. Identity

An issuer is identified by an **Ed25519 public key**. The public key *is* the
identity at the cryptographic layer.

### 2.1 Key encoding

Public keys are encoded as:

```
ed25519:<base58btc(32-byte-public-key)>
```

- Prefix `ed25519:` names the algorithm.
- `base58btc` is the Bitcoin base58 alphabet.

Example: `ed25519:6fTPq8...` (44–45 chars after the prefix).

> Future versions MAY also accept [`did:key`](https://w3c-ccg.github.io/did-method-key/)
> for the same key material; `ed25519:` is the v1 canonical form.

Secret keys, when serialized (e.g. for backup), use the same scheme over the
32-byte Ed25519 seed. Secret keys MUST never appear in a slate.

---

## 3. Data model

### 3.1 `SlatePayload`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `v` | integer | yes | Spec version. MUST be `1`. |
| `issuer` | `Issuer` | yes | Who is making these endorsements. |
| `issued_at` | string | yes | [RFC 3339](https://www.rfc-editor.org/rfc/rfc3339) date-time, with offset (UTC `Z` recommended). |
| `expires_at` | string | no | RFC 3339. After this, verifiers SHOULD warn. |
| `context` | `Context` | no | Scopes the whole slate (one election/jurisdiction). |
| `positions` | `Position[]` | yes | MAY be empty (e.g. an issuer publishing only `endorsed_by` or `articles`). |
| `endorsed_by` | `Reference[]` | no | Who endorsed *this* issuer (for candidates/orgs). |
| `attribution` | `Attribution` | no | Marks this slate as a **secondhand report** by `issuer` about another entity. See §3.9. |
| `adopts` | `Adoption[]` | no | Positions this slate takes on from other slates by reference, instead of copying them. See §3.10. |
| `articles` | `Article[]` | no | Links attached to ballot items: news, analysis, explainers. Never positions. See §3.15. |
| `nonce` | string | no | Disambiguates otherwise-identical slates. |

### 3.2 `Issuer`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `key` | string | yes | `ed25519:<base58>` (§2.1). Verification uses this key. |
| `name` | string | no | Self-asserted display name. NOT proof of identity. |
| `kind` | string | no | `individual` \| `organization` \| `candidate` \| `campaign` \| other. |
| `uri` | string | no | Self-asserted homepage; basis for domain attestation (§7). |

### 3.3 `Subject` — the thing being voted on

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `title` | string | yes | Human label, e.g. `"Mayor of Springfield 2026"` or `"Prop 12"`. |
| `id` | string | no | Canonical id. Source-namespaced, e.g. `vip:<contest-id>` (Voting Information Project). |
| `kind` | string | no | `candidate` \| `measure` \| `race` \| `option` \| other. |
| `jurisdiction` | string | no | e.g. `us/ca/sf`. |
| `district` | string | no | Whose voters decide it, when narrower than `jurisdiction`: a path like `jurisdiction`'s (below). Not part of identity. |
| `election` | string | no | Election identifier or date. |
| `uri` | string | no | Link for more info. |
| `ballot` | `BallotContest` | no | How the ballot prints the contest: heading, measure number and label, how many to vote for (§3.14). Not part of identity. |

Two positions refer to the same real-world item when their `id` matches. Absent an
`id`, consumers fall back to `(title, jurisdiction, election)` matching.

**`district`** says who votes on a contest when that is narrower than its
`jurisdiction`: a county lists a school board's trustee area under the county,
but only that trustee area's voters have it on their ballot. It is a path in
the form of `jurisdiction`: segments after the first two name ever smaller
areas, each inside the one before it. A segment `<family>-<id>`, where
`<family>` is lowercase letters and `<id>` is digits or a single letter, is
district `<id>` of a family of districts drawn within the path before it
(ids compare as numbers when they are digits: `ta-04` is `ta-4`). Any other
segment names a place (a city, a special district). For example:

| `district` | Meaning |
| --- | --- |
| `us/ca/boe-2` | Board of Equalization district 2 |
| `us/ca/unsd-17760/ta-4` | Trustee area 4 of the unified school district with Census LEA code 17760 |
| `us/ca/orange-county/sup-4` | Orange County's supervisorial district 4 |
| `us/ca/irvine-ranch-water-district/div-5` | Division 5 of Irvine Ranch Water District |

Consumers MAY use `district` to decide whose ballot a contest is on. One that
can't tell whether a voter is in a district SHOULD say so, not guess. Because
`district` is not part of identity, slates that omit it, or disagree about
it, still refer to the same subject; a ballot listing's (§8.2) value is the
one to prefer.

### 3.4 `Position`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `subject` | `Subject` | yes | What this position is about. |
| `stance` | `Stance` | yes | See §3.6. |
| `choice` | string | no | The specific option/candidate chosen within a race, spelled as the ballot prints it. |
| `choice_id` | string | no | Catalog id of the choice (§3.11). Requires `choice`. |
| `write_in` | boolean | no | `true`: the choice is a write-in, not printed on the ballot (§3.12). Requires `choice`. MUST NOT be `false`; omit it instead. |
| `ballot` | `BallotChoice` | no | How the ballot prints the choice: party, ballot designation, incumbency (§3.14). Requires `choice`. |
| `weight` | number | no | Strength/confidence in `[0, 1]`. |
| `statement` | string | no | Free-text endorsement / rationale. |
| `source` | string | no | URL backing the position. |

### 3.5 `Reference` — a claimed cross-endorsement

Used in `endorsed_by` so a candidate/org can publish who endorsed them.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `issuer` | string | yes | `ed25519:<base58>` of the endorser. |
| `name` | string | no | Self-asserted endorser name. |
| `slate` | string | no | An embedded OpenSlate token proving the endorsement. |
| `uri` | string | no | Where the endorser's slate can be fetched. |
| `note` | string | no | Free text. |

A `Reference` is a *claim*. It is only proven if `slate` (or the slate at `uri`)
verifies, is issued by `issuer`, and contains a matching `endorse`/`lean_for`
position for this issuer. Consumers SHOULD treat unproven references as unverified.

### 3.6 `Stance`

One of: `endorse`, `oppose`, `lean_for`, `lean_against`, `neutral`, `abstain`.

| Stance | Meaning |
| --- | --- |
| `endorse` | "I support / voted for this." |
| `oppose` | "I am against this." |
| `lean_for` | "Leaning toward, not committed." |
| `lean_against` | "Leaning against, not committed." |
| `neutral` | Explicitly no preference. |
| `abstain` | Deliberately declining to weigh in. |

### 3.7 `Context`

| Field | Type | Req |
| --- | --- | --- |
| `election` | string | no |
| `jurisdiction` | string | no |
| `title` | string | no |

### 3.8 Unknown fields

Objects are **closed** in v1: a verifier MUST reject a payload containing fields not
defined here. This prevents smuggling meaningful data outside the validated schema.

### 3.9 `Attribution` — secondhand reports

When present, `attribution` marks the slate as a **secondhand report**: the
slate's `issuer` (the signer) is reporting what the entity in `attribution.of`
is claimed to have publicly said, rather than itself BEING that entity.

The pattern lets researchers, journalists, or volunteers publish a verifiable
summary of an organization's stated endorsements **without impersonating** the
organization. The signature still proves authorship by the researcher's key;
it does not prove the underlying claim is correct.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `of` | object | yes | The entity whose stance is being reported. See below. |
| `mode` | string | yes | `scraped` \| `transcribed` \| `inferred`. |
| `retrieved_at` | string | yes | RFC 3339. When the researcher observed the source. |
| `sources` | string[] | no | Slate-level source URLs. (`Position.source` is per-position.) |

`attribution.of`:

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Human-readable name of the reported entity. |
| `uri` | string | no | Homepage / source page for the entity. |
| `kind` | string | no | `organization` \| `candidate` \| `campaign` \| other. |

`mode` values:

| Mode | Meaning |
| --- | --- |
| `scraped` | Pulled programmatically from one or more web pages. |
| `transcribed` | Manually entered by a human from a non-machine-readable source (PDF, video, in-person notes). |
| `inferred` | Derived indirectly (e.g. from membership in a coalition that endorsed X). Lower confidence. |

#### Consumer requirements

Verifiers and UIs that render slates carrying `attribution` MUST:

- Display the slate as a secondhand report attributed to `attribution.of.name`,
  not as a firsthand statement by `issuer.name`.
- Make clear which key signed (the researcher) and that the named entity has
  NOT signed this slate.
- Prefer a firsthand slate from `attribution.of` (i.e. one whose `issuer.key`
  the entity has attested to under §7) when one is available, and offer to
  supersede the secondhand slate with it.

Issuers SHOULD set `kind: "researcher"` on themselves when publishing
attributed slates (see §7.1).

### 3.10 `Adoption` — positions taken on by reference

An entity often publishes another entity's picks as its own: a county party
reposts the state party's statewide picks, a state union republishes its
national union's House picks, two groups issue one joint statement. Copying
those positions into a second slate duplicates them and loses where they came
from. An `Adoption` instead points at the slate that states them.

A publisher MAY use either method, or both in one slate: copy positions into
`positions`, or reference them with `adopts`. A reference MAY embed a snapshot.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `issuer` | string | yes | `ed25519:<base58>` key that signed the adopted slate. |
| `of` | string | no | When the adopted slate is secondhand: its `attribution.of.name`. One researcher key may sign many slates. |
| `election` | string | no | The adopted slate's `context.election`, to tell one entity's slates apart. |
| `uri` | string | one of | Where the adopted slate can be fetched. A live reference: the slate there may be re-issued. |
| `slate` | string | one of | An embedded OpenSlate token: a snapshot that verifies offline. |
| `subjects` | `Subject[]` | no | Which positions to adopt, matched by subject identity (below). Absent means all of them. |
| `source` | string | no | URL where the adopting entity published the adoption (evidence). |
| `note` | string | no | Free text. |

At least one of `uri` or `slate` MUST be present.

**Subject identity.** A subject's identity is its `id` when present, otherwise
the triple (`title`, `jurisdiction`, `election`), where absent compares equal
to absent. Two subjects are the same if their identities are equal. To adopt a
position, copy its subject as it appears in the adopted slate.

**Semantics.** The adopting slate's entity (its `attribution.of` if the slate
is secondhand, otherwise its `issuer`) is claimed to hold the selected
positions of the adopted slate: their `stance`, `choice` and `weight`. Each
adopted position keeps its own `statement` and `source`.

Consumers resolving an adoption:

- MUST use only a slate that verifies (§6.2), is issued by `issuer`, and
  matches `of` and `election` when they are given. Use the embedded `slate` if
  present; otherwise a matching slate the consumer already holds, or one
  fetched from `uri`. If several match, use the most recently issued.
- MUST NOT produce positions from an adoption they can't resolve. They SHOULD
  show it as unresolved (e.g. "adopts 12 positions from <of>, not loaded").
- MUST let positions the slate states itself win over adopted positions on the
  same subject.
- MAY follow adoptions inside adopted slates. Implementations SHOULD stop at a
  depth of 4 and MUST ignore cycles.
- SHOULD show adopted positions as the adopting entity's, with where they came
  from ("via <adopted entity>").

Like a `Reference` (§3.5), an adoption is a claim by the adopting slate's
signer. For a secondhand slate it is the researcher reporting that the named
entity republished those picks; `source` is the evidence.

### 3.11 Choice identity

Within one subject (§3.10, *Subject identity*), two positions name the same
choice when their `choice_id` values are equal. A `choice_id` is an opaque,
source-namespaced string (§8.1), assigned by a ballot listing (§8.2). It is
compared only within its subject; it need not be unique across subjects.

Publishers SHOULD copy `choice_id` from the ballot listing for the subject
when one exists, and SHOULD set `choice` to the listing's spelling. `choice`
stays required alongside `choice_id`, so a slate reads correctly without the
listing. Once published, a listing's ids MUST NOT change; a corrected
spelling keeps its id.

A position without a `choice_id` names its choice by `choice` alone. A
consumer holding a ballot listing for the subject:

- SHOULD resolve the name to one of the listing's choices when it is plainly
  the same name (exact; or the same person by rule, such as a nickname the
  ballot prints in parentheses or quotes, or a middle initial left out), and
  show it under the listing's spelling.
- MUST NOT resolve a name that only resembles a listed one (a likely typo, an
  unusual short form) without telling the user. It MAY offer the resemblance
  as a suggestion.
- SHOULD show a name it can't resolve, or a `choice_id` the listing doesn't
  contain, as *not on the ballot*, never silently as another candidate.

Without a listing, consumers compare `choice` strings, and MAY group a
position without a `choice_id` with others whose `choice_id` they know under
the same spelling.

### 3.12 Write-ins

`write_in: true` says the choice isn't printed on the ballot: a voter has to
write the name in. It applies to candidates, not to measures.

A ballot listing (§8.2) MAY list the certified (qualified) write-in candidates
for a contest as positions with `write_in: true`, each with a `choice_id`. A
position for one of them SHOULD carry the same `write_in` and `choice_id`.

A write-in position whose name the listing doesn't certify is still valid
and MUST still be shown. Consumers SHOULD warn that in many jurisdictions
only certified write-in candidates' votes are counted. A position for a name
the listing *does* print on the ballot SHOULD NOT carry `write_in`;
consumers SHOULD treat it as the printed candidate.

### 3.13 URLs

Every field this specification gives as a link (`Issuer.uri`, `Subject.uri`,
`Position.source`, `Reference.uri`, `Attribution.of.uri`,
`Attribution.sources`, `Adoption.uri`, `Adoption.source`) MUST be an
absolute URL with the scheme `http` or `https`. Verifiers MUST reject a
payload with any other scheme. Consumers show these as links, and a
`javascript:` or `data:` URL in a link runs whatever its author wrote as soon
as someone follows it.

### 3.14 How the ballot prints it — `BallotContest`, `BallotChoice`

What a ballot prints about a contest and its choices, as data, so that a
consumer can lay out (or print) a faithful copy of the ballot without reading
anything out of free text. A ballot listing (§8.2) supplies these; any other
slate MAY copy them from one. None of it is part of identity: slates that
leave it out, or disagree, still name the same subject and choice, and
consumers SHOULD prefer a listing's values.

`Subject.ballot` is a `BallotContest`:

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `heading` | string | no | The contest's heading as printed: `"Proposition 43"`, `"Measure A"`, `"Attorney General"`. |
| `number` | string | no | A measure's number or letter as printed: `"43"`, `"A"`. |
| `label` | string | no | What's printed under the heading: a measure's ballot label or question, a retention question. |
| `measure_type` | string | no | A measure's type as printed: `"Initiative Statute"`, `"Legislative Constitutional Amendment"`, `"Bond Measure"`. |
| `vote_for` | integer | no | The most choices a voter may mark (≥ 1): the ballot's "Vote for no more than N". |
| `ranks` | integer | no | A ranked-choice contest: a voter ranks up to this many choices (≥ 2). |

`Position.ballot` is a `BallotChoice`:

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `party` | string | no | The party, or party preference, as printed: `"Democratic"`, `"No Party Preference"`. |
| `designation` | string | no | The ballot designation as printed: the candidate's occupation or title. |
| `incumbent` | boolean | no | `true`: the listing marks the candidate as the incumbent. MUST NOT be `false`; omit it instead. |

Either object MUST have at least one field. `vote_for` and `ranks` MUST NOT
both be present. A measure is a single Yes or No, so neither applies to one.

These fields are the only structured source of what they carry. `statement`
and `title` are free text: consumers MUST NOT parse a party, a designation, a
seat count or a measure number out of them. A publisher that wants one read
puts it here.

### 3.15 `Article` — links attached to a ballot item

An `Article` attaches a link (news coverage, analysis, an explainer) to the
thing being voted on. It is not a position: it says nothing about how to
vote. Anyone may sign articles: a newsroom about its own coverage, a
researcher reporting a publisher's (§3.9), a voter. A slate MAY carry
articles and no positions.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `subject` | `Subject` | yes | What the article is about. |
| `choice` | string | no | The choice within the subject it's about, e.g. a candidate profile. |
| `choice_id` | string | no | §3.11. Requires `choice`. |
| `uri` | string | yes | The article (§3.13). |
| `title` | string | yes | Its headline. |
| `publisher` | string | no | Who published it: `"CalMatters"`. |
| `published_at` | string | no | RFC 3339 full-date (`2026-10-01`) or date-time. |
| `kind` | string | no | `news` \| `analysis` \| `opinion` \| `explainer` \| `guide` \| other. |
| `summary` | string | no | A sentence or two on what it covers. |

Consumers:

- MUST NOT count an article as support for, or opposition to, anything.
- SHOULD show each article with the subject (and choice) it names, matched
  as positions are (subject identity, §3.10; choice identity, §3.11). No
  other step is needed to collate them.
- SHOULD show who attached it (the slate's entity, §3.9) as well as the
  publisher: the attachment is the signer's claim.
- SHOULD show one link per `uri` when several slates attach the same
  article, with everyone who attached it.
- MAY show articles from any imported slate, followed or not: they carry no
  recommendation.

Adoptions (§3.10) take on positions only, not articles.

---

## 4. Canonical JSON

The `header` and `payload` JSON MUST be serialized using JSON Canonicalization Scheme
([RFC 8785, JCS](https://www.rfc-editor.org/rfc/rfc8785)):

1. Object keys sorted by UTF-16 code unit.
2. No insignificant whitespace.
3. Strings escaped minimally per JSON.
4. Numbers in ECMAScript `Number`-to-string form.

OpenSlate payloads use only strings, a single bounded number (`weight` in `[0,1]`)
and the literal `true` (`write_in`), so a conforming JCS implementation is a recursive
key-sort plus standard JSON number formatting. Members whose value is `undefined`/absent MUST be omitted (not `null`),
unless `null` is explicitly meaningful (it is not, in v1).

Canonicalization guarantees two independent implementations produce the *same* token
for the same logical input. Note that **verification** relies on the transmitted
`BASE64URL(header).BASE64URL(payload)` bytes directly, so a verifier need not
re-canonicalize to check a signature.

---

## 5. Header

```json
{ "alg": "EdDSA", "typ": "openslate+jws", "kid": "ed25519:<base58>" }
```

- `alg` MUST be `"EdDSA"`. Verifiers MUST reject other values.
- `typ` MUST be `"openslate+jws"`.
- `kid` MUST equal `payload.issuer.key`. Verifiers MUST reject a mismatch.

---

## 6. Signing & verification

### 6.1 Signing

1. Build and schema-validate the `SlatePayload`.
2. Construct the header with `kid = issuer.key`.
3. `signingInput = BASE64URL(JCS(header)) + "." + BASE64URL(JCS(payload))`.
4. `signature = Ed25519-Sign(secretKey, ASCII(signingInput))`.
5. Token = `signingInput + "." + BASE64URL(signature)`.

### 6.2 Verification

A verifier MUST:

1. Split the token into three segments by `.`; reject if not exactly three.
2. Base64url-decode and JSON-parse `header` and `payload`.
3. Reject if `header.alg != "EdDSA"` or `header.typ != "openslate+jws"`.
4. Schema-validate `payload` (§3); reject unknown fields.
5. Reject if `header.kid != payload.issuer.key`.
6. Decode the public key from `payload.issuer.key`.
7. Verify the Ed25519 signature over `ASCII(seg0 + "." + seg1)` using that key.
8. If `expires_at` is present and in the past, surface a warning (still structurally valid).

A token is **valid** iff steps 1–7 succeed. Validity proves integrity and that the
holder of the issuer's secret key authored it — *not* the issuer's real-world identity.

---

## 7. Trust & real-world identity (informative)

The signature binds a slate to a *key*, not a person or org. Establishing that a key
belongs to "The Sierra Club" or "Jane Candidate" is layered on top and is OPTIONAL:

- **Domain attestation.** An issuer publishes a document at
  `https://<domain>/.well-known/openslate.json` listing the keys they control. If
  `issuer.uri` is on that domain and the key is listed, a verifier MAY treat the key
  as attested by that domain.
- **Cross-endorsement.** `endorsed_by` references that resolve to verifying slates
  build a web of corroboration.
- **External directories / web-of-trust.** Out of scope for v1.

Example `/.well-known/openslate.json`:

```json
{
  "version": 1,
  "name": "Example Org",
  "keys": [
    { "key": "ed25519:6fTPq8...", "kind": "organization", "added": "2026-01-01T00:00:00Z" }
  ]
}
```

### 7.1 Researcher identities (informative)

Slates carrying `attribution` (§3.9) are *secondhand reports* — the signer is
not the named entity but a researcher / journalist / volunteer who observed
the entity's public statements. There is **no central or project-blessed
researcher key**; anyone may publish their own.

Conventions for researcher identities:

- Use `issuer.kind: "researcher"` and a `name` that identifies the publisher
  (e.g. `"OpenSlate Research Bot — coastal-team"`).
- Publish a `/.well-known/openslate.json` on a domain you control, listing
  the researcher key(s) and any rotation history. Set `issuer.uri` to that
  domain so verifiers can fetch it.
- Each Position SHOULD carry a `source` URL pointing at the page/document
  the stance was taken from. `attribution.sources` may carry slate-level
  pointers (e.g. the org's main endorsements page).
- Rotate the researcher key whenever a backing system or operator changes;
  add the new key to the well-known doc and let `expires_at` on prior slates
  age them out. There is no in-slate revocation in v1.

Example researcher `/.well-known/openslate.json`:

```json
{
  "version": 1,
  "name": "OpenSlate Research Bot — coastal-team",
  "keys": [
    {
      "key": "ed25519:9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu",
      "kind": "researcher",
      "added": "2026-01-15T00:00:00Z",
      "note": "Used for the 2026 general; rotates per election cycle."
    }
  ]
}
```

Consumers SHOULD treat secondhand slates as lower-confidence than firsthand
slates whose key has been attested by the named entity's own domain. When
the named entity later publishes their own firsthand slate, that slate
SHOULD supersede any secondhand reports for the same `(election,
jurisdiction, subject)` tuple.

---

## 8. Ballot data & subjects (informative)

OpenSlate does not define an election catalog. The reference toolkit sources ballot
contests from the [Voting Information Project](https://www.votinginfoproject.org/)
through a stateless proxy, mapping VIP contests/candidates onto `Subject` (with
`id = "vip:<id>"`). Any catalog may be used; matching across issuers relies on
shared `Subject.id` values. Subjects need not be on any official ballot — arbitrary
votable options are allowed via free-form `title`.

### 8.1 Subject ID namespaces (informative)

`Subject.id` is source-namespaced so that multiple catalogs can coexist without
collision. The reference toolkit uses:

| Prefix | Source | Example |
| --- | --- | --- |
| `vip:` | Voting Information Project (Google Civic Info) | `vip:2024-11-05:CA-SF:mayor` |
| `civicapi:` | [civicAPI](https://civicapi.org) race ID | `civicapi:26131` |
| `local:` | Tool-local key for subjects with no upstream id | `local:us-ca-sf\|2024-11-05\|prop-12` |
| `<publisher>:` | `choice_id` from a ballot listing (§8.2); the reference catalog uses the listing's directory name | `ca-secretary-of-state:2026-11-03/california-secretary-of-state/donald-p-don-wagner` |

A ballot listing's `choice_id` values SHOULD start with a short prefix naming
the listing's publisher, as above.

`civicapi:<id>` references civicAPI's numeric `race.id` and is used by the
reference toolkit for post-election results comparison. It SHOULD NOT replace
an existing `vip:<id>` on a `Subject` issued by a voter; rather, it's a
secondary mapping the reference toolkit stores client-side so an outcome
display can resolve `vip` ↔ `civicapi` without requiring the issuer to know
about civicAPI.

Verifiers and collators MUST treat unrecognised prefixes as opaque strings —
they may still be equal across slates (enabling cross-issuer collation) without
being interpretable.

### 8.2 Ballot listings

A **ballot listing** is a slate that states what is on the ballot, not what to
vote for. It is a secondhand report (§3.9) whose `attribution.of.kind` is
`election-authority` (a Secretary of State, a county elections office), or a
firsthand slate whose `issuer.kind` is `election-authority`. It lists:

- one `neutral` position per choice in each contest it covers, in ballot
  order, with the ballot's spelling in `choice` and an id in `choice_id`;
- how the ballot prints each contest and choice (§3.14): the heading,
  measure number, label and type and how many to vote for in the subject's
  `ballot`; party, ballot designation and incumbency in the position's
  `ballot`, not in `statement`;
- certified write-in candidates, when known, the same way with
  `write_in: true`;
- for a contest only part of its jurisdiction votes on, that part in the
  subject's `district` (§3.3).

Consumers treat a listing as the field of each contest it lists, not as a
recommendation: its positions don't count as support or opposition. A listing
*covers* the jurisdictions its positions name, for the election they name.
In a covered jurisdiction, a contest the listing doesn't name is not on the
ballot, and consumers SHOULD say so.

---

## 9. Security considerations

- **Secret keys** are sensitive. Reference apps store them client-side only; users
  are responsible for backup. Compromise allows forging that issuer's slates.
- **No revocation in v1.** Use `expires_at` and re-issue. Key rotation is published
  via the attestation document (§7).
- **Replay / staleness.** `issued_at` (+ optional `expires_at`, `nonce`) let consumers
  prefer the newest slate from an issuer.
- **No confidentiality.** Slates are public artifacts; do not put secrets in them.
- **Closed schema** (§3.8) limits injection of unvalidated data.
- **Links are http(s) only** (§3.13). Consumers that show a link from any
  other source (an index, a catalog) SHOULD apply the same rule.

---

## 10. Versioning

`v` is a single integer. Additive, backward-compatible changes MAY be made within a
version by adding OPTIONAL fields (verifiers must already reject unknown fields, so
such additions ship with a coordinated spec revision). Incompatible changes bump `v`.

### 10.1 Changelog (within v1)

- **2026-10-25** — Added optional `ballot` to `Subject` and `Position`
  (§3.14): how the ballot prints a contest and a choice, as fields, where
  listings had put them in `statement`. Added optional `articles` to
  `SlatePayload` (§3.15): links attached to ballot items. Amended in place;
  verifiers built before this revision reject slates that use them (closed
  schema, §3.8), so consumers should upgrade before publishers use them.

- **2026-10-25** — Links (§3.13) MUST be `http:` or `https:` URLs; a
  `javascript:` or `data:` URL in a link is an attack on whoever follows it.
  Amended in place: this rejects slates that verified before, but none that
  were published carried such a link.

- **2026-10-24** — Added optional `district` to `Subject` (§3.3): who votes
  on a contest, when narrower than its `jurisdiction`. Not part of identity.
  Amended in place. Verifiers built before this revision reject slates that
  use it (closed schema, §3.8), so consumers should upgrade before
  publishers use it.

- **2026-10-23** — Added optional `choice_id` and `write_in` to `Position`
  (§3.4, §3.11, §3.12) and defined ballot listings (§8.2). Amended in place;
  the format was unadopted at the time. Verifiers built before this revision
  reject slates that use the new fields (closed schema, §3.8), so consumers
  should upgrade before publishers use them.

- **2026-10-19** — Added optional `adopts` field to `SlatePayload` (§3.10):
  adopting another slate's positions by reference. Verifiers built before this
  revision reject slates that use it (closed schema, §3.8), so consumers should
  upgrade before publishers adopt it.
- **2026-05-31** — Added optional `attribution` field to `SlatePayload` (§3.9)
  and conventional `kind: "researcher"` (§7.1). Amended in place rather than
  bumping `v`; the format was unadopted at the time.

---

## 11. File extension and media type

A single OpenSlate token MAY be stored or transmitted as a file or HTTP body.

| What | Value |
| --- | --- |
| File extension | `.slate` |
| Media type     | `application/openslate+jws` |

- The file content MUST be exactly the token string (`header.payload.signature`),
  optionally followed by a single trailing newline. No surrounding whitespace,
  no JSON wrapping, no Base64 of the whole thing.
- The structured suffix `+jws` ([RFC 6839](https://www.rfc-editor.org/rfc/rfc6839))
  signals that generic JWS-compact tooling MAY process the body.
- The media type `application/jose` MAY also be used by generic JOSE tooling;
  `application/openslate+jws` is preferred so consumers can dispatch on the
  OpenSlate `typ` value without first decoding the header.

This v1 specification does not define a collection format. The conventional
representation of multiple slates is a directory of `.slate` files (with an
out-of-band index if desired). A future revision MAY define `.slates` as a
newline-delimited list of tokens; implementations SHOULD NOT preempt that.

---

## Appendix A — illustrative payload

```json
{
  "v": 1,
  "issuer": {
    "key": "ed25519:6fTPq8K1...",
    "name": "Jane Voter",
    "kind": "individual"
  },
  "issued_at": "2026-05-28T17:00:00Z",
  "context": { "election": "2026-11-03", "jurisdiction": "us/ca/sf" },
  "positions": [
    {
      "subject": {
        "title": "Mayor of Springfield",
        "id": "vip:contest-123",
        "kind": "race",
        "ballot": { "heading": "Mayor", "vote_for": 1 }
      },
      "stance": "endorse",
      "choice": "A. Candidate",
      "choice_id": "vip:candidate-456",
      "ballot": { "party": "Independent", "designation": "City Councilmember" },
      "weight": 1,
      "statement": "Strong record on transit."
    },
    {
      "subject": { "title": "Prop 12", "id": "vip:measure-77", "kind": "measure" },
      "stance": "oppose"
    },
    {
      "subject": { "title": "City Council District 4", "kind": "race" },
      "stance": "lean_for",
      "choice": "B. Other"
    },
    {
      "subject": { "title": "Water Board Seat 2", "kind": "race" },
      "stance": "endorse",
      "choice": "C. Writein",
      "write_in": true
    }
  ],
  "articles": [
    {
      "subject": { "title": "Prop 12", "id": "vip:measure-77", "kind": "measure" },
      "uri": "https://news.example/2026/10/prop-12-explained",
      "title": "Prop 12, explained",
      "publisher": "Example News",
      "published_at": "2026-10-01",
      "kind": "explainer"
    }
  ]
}
```
