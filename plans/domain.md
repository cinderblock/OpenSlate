# Project domain

`plans/domain.md`

## Goal

Pick and register a domain for OpenSlate so the web app, the poll-cache
Worker (`plans/polls-cache-worker.md` step 4), and the public endorsements
catalog (`plans/openslate-public-endorsements.md` follow-up 2) can move off
`*.github.io` / `*.workers.dev` before the 2026-11-03 general election. A
domain root also enables `/.well-known/openslate.json` domain attestation
(SPEC §7).

## Environment / context

- Infra is on Cloudflare (Workers, Pages-capable). Any registrar works; NS can
  point at Cloudflare. Cloudflare Registrar sells at cost but supports fewer
  TLDs.
- Registering, DNS, and Cloudflare changes need the user's explicit
  per-change yes (global CLAUDE.md). This doc only records research.

## Decisions already made (don't re-ask)

- User likes the name "OpenSlate" and would rather keep it. Renaming is on
  the table only if no acceptable domain exists.
- `openslate.vote` was the user's first choice. It's taken.

## Findings (availability sweep, 2026-10-14)

Method: registry RDAP via the IANA bootstrap (`data.iana.org/rdap/dns.json`),
with port-43 whois for ccTLDs that have no RDAP. `rdap.org` rate-limits
(Cloudflare error 1015) after about 20 queries, so query the registries
directly. A whois regex for "available" gave false positives on .io/.me
because the boilerplate contains that word, so check the raw output.

### Taken

| Domain | Registered | Notes |
| --- | --- | --- |
| openslate.com | 1999-12-21 | AWS DNS, long-held |
| openslate.vote | 2026-09-02 | Namecheap, no site |
| open-slate.vote | 2026-09-02 | Namecheap, no NS |
| open-slate.org | 2026-09-02 | Namecheap, no site |
| openslate.org | 2026-06-26 | Afternic for-sale lander. Price not checked (JS-rendered) |
| openslate.xyz | 2026-06-27 | Afternic, for sale |
| openslate.dev | 2026-08-28 | Cloudflare Registrar, no site. Not the user's (no receipt in Gmail) |
| openslate.app | — | Someone's classroom-response app |
| openslate.online | 2026-10-11 | Vercel, a fantasy-sports "Open Slate" |
| openslate.net | 2026-01-31 | NameBright |
| openslate.ai | 2024-12-02 | Cloudflare |
| openslate.world | 2026-02-04 | |
| openslate.ca | 2026-07-27 | GoDaddy |
| openslate.io, .me, .co | — | |

The 2026-09-02 cluster: `openslate.vote`, `open-slate.vote` and
`open-slate.org` were all registered at Namecheap on the same day, which
suggests a single registrant. The `.org`/`.xyz` pair on Afternic were
registered a day apart in late June, a typical speculator pattern. Either
could in principle be bought: Afternic listing, or a Namecheap
WHOIS-privacy contact for the .vote owner.

### Available (registry 404 / whois "not found")

- **openslate.\***: `.us`, `.page`, `.info`, `.guide`, `.tools`,
  `.community`, `.network`, `.foundation`, `.voto`, `.democrat`, `.party`,
  `.one`, `.to`, `.fyi`, `.social`, `.cc`, `.sh`, `.ing`
- **Variants**: `openslates.org`, `openslates.vote`, `getopenslate.org`,
  `getopenslate.com`, `useopenslate.org`, `useopenslate.com`,
  `theopenslate.org`, `openslateproject.org`, `signedslate.org`
- **.vote, other names**: `slate.vote`, `slates.vote`, `myslate.vote`,
  `yourslate.vote`, `endorse.vote`, `endorsements.vote`

"Available" means unregistered at the registry. Short names like
`slate.vote` may be registry-premium. Confirm the price at a registrar
before counting on it.

## Open questions for the user

1. Which domain? (Options and recommendation are in the thread.)
2. Make an offer on `openslate.vote` / `openslate.org`, or skip?

## Things not to do

- Don't register, change DNS, or touch Cloudflare without explicit
  per-change approval.
- Don't trust `rdap.org` "000"/1015 results as availability. That's rate
  limiting.
