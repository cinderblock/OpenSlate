# Showing that ballot measures interact, without taking a side

## Goal

Props 40, 41 and 42 (California, 2026-11-03) are legally connected: the outcome of 40 can depend
on the yes votes for 41 and 42. A voter deciding on any one of them should find that out without
going looking, and OpenSlate should say it without taking a position on any of the three.

Asked by the user on 2026-11-01, two days before the election. Nothing is built yet; this is the
finding and the proposal.

## Environment / context

- Guide data: `openslate-ballot-ca-2026-11-03/guide/items/prop-NN.json`, schema in
  `packages/core/src/guide.ts`, signed with the repo's own key.
- Measure text: `guide/pdf/prop-NN-text.pdf`. Each PDF carries the neighbouring measures' pages,
  so attribute a clause by the `PROPOSITION NN This initiative measure` heading, not the file name.
- Race page: `apps/web/src/components/RacePanel.tsx`. Guide rendering:
  `apps/web/src/components/GuideContent.tsx`. Articles: `apps/web/src/lib/articles.ts`, SPEC §3.15.
- News bundles: `openslate-public-endorsements/orgs/<slug>/2026-11-03/positions.json`, `articles`.
- Findings below come from the data and code at HEAD. The live site was not opened.

## Findings

### What the official sources say

The Legislative Analyst's analysis of all three measures has a boxed figure, "Potential Interactions
With Other Propositions". Prop 40's reads:

> If Proposition 41 or 42 on this same ballot receive more "yes" votes than Proposition 40, then
> Proposition 40 could be stopped from becoming law even if it gets yes votes from a majority of
> voters. This is because the courts could find that Proposition 41 or 42 conflict with Proposition 40.

41's and 42's say the same about themselves. These are the only three analyses that name another
measure on the ballot.

Conflict clauses in the measure text:

| Prop | Section | Treats as conflicting |
| --- | --- | --- |
| 3 | §5 | Measures affecting personal income tax rates |
| 37 | §6 | Measures authorizing revenue bonds for middle-class housing loans |
| 40 | §8 | Measures taxing billionaire net worth, or using funds from such a tax. Voids only "conflicting provisions" |
| 41 | §5 | Different audit rules on special taxes, or a state tax exempt from the spending limit. Voids "all the provisions" |
| 42 | §5 | Taxes on retirement holdings, assets and savings, or retroactive taxes. Voids "all the provisions" |
| 44 | §10 | Measures governing Mission Spend Ratio at clinics |
| 45 | §2 | Measures on review or approval of essential projects |

Only 40, 41 and 42 have a clause an official analysis ties to a named measure on this ballot.

The background rule is Cal. Const. art. II §10(b): where measures approved at the same election
conflict, the one with the highest affirmative vote prevails. Commentary points to art. XVIII §4 for
constitutional amendments, and *Taxpayers to Limit Campaign Spending v. FPPC* (1990) reads §10(b)
narrowly. All three measures amend the constitution, so don't paraphrase the law; quote the Analyst.

### Discoverability today

| Where | What a voter sees |
| --- | --- |
| Prop 40 overview, Yes/No meanings, official summary | Nothing |
| Prop 40 Analysis | A JPEG, inside a collapsed section. Browser find can't reach it |
| Prop 40 arguments | No mention of 41 or 42 |
| 41 and 42 official summary | "other voter-approved measures", collapsed, doesn't name 40 |
| 41 and 42 "No" arguments | Open by default: "billionaire-funded scheme designed specifically to undo" Prop 40 |
| 41 and 42 "Yes" arguments | No mention of 40 |
| In the news | The links exist, but only as headlines in date order |
| Endorser statements | Some mention it, in their own framing |
| My ballot | Nothing |

So the neutral statement is the most buried and the campaign framing is the most visible.

### News we have

152 articles in the catalog, 30 touching these props. Four cover the link directly, each attached to
40, 41 and 42:

