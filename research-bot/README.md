# research-bot/

Workspace for **secondhand** OpenSlate slates — verifiable summaries of
endorsements that other entities (orgs, unions, editorial boards) have stated
publicly, signed by a researcher's key per [SPEC §3.9](../SPEC.md#39-attribution--secondhand-reports)
and [§7.1](../SPEC.md#71-researcher-identities-informative).

There is no central or project-blessed researcher. Anyone may produce slates
under this layout using their own `kind: "researcher"` identity. Bundles are
republishable anywhere (GitHub, gist, IPFS, email) — they are self-contained
artifacts and the project does not host them.

## Layout

```
research-bot/
  README.md                              ← this file
  orgs/
    <slug>/                              ← short kebab-case id for the entity
      <election>/                        ← election label, e.g. 2026-11-03
        positions.json                   ← sign input (positions + attribution + context)
        evidence/
          <page-name>.md                 ← saved source page text + URL + fetch time
          NOTES.md                       ← extraction notes; judgment calls; what was skipped
        signed.slate                     ← present once a human has reviewed and signed
```

One `<slug>/<election>/` bundle per entity per election. A bundle is "ready"
when `signed.slate` exists alongside the inputs that produced it.

## Producing a bundle

The `endorsement-scraper` Claude skill (`.claude/skills/endorsement-scraper/`)
walks through:

1. Fetch the entity's public endorsements page(s) → `evidence/*.md`.
2. Extract positions → `positions.json` with an `attribution` block.
3. Validate the schema (`openslate validate`).
4. **STOP** for human review.
5. Human signs with their researcher identity → `signed.slate`.

The skill is the recommended path because it enforces the safety
guard-rails (always populate `Position.source`, never put the entity's name
in `issuer.name`, prefer `omit` over `inferred`, etc.). The procedure can
also be done by hand — the format is the contract, not the tooling.

## Verifying a bundle

```sh
bun run packages/cli/src/index.ts verify research-bot/orgs/<slug>/<election>/signed.slate
```

`verify` will print a `SECONDHAND REPORT` banner with the named entity, the
mode, and the `retrieved_at` timestamp, so it is immediately obvious that
the named entity did not sign the slate themselves.

## Superseding

When the named entity publishes their own *firsthand* slate (signed with a
key the entity has attested via `/.well-known/openslate.json` per SPEC §7),
consumer apps SHOULD prefer it over any secondhand report for the same
`(election, jurisdiction, subject)` tuple. The secondhand bundle stays
useful as historical context; the firsthand slate becomes the source of
truth.

## Publishing

Bundles are designed to be redistributed. Commit them to a public repo,
attach them to a release, post them as a gist, mirror them on IPFS — the
self-contained `signed.slate` plus its `evidence/` is enough for anyone to
verify and audit. The project does not run a central index.

## What does NOT belong here

- Firsthand slates from the project maintainers themselves (use the regular
  `openslate sign` flow, store the `.slate` wherever you publish it).
- Researcher secret keys (those live in `*.identity.json` files outside the
  repo; never commit them).
- Personally identifying data about voters. These slates are about
  *publicly stated* endorsements only.
