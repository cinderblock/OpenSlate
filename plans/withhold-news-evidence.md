# Keep news captures out of the public catalog

## Goal

The public endorsements repo and its Pages site published whole captured news pages under
`orgs/<slug>/<election>/evidence/`, while `openslate-source-captures` keeps the same pages private
because they're "others' copyrighted work". Before the site is announced, make the catalog follow
the same rule: publish a hash, the source URL and the size, and keep the text private. Add a public
way to ask for something to be taken down.

## Environment / context

- Public: `cinderblock/openslate-public-endorsements` (Pages site, the catalog).
- Private store: `cinderblock/openslate-source-captures-private` (confirmed `PRIVATE`). Evidence text
  goes in `evidence/<slug>/<election>/`, beside the raw `blobs/`.
- The rule to mirror is `openslate-source-captures/src/sources.ts`: a host is withheld if a
  `news_organization` or `editorial_board` bundle cites it, or it's in `withheld-hosts.json`.
- `kind` alone isn't enough: many papers are `kind: organization` (Bakersfield Californian, Press
  Democrat, SCNG). The host rule catches those, and a party or union bundle citing a news page.
- Takedown requests go to GitHub issues in `cinderblock/openslate`.

## Decisions already made (don't re-ask)

User, 2026-10-30:

1. Publish news captures only as hash, URL and timestamp; the text moves to the private repo.
2. Remove them from the site and repo with a normal commit. **No force-push**: they stay in git
   history, and that's accepted.
3. Takedown contact: GitHub issues.

Not in scope: trimming `statement` quotes (after the election, undecided); Facebook and Instagram
evidence (private in the captures repo for personal data, not copyright).

## Plan / steps

1. `scripts/lib/withheld-evidence.ts`: the rule, unit-tested.
2. `scripts/withhold-evidence.ts`: moves matching files, writes `evidence/withheld.json`.
3. `verify-positions` fails on a news capture in `evidence/`, so publish fails closed (both workflows
   run it). Only that check stops a new bundle publishing one.
4. Evidence page lists withheld files; evidence pages and the site index link the takedown form.
5. Run it, commit the private store first, then the public removal.
6. Takedown issue template and footer link in the app; READMEs.
7. Scraper skill and the Nov 1 re-scrape notes.
8. Check the live site serves 404 for a removed page.

## Findings / gotchas

- `articles.md` stays public: its header says "No article text is kept here", only headline, byline
  and the researcher's own note. Same for `NOTES.md`, which is the researcher's writing.
- Hashes are over LF text. The working tree is CRLF on Windows, so hashing the file as it sits would
  never match a copy from git.
- `orgs/sd-green-party/2026-11-03/` was untracked another thread's work when this ran; it was
  skipped, and its KPBS capture needs the same treatment when it's committed. The verify check says
  how.

## Progress log

- [ ] 1–4 code and tests
- [ ] 5 move
- [ ] 6 takedown
- [ ] 7 skill and notes
- [ ] 8 live check

## Things not to do

- Don't force-push or rewrite history in the public repo.
- Don't hash CRLF working copies.
- Don't delete the text anywhere: the private store is its only remaining current copy.
