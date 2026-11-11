# Group A — state results feeds for the 2026-11-03 general

Fetched 2026-11-10, about 3:08–3:40 PM PST (23:08–23:40Z). One line per state: code, status, platform, main feed URL, the one thing a programmer needs to know. Details and fixtures are in `<code>/findings.json` and beside it.

- **al** — `html-only` — html-only (ASP.NET WebForms) — https://www2.alabamavotes.gov/electionNight/statewideResultsByContest.aspx?ecode=1001305 — A GET only returns page 1 of 20 (10 contests); the other pages and "Export Data" are `__doPostBack` form POSTs, which were not exercised, so the export's format is unknown.
- **ak** — `works` — custom-csv (Dominion ENR export) — https://www.elections.alaska.gov/enr/26GENR/results/GA_ENR_Precinct_State_of_Alaska.csv — 3.3 MB precinct-level CSV with no statewide rows and no timestamp: sum `total_votes` per contest and candidate, use ETag/Last-Modified, and remember these are first-choice counts in a ranked-choice state.
- **az** — `works` — enhanced-voting — https://app.enhancedvoting.com/results/public/api/elections/Arizona/110326GeneralElection/data — Arizona moved this election to Enhanced Voting on app.enhancedvoting.com (the old results.arizona.vote is Cloudflare-challenged and only holds past elections); titles read "District No.  1" with a padded double space.
- **ar** — `works` — other:knowink-tally-enr — https://enr-results-api.totalresults.com/Contest/GetContestResults?cId=arkansas&electionID=11b07106-031e-4d7c-911a-d01fb473d6dd&contestType=Federal — Arkansas left Clarity (it now answers 403); counts come one `contestType` per call and carry only ids, so names must be joined from `Contest/GetContestSearchList`.
- **co** — `works` — clarity — https://results.enr.clarityelections.com/CO/127407/386671/json/en/summary.json — Standard Clarity (EID 127407 from `/CO/elections.json`, version from `current_ver.txt`); `PR`/`TP` count counties (64), not precincts.
- **ct** — `works` — custom-json (PCC EMS) — https://ctemspublic.tgstg.net/ng-app/data/election/108/53582/stateVotes_Electiondata.json — Read `election/108/Version.json` first, join ids through `Lookupdata.json`, and add a fusion candidate's party lines together (or read `candidateGrouping_Electiondata.json`); the lookup file contains candidates' home addresses.
- **de** — `works` — custom-json — https://elections.delaware.gov/results/enr/Election_StatewideResults_ID_GE2026.json — One flat array, a row per contest × candidate, keys with spaces and vote counts as strings with commas ("240,587"); already marked OFFICIAL RESULTS.
- **dc** — `works` — custom-json — https://electionresults.dcboe.org/cityWide/getCityWide/2026-General-Election — JSON served as text/plain; drop the "Write-in", "OVER VOTES" and "UNDER VOTES" rows, and note "UNITED STATES SENATOR"/"UNITED STATES REPRESENTATIVE CITYWIDE" are DC's shadow seats, not Congress (the real one is the Delegate).
- **fl** — `works` — custom-text — https://flelectionfiles.floridados.gov/enightfilespublic/20261103_ElecResultsFL.txt — Tab-delimited, a row per contest × county × candidate (sum for state totals); the host's TLS certificate expired 2026-11-09 6:09 AM PST (14:09Z), so every verifying client fails until the state renews it (fixtures were fetched with checking off).
- **ga** — `works` — enhanced-voting — https://results.sos.ga.gov/results/public/api/elections/Georgia/11032026GeneralAndSpecialElection/data — Standard Enhanced Voting `/data`, but the elections list is at `/api/jurisdictions/Georgia` (`/api/elections/Georgia` is 404), measures have `contestType` "Candidate", and some titles carry a Spanish suffix.

## Across the group

- CORS `*` only on Colorado (Clarity), Arkansas (Tally ENR API) and Delaware's open-data copy; everything else needs the relay.
- No feed needed a token, cookie or browser User-Agent. The plain relay User-Agent got 200 everywhere it was needed.
- Reporting units differ: counties in CO, GA and AZ; precincts in AR, DE, DC, FL (per county) and CT (polling places, statewide only); none usable in AK and AL.
- Enhanced Voting media exports are too big to poll (GA 47.5 MB, AZ 72.7 MB).