- The Mercury News, 2026-09-23: "...wealth tax faces double threat from competing measures 41 and 42"
- CalMatters, 2026-09-24: "The billionaire tax could be defeated by two other tax measures. Here's how"
- San Francisco Chronicle, 2026-10-17: "What does 'yes' or 'no' on Prop 40 really mean? It depends on
  your votes on two other props"
- CalMatters, 2026-10-05: "5 tax measures are on the California ballot" (also attached to 3 and 43)

The headlines of the LA Times Prop 41 guide and the Sacramento Bee Prop 42 guide also point at it. None
of the 30 has a `summary`. On Prop 40's list of 22 the Chronicle piece is sixth and the Mercury News and
CalMatters explainers are around 16th, because the list is newest first.

Setup brings news bundles along automatically (`GetStarted.tsx`, `missingNews`). Someone arriving by a
shared link with nothing imported sees no articles unless they open "See all slates".

Endorsers stating the link include California Association of Realtors, Working Families Party ("Poison
Pill"), CPEHN, Westside Forward, Friends Committee on Legislation, and the LA Area Chamber, which supports
41 and still writes "Designed to block Prop 40".

### Gotchas

- The state's `alt` text for Prop 40's figure isn't verbatim: it misspells "Propostion" (in the source
  HTML, `evidence/propositions/40/analysis.htm`) and ends "conflict with 40". Transcribe from the image.
- The guide schema has no field for a relationship between items.
- `raceSearchText` doesn't include guide text or articles.

## Decisions proposed (not yet approved)

1. **Show the mechanism, never the motive.** The note quotes the Analyst verbatim. "Poison pill",
   "designed to block" and "competing" stay in attributed sources.
2. **The bar is an official analysis naming the measure,** or measure text naming it by number. We don't
   judge whether two measures conflict. That leaves 40, 41 and 42 this election. Prop 3's clause and
   Prop 40's "net worth, not income" wording don't qualify, and the other clauses have no named partner.
3. **The same note whatever the voter picked.** No warning for Yes on 40 plus Yes on 41: that's a coherent
   choice, and calling it a problem is an opinion.
4. **Plain styling.** No warning colour or icon, no change to sort order, no effect on alignment scores.
5. **The data lives in the signed guide, not in app code.** It keeps the source and signer attached, and
   other elections can use it without an app change.

## Plan / steps

1. Guide schema: optional `interactions` on an item: the subjects it names, plus a `Passage` carrying
   `by`, `blocks` and `source`. Document it in SPEC.
2. Ballot repo: add it to prop-40, 41 and 42 with the Analyst's text, transcribed from the figures. Re-sign.
3. Race page: render it directly under `GuideOverview`, headed "Interacts with Prop 41 and Prop 42", linking
   each measure, attributed to the Legislative Analyst.
4. My ballot: one quiet line on those three cards linking to the note. `no-print`.
5. Replace the JPEG in the Analysis with real text, so find and screen readers get the same words.
6. After the election, for any measure: on an article attached to several races, show "Also about Prop 41,
   Prop 42". It's derived from existing data with no curation. Label it as coverage, not a legal link.

Steps 1 to 5 are the set worth shipping before 2026-11-03. Step 6 can wait.

## Progress log

- [x] Trace what the app shows, and what the guide, news and endorsers say
- [ ] User's go-ahead on the proposed decisions
- [ ] Steps 1 to 5
- [ ] Step 6

## Open questions for the user

1. Build steps 1 to 5 now, before the election? Recommendation: yes.
2. Is the Analyst's text enough, or should the note also link the measure text's conflict clauses?
   Recommendation: the Analyst's text alone; it's the only version written for voters.

## Things not to do

- Don't write our own summary of what happens if each combination passes. The law here is unsettled and
  the Analyst says "could".
- Don't pin or rank the explainer articles: that's curation (SPEC §3.15).
- Don't group the three under a label such as "billionaire tax measures".
- Don't treat every "Conflicting Measures" clause as an interaction. Most are boilerplate with no partner
  on the ballot.
