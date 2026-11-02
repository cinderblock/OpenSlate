# Showing that ballot measures interact, without taking a side

## Goal

Props 40, 41 and 42 (California, 2026-11-03) are legally connected: the outcome of 40 can depend
on the yes votes for 41 and 42. A voter deciding on any one of them should find that out without
going looking, and OpenSlate should say it without taking a position on any of the three.

Asked by the user on 2026-11-01, two days before the election. Nothing is built yet. The first proposal
was rejected as not neutral on 2026-11-02; see "Superseded proposal".

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

### Content-blind links, tested across the catalog (2026-11-02)

Of 152 articles, 8 are attached to more than one subject, giving 16 pairs of measures. No rule about
these props went into this:

| Measures | Articles in common | Publishers |
| --- | --- | --- |
| 40, 41, 42 (each pair) | 4 | 3 |
| 3 and 40 | 2 | 2 |
| SF D, E, F (each pair) | 2 | 2 |
| 1, 37, 38 (each pair) | 1 | 1 |
| 3, 40, 41, 42 with 43; 3 with 41 and 42 | 1 | 1 |

Across all 14 statewide props, the guide names another measure only in these places: the analyses of 40,
41 and 42, and the "No" arguments on 41 and 42. No "Yes" argument names one.

## Superseded proposal

The first proposal was a note quoting the Analyst, pinned under the overview of these three measures,
plus a line on their My ballot cards, an `interactions` guide field, and a bar of "an official analysis
names the measure". The user rejected it as not neutral on 2026-11-02, and that's correct:

- Choosing one fact and pinning it high is editorial, even when every word is quoted.
- Hand-built data for three measures singles them out. Who gets a note becomes our decision.
- The Analyst's framing casts 40 as the measure at risk. Promoting it does more than report it.
- Making the voter aware is useful to one side's campaign, so "just informing" isn't a neutral act here.
- Rating the "No" arguments as "campaign framing" that a note should counter was itself a judgment.

## Decisions proposed (not yet approved)

1. **OpenSlate adds no sentence and picks no measure.** Every change is a rule that runs on every race and
   doesn't know what any race is about.
2. **Show coverage, not meaning.** Counts of shared articles claim only that publishers covered the two
   together.
3. **Accept the cost.** A voter gets a pointer, not an explanation, and has to follow it to learn why.

## Plan / steps

1. Article list on every race: "Articles here also cover Prop 41 (4), Prop 42 (4), Prop 3 (2), Prop 43 (1)",
   linked, ordered by count. Computed in `articles.ts`. Shown for any race with a shared article.
2. Guide text: turn any mention of another measure on the ballot into a link, on every measure. The text is
   unchanged.
3. Guide figures that are only text: render the words in place, in the same collapsed section, for every
   measure. An accessibility fix that moves nothing.

Limits to keep in view: article subjects are assigned when bundles are built, so step 1 reflects those
signed claims and what publishers chose to cover. Step 2 will show links on the "No" side only for 41 and 42,
because that's who wrote them.

## Progress log

- [x] Trace what the app shows, and what the guide, news and endorsers say
- [x] Test content-blind links across the catalog
- [ ] User's go-ahead on steps 1 to 3
- [ ] Steps 1 to 3

## Open questions for the user

1. Build steps 1 to 3 before the election? Recommendation: yes. They are small, and useful in later elections.

## Things not to do

- Don't add a note, banner or heading of our own about these measures.
- Don't add a hand-curated relation between measures, even one quoting official text.
- Don't vary anything by the voter's picks.
- Don't write our own summary of what happens if each combination passes.
- Don't pin or rank the explainer articles (SPEC §3.15).
- Don't group the three under a label such as "billionaire tax measures".
