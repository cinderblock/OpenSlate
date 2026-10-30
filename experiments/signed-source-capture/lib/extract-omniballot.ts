// A pure extractor: bytes in, the same JSON out, no clock, no network. This is the transformation
// `scc-rov-ballot.ts --fetch` applies to OmniBallot's lookups.json, lifted out so it can be re-run
// on a captured response.

const OMNI = "https://ca.omniballot.us";

interface Lookups {
  measure_details: Record<string, { url: string; title: { value: string }[] }>;
}

export function extractMeasures(decodedBody: Buffer, sourceUrl: string): string {
  const lookups = JSON.parse(decodedBody.toString("utf8")) as Lookups;
  const measures = Object.entries(lookups.measure_details).map(([box, m]) => ({
    box,
    name: (m.title[0]?.value ?? "").replace(/\s+/g, " ").trim(),
    url: `${OMNI}${m.url}`,
  }));
  return `${JSON.stringify({ url: sourceUrl, measures }, null, 2)}\n`;
}
