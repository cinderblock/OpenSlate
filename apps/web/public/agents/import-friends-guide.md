# Turn a friend's voter guide into an OpenSlate slate

You are an agent helping someone use a friend's voter guide in OpenSlate
(<https://openslate.us>), an app that lines up endorsements race by race on
their ballot. The guide can be anything: a spreadsheet, a PDF, a doc, a photo,
or pasted text. Your job is to read it and produce one `.slate` file they can
import. Everything happens on their machine; OpenSlate has no account or upload.

You need a shell with Node 20+ (or Bun) and internet access. If you can't run
commands, say so and stop: don't hand-write a signature. The person can run this
with a coding agent instead.

## Rules

- **Report the guide, never improve it.** No picks of your own, and nothing
  filled in for a race the guide skips.
- **Never guess.** If a row is unclear (two people share a surname, "Prop 3?"),
  leave it out and ask.
- **It's a report, not the friend's signature.** The slate says the person you're
  helping recorded what their friend's guide says. Always fill in `attribution`.
- **Keep it private.** Don't post the guide or the slate anywhere. The person
  decides who sees them.

## 1. Get the tool and the ballot

```sh
curl -fsSLO https://openslate.us/agents/openslate.mjs
node openslate.mjs races -o races.jsonl
```

`races.jsonl` has one race per line: the exact `subject`, how many to `vote_for`
or `ranks`, and `choices` as the ballot spells them. It's large, so search it
rather than reading it all. It defaults to the next election; add
`--election YYYY-MM-DD` for another.

## 2. Ask what you can't tell from the guide

- The friend's name, as it should appear in the app.
- The person's own name, for `issuer`.
- Which county or city the guide is for, if it's not obvious. Many race names
  repeat between counties, and that decides which line of `races.jsonl` is right.

## 3. Write positions.json

Find each of the guide's picks in `races.jsonl`, and copy that line's `subject`
**exactly, every field**. A race joins the ballot only on an exact match of title,
jurisdiction and election, so `Prop 1` will not join
`California — Proposition 1 (Authorizes Bonds for Housing Affordability Programs)`.

```json
{
  "context": {
    "election": "2026-11-03",
    "title": "Sam Rivera's voter guide"
  },
  "attribution": {
    "of": { "name": "Sam Rivera", "kind": "individual" },
    "mode": "transcribed",
    "retrieved_at": "2026-11-02T20:00:00Z"
  },
  "positions": [
    {
      "subject": { "title": "COPY FROM races.jsonl", "kind": "race", "jurisdiction": "us/ca", "election": "2026-11-03" },
      "stance": "endorse",
      "choice": "Name as the ballot spells it",
      "statement": "The friend's own reasoning, if the guide gives any."
    }
  ]
}
```

`retrieved_at` is the current time in UTC. If the guide lives at a public link,
add it as `"sources": ["https://..."]` in `attribution`.

| The guide says | Write |
| --- | --- |
| Vote for this candidate | `"stance": "endorse"`, `"choice": "<name>"` |
| Yes on a measure | `"stance": "endorse"`, `"choice": "Yes"` |
| No on a measure | `"stance": "endorse"`, `"choice": "No"` |
| Leaning toward, maybe | `"stance": "lean_for"` |
| Don't vote for this candidate | `"stance": "oppose"`, `"choice": "<name>"` |
| Leaning against | `"stance": "lean_against"` |
| Deliberately no recommendation | `"stance": "abstain"`, no `choice` |
| Nothing about the race | Leave it out |

Several picks in one race are separate positions. In a race with `ranks`, or if
the guide gives an order, add `"rank": 1`, `"rank": 2` and so on, on `endorse` or
`lean_for` positions only. If the guide has its own wording ("Strong yes"), keep
it as `"label": "Strong yes"` beside the closest stance. Put the guide's reasoning
in `statement`, in the friend's words, not a summary of yours.

## 4. Check it against the ballot

```sh
node openslate.mjs check positions.json
```

Fix every line it reports, usually by copying the title or name from `races.jsonl`
again. If it says a pick really isn't on the ballot, keep the pick only if the
guide is clearly recommending a write-in (add `"write_in": true`); otherwise take it
out and tell the person. Repeat until it passes. Count the guide's picks against
`positions` too: `check` can't see a row you missed.

"No ballot listing" means OpenSlate has no official list for that place, so
those titles can't be checked. They'll appear in the app, but may show as separate
races. Tell the person.

## 5. Sign it

```sh
node openslate.mjs keygen --name "THE PERSON'S NAME" --kind researcher -o signer.identity.json
node openslate.mjs sign positions.json --key signer.identity.json -o guide.slate
node openslate.mjs verify guide.slate
```

Name the output after the friend, such as `sam-rivera.slate`. If you redo this
later, reuse `signer.identity.json`. It holds a secret key: keep it, and never
share or commit it.

## 6. Hand it over

Tell the person:

1. Open <https://openslate.us> and go to **Sources**.
2. Under **Add endorsements**, choose **Link, file, QR or paste**.
3. Open the `.slate` file, or paste its contents, then press **Add to my sources**.

Their friend now shows on **My ballot** as a source, marked as reported rather than
signed by them. Finish with what you skipped or weren't sure of, and how many
picks made it in. A corrected slate imports as a second one, so they should remove
the old one from **Sources** first.
