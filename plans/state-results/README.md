# What each state's election office publishes

Research for `plans/national-scale.md` step 9 ("every state's results"), done
2026-11-10, a week after the 2026-11-03 general, when every state's unofficial
results were up.

- `<code>.json`: one file per state (postal code, lower case). The office, its
  results page, the platform, the exact feed URLs that were fetched, whether
  they answer a browser (CORS) and a non-browser client, where the election's
  id sits in the URLs and how the next election's would be found, how contests
  and choices are worded, and what was tried along the way.
- `group-A.md` to `group-E.md`: one line per state, and what cut across
  states.

`status` in each file: `works` (a machine-readable feed with real numbers was
fetched), `blocked` (it exists but refuses a non-browser client), `html-only`
(the numbers are only in web pages), `none` (the state office publishes no
live statewide count).

Which of these the app reads is `STATE_FEEDS` in
`packages/core/src/stateResults.ts`. The fetched files themselves aren't kept
here: a parser's test fixture is cut from the feed when the parser is written
(`packages/core/test/fixtures/state/`).

These are a snapshot. Offices change platforms between elections (Arizona,
Georgia and Washington moved to Enhanced Voting since 2024), so check a state's
page again before trusting its file.
