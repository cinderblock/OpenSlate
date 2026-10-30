# Issues

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

## The catalog copy verifies on the page, and workers would halve the wait

Seen 2026-10-30 building Compare. `createCatalogLoader` (`lib/catalogCopy.ts`)
checks every signature on the main thread in 12 ms slices. In a production worker
on a 12-core desktop, 349 slates took 4.3 s on 1 thread, 1.9 s on 4 and 1.5 s on 8,
and a phone is several times slower. It's once per catalog version, but it's the
first thing a voter waits for on Compare and All races. A worked version of the
pool is on the local branch `ballot-alignment-worker-pipeline`
(`lib/comparison.ts` `verifyAll`). A worker can't import `collate.ts` today:
`subjects.ts` pulls in React and the database, so `subjectKey` needs its own file.
