# Issues

## Local measures outside the covered counties have no official text

Seen 2026-10-26: My ballot links a measure's official text only when a voter
guide in `guides.json` lists it (state, SF, LA, OC, Alameda, San Diego, Santa
Clara, San Mateo). A local measure in any other county gets only Ballotpedia,
CalMatters and news searches, which often have nothing on small city
measures. Matters because a voter asked for "a link to the measure text for
all the measures, especially the local ones".

## Cloudflare's analytics beacon is injected and then blocked by our CSP

Every page on https://openslate.us logs a console error (seen 2026-10-23,
3:32 AM PDT (10:32Z), in a fresh incognito tab):

> Loading the script 'https://static.cloudflareinsights.com/beacon.min.js/…'
> violates the following Content Security Policy directive: "script-src 'self'".

Cloudflare injects its Web Analytics beacon into the HTML, and
`apps/web/public/_headers` deliberately allows only our own scripts. So the
beacon never runs (no analytics are collected that way) and every visitor's
console shows an error. Either turn off the automatic beacon injection for
the zone (a Cloudflare setting: needs the owner's authorization, through the
ops repo), or decide to allow it in the CSP (which the `_headers` comment rules
out on purpose).

## Council seats voted citywide may be tagged as districts

Seen 2026-10-27 (`plans/council-districts-lookup.md`): the OC listing files
Newport Beach's council races as `district: us/ca/newport-beach/council-N`,
but its districts are residency districts every voter in the city votes on
(the Registrar's own layer says so). Registrars title such seats "District N"
too, so `scripts/lib/districts.ts` in the endorsements repo can't tell from
the title. Two more to check before their cities' council maps join the
lookup (both are left out of `build-geo.ts` until then): Huntington Park
"City Council, District 2" (the city says 2026 elects only 4 and 5) and San
Leandro "City Council, District 2 (Short Term)" (Measure F, June 2026, moved
1, 3 and 5 to district elections). A district tag on a seat voted citywide
hides it from every voter outside that district once the lookup knows the
city's districts; for Newport Beach, today, its seats are *Might be on your
ballot* when they're on everyone's.

## Some cities' council districts have no usable map

Seen 2026-10-27: the council lookup (`OTHER_SOURCES` in
`apps/web/scripts/build-geo.ts`) leaves out cities whose listings carry
`council-N` races but that publish no usable current map, so those races stay
*Might be on your ballot*: Campbell (no public layer; the 2019 map, re-adopted
2022, only in its consultant's web map, numbering unchecked), Los Altos
(parcel layer without geometry; Map F2a, 2024), Morgan Hill (consultant's
"Adopted 2022" layer is block pieces with gaps; PDF only otherwise), Santa
Clarita (only "Map_113" in a consultant web map, final version unconfirmed;
PDF `filecenter.santa-clarita.com/GIS/citycouncildistricts.pdf`). Details in
`plans/council-districts-lookup.md`.
