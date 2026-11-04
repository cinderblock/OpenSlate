# Truncated statements: re-quote, enforce, link

## Goal

Silicon Valley DSA's Prop 44 statement showed as "No recommendation. The nonprofit federally
qualified health centers". The scrape had cut the guide's paragraph mid-sentence, with no mark that
anything was missing, and the app had no link to the source. The user's ruling (2026-11-03): cutting
a source's words without an indicator, and without a link to the source, is editorializing and is
not acceptable. So:

1. Re-quote SVDSA's statements in full and re-sign (CI signs on push).
2. Make it impossible to happen again: a failing check, not a warning.
3. Fix every other slate the check catches.
4. The app always links a statement to its source.

## Environment / context

- Data: `~/git/Personal Projects/openslate-public-endorsements` (`orgs/<slug>/<election>/positions.json`,
  `evidence/*.md` committed verbatim page text). CI `publish.yml` runs `bun run test`, then
  `bun scripts/verify-positions.ts`, then signs every slate. CI has no captured bytes and no private
  store, so in CI the check reads the committed `evidence/*.md` only.
- Saved news pages live in `openslate-source-captures-private/evidence/<slug>/<election>/`. Pass
  `--private ../openslate-source-captures-private` (requote) or set
  `OPENSLATE_CAPTURES_PRIVATE_DIR` (verify) to include them.
- App: `apps/web/src/components/Statement.tsx` renders a statement and its source link. It's used by
  `ChoiceRow.tsx` (chip popovers) and `PositionRow.tsx` (race page). `RacePosition.sourceUrl` in
  `lib/collate.ts` carries the position's `source`.

## Decisions already made (don't re-ask)

- Re-signing is fine, even on election day (memory: resigning ok).
- Truncation without an indicator = editorializing: never acceptable. Any omission inside a quote
  is marked with an ellipsis (…), and the source is always one click away.
- The check fails the build (it's not a warning).
- Standard: the **whole passage** (paragraph, list line or table cell), not merely whole
  sentences. One sentence of a longer paragraph is a cut. Past 1,500 characters, whole sentences
  plus "…" are fine.

## Design (as built)

- **Check** (`openslate-public-endorsements/scripts/lib/quote-bounds.ts`). The quoted parts of a
  statement are its straight-quote pairs, then curly pairs outside them, or the whole statement. A
  statement that opens unquoted and is found whole is checked whole. Each part, split on
  ellipses, is located through a comparable-form index that maps back to the source's characters.
  Passage ends: a newline, `|`, a tab, 2+ spaces, or the start/end of text. Also the source's own
  quotation marks, but only when they enclose the words on both sides. In a line of 200 characters
  or less, list separators count too (`:`, `—`, `–`, `·`, `•`, `/`, brackets, check marks, ` - `),
  but never `.`, `!`, `?` or `;`.
- **Evidence text** (`scripts/lib/evidence-text.ts`): evidence `.md` files except NOTES.md, plus the
  private store. Hard-wrapped lines outside fences are joined when the line above is 60+ characters,
  doesn't end its sentence, and the next line starts in lower case.
- **Verify** (`scripts/verify-positions.ts`): an unmarked cut fails, and so does a statement with no
  `source`, in bundles that have `evidence/`.
- **Fix tool** (`scripts/requote-statements.ts`): widens to the whole passage, verbatim. It nests the
  source's own double quotes as single ones, and merges two quotes that widen to one passage. When
  the words appear in several passages, it places the quote by the statement's other quotes;
  otherwise it lists the statement for a person.
- **SPEC §3.4**: a quoting statement is whole or marks omissions. Consumers show `source` with it and
  never shorten one silently (changelog 2026-11-03).
- **App**: "Read it at <host> ↗" under every statement with an http(s) `source`. `get_race` (WebMCP)
  returns `source_url`.

## Progress log

- [x] Plan doc
- [x] quote-bounds checker + tests (`scripts/lib/quote-bounds.test.ts`, 16 tests)
- [x] Wired into verify-positions.ts as a failure; proved it fails on the old SVDSA file
- [x] Survey, then re-quote: 881 widened mechanically and 19 by hand, 900 statements in 79 files
  (public `7fb692b`). Lost-words check: the only quoted words dropped were OC BizPAC's old "State
  Assembly" card text, which the page now prints as "State Senate".
- [x] Guard committed (public `184d165`). Publish run 41745749776 green, 2026-11-03 4:17 PM PST
  (2026-11-04 00:17Z)
- [x] Live check: the published SVDSA `signed.slate` verifies and carries the full Prop 44 paragraph
- [x] BANG Santa Clara section saved from capture run 2026-11-03T1300Z (private repo, withheld)
- [x] Skill text: whole passages, ellipses, no hard wraps
- [x] SPEC §3.4 wording + changelog
- [x] App: source link (headless Chrome check on the Prop 44 race page: links render under every
  statement)
- [x] ISSUES.md: June slates with no sources; statements the check can't see
- [x] Commit + push OpenSlate (`9c16e86` app, `e011618` SPEC + skill, `f1fe913` ISSUES + plan). Checks run 41747142548 green
- [x] `.openslate-version` bump in the endorsements repo: not needed. The
  guard lives in that repo and doesn't use the app or SPEC code.

## Findings / gotchas

- 11,829 statements in 413 bundles. Most that don't end in punctuation are list entries ("Governor:
  Xavier Becerra"), not cuts. A "does it end in a period" rule would be wrong, so the check reads
  the source.
- First pass (sentence ends counted as boundaries in short lines): 744 cuts in 64 bundles. Taking
  `.` out of the short-line separators found 165 more, including name lists cut at abbreviation
  periods ("Chou, Tara M. Desautels" from "Tracie L. Brown, Gordon B. Burns, Danny Y. Chou, Tara M.
  Desautels").
- The source's own quotation marks as a boundary let `…warns "if this` pass. Fixed: they count
  only when they enclose the quote on both sides.
- A curly-quoted name inside a straight-quoted part (`Donald P. “Don” Wagner`) split the part at
  `”`. Fixed by pairing straight with straight and curly with curly.
- Merging duplicates by "contained in an earlier part" dropped short unwidened parts such as LA
  County GOP's `"NO"`. Fixed: only widened parts merge. The whole re-quote was then re-run from HEAD
  (safety stash "requote: before re-running widening from HEAD").
- Full markdown paragraph joining broke one-entry-per-line pages (SF League, CA Labor Fed). Only
  lower-case continuations join now.
- Boilerplate sentences repeat across candidates (IE United "proudly supports his candidacy for
  City Council Ward 2."). Widening must not guess. Ambiguous ones went to the hand list.
- Some pages are themselves excerpts ("…allied organ…" + "Read More" on SF Rising Action). Quoted
  verbatim. The page's own ellipsis is the indicator.
- Sierra Club SF Bay's evidence has a researcher `[...]` in it, so its statement keeps the elision.
- 1,345 statements (1,829 without the private store) aren't found in the evidence at all, so the
  quoting check can't judge them. Logged in ISSUES.md.

## Things not to do

- Don't change `comparable()`/`anchorStatement()` in `source-text.ts`: it's a copy of the captures
  repo's canonical text code, and verifiers have to get the same answer.
- Don't hide a long statement behind a visual clamp with no "show more" indicator. That's the same
  bug again.
- Don't count `.`/`!`/`?`/`;` as passage ends, even in short lines.
- Don't let widening pick between passages that share the same words.
- Don't write multi-line edit scripts as bash heredocs with backslashes. Use the Write tool.
