# Signed source capture: spikes

Research spikes for [`plans/signed-source-capture.md`](../../plans/signed-source-capture.md), which
holds the findings, the output of each run and the recommendation. Nothing here ships, and this
directory isn't a workspace member. Install once with `bun install` in this directory, then run
everything from the repository root.

| Script | Question it answers |
| --- | --- |
| `01-forge-saved-handshake.ts` | Can a saved TLS handshake prove what a server sent? (No: it forges a response that passes the strictest possible verifier.) |
| `02-witness-relay.ts` | What stops that forgery? (A witness on the network path, for as long as the witness is honest.) |
| `03-survey-hosts.ts <endorsements checkout>` | What do the cited sources look like on the wire? Writes `results/host-survey.json`. |
| `04-capture-and-stamp.ts <dir> <url>...` | Capture verbatim and timestamp the manifest with two authorities. |
| `05-verify-bundle.ts <dir> [--expect <file>]` | Verify a bundle with the network off, optionally re-running the OmniBallot extractor. |
| `06-verify-sigstore-offline.ts <dir>` | Verify a real, already public Sigstore bundle with the network off. |
| `07-anchor-positions.ts <dir> <positions.json>` | Are a slate's statements really in the captured text? |

`capture-workflow.example.yml` is the shape of the CI witness. It's deliberately outside
`.github/workflows`, so it doesn't run.

## Try it offline

These use only what's committed under `results/`:

```sh
bun experiments/signed-source-capture/05-verify-bundle.ts experiments/signed-source-capture/results/example-json
bun experiments/signed-source-capture/06-verify-sigstore-offline.ts experiments/signed-source-capture/results/sigstore-example
```

`.gitattributes` here matters: `results/**` is marked `-text` because Git's line-ending
conversion silently rewrites captured bytes, after which the proofs correctly stop verifying.

`01`, `02`, `03` and `04` make real requests. Keep them to one or two per site, and keep the
descriptive user agent. The forged body in `01` and `02` is an obvious marker, never anything an
organization might have said, and forged bundles are never written to disk.
