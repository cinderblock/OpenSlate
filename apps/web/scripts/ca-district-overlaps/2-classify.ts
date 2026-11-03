// Step 2 of 3 for src/lib/ballotOrderCa.ts (California district overlaps for the
// ballot order). Run from apps/web, in order:
//   bun scripts/ca-district-overlaps/1-intersect.ts
//   bun scripts/ca-district-overlaps/2-classify.ts
//   bun scripts/ca-district-overlaps/3-emit.ts src/lib/ballotOrderCa.ts
// Work files go in the OS temp dir (openslate-district-overlaps). plans/ballot-order.md has the method.
// Classify each overlap: sliver (geometry noise), real, or check-by-population.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import area from "@turf/area";
import pc from "polygon-clipping";

const work = join(tmpdir(), "openslate-district-overlaps");
mkdirSync(work, { recursive: true });
process.chdir(work);
const R = 6371008.8;
const load = (n: string) =>
  JSON.parse(readFileSync(`cache/${n}.json`, "utf8")).features.map((f: any) => ({
    id: String(f.properties.BASENAME ?? f.properties.DISTRICT),
    geom: f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates,
  }));
function perim(ring: number[][]) {
  let p = 0;
  for (let i = 1; i < ring.length; i++) {
    const [x0, y0] = ring[i - 1]!,
      [x1, y1] = ring[i]!;
    p += Math.hypot(
      (((x1! - x0!) * Math.PI) / 180) * Math.cos((((y0! + y1!) / 2) * Math.PI) / 180) * R,
      (((y1! - y0!) * Math.PI) / 180) * R,
    );
  }
  return p;
}
function inRing(x: number, y: number, ring: number[][]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!,
      [xj, yj] = ring[j]!;
    if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) c = !c;
  }
  return c;
}
function inPoly(x: number, y: number, poly: number[][][]) {
  return inRing(x, y, poly[0]!) && !poly.slice(1).some((h) => inRing(x, y, h));
}
const BLOCKS =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/10/query";
async function population(pieces: number[][][][]): Promise<number> {
  let pop = 0;
  for (const poly of pieces) {
    if (pop >= 100) break;
    let [x0, y0, x1, y1] = [180, 90, -180, -90];
    for (const [x, y] of poly[0]!) {
      x0 = Math.min(x0, x!);
      y0 = Math.min(y0, y!);
      x1 = Math.max(x1, x!);
      y1 = Math.max(y1, y!);
    }
    for (let offset = 0; ; offset += 1000) {
      const p = new URLSearchParams({
        geometry: `${x0},${y0},${x1},${y1}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "GEOID,POP100,INTPTLAT,INTPTLON",
        returnGeometry: "false",
        resultOffset: String(offset),
        resultRecordCount: "1000",
        f: "json",
      });
      let j: any;
      for (let t = 0; t < 6; t++) {
        try {
          j = await (await fetch(`${BLOCKS}?${p}`)).json();
        } catch {
          j = {};
        }
        if (j.features) break;
        await new Promise((r) => setTimeout(r, 3000 * (t + 1)));
      }
      if (!j.features) throw new Error(JSON.stringify(j).slice(0, 300));
      for (const f of j.features) {
        const a = f.attributes;
        if (inPoly(Number(a.INTPTLON), Number(a.INTPTLAT), poly)) pop += Number(a.POP100);
      }
      if (j.features.length < 1000 || pop >= 100) break;
    }
  }
  return pop;
}
const popCache: Record<string, number> = existsSync("popcache.json")
  ? JSON.parse(readFileSync("popcache.json", "utf8"))
  : {};
const sets: Array<[string, string, string]> = [
  ["cd", "ad", "cdAd"],
  ["boe", "ad", "boeAd"],
  ["sd", "county", "sdCounty"],
  ["ad", "county", "adCounty"],
];
const ov = JSON.parse(readFileSync("overlaps.json", "utf8"));
const out: Record<
  string,
  Array<{ a: string; b: string; km2: number; width: number; pop?: number; verdict: string }>
> = {};
for (const [an, bn, key] of sets) {
  const A = load(an),
    B = load(bn);
  out[key] = [];
  for (const o of ov[key]) {
    const a = A.find((x: any) => x.id === o.a),
      b = B.find((x: any) => x.id === o.b);
    const inter = pc.intersection(a.geom, b.geom);
    const pieces = inter
      .map((poly) => ({ poly, ar: area({ type: "Polygon", coordinates: poly } as any), w: 0 }))
      .map((p) => ({ ...p, w: (2 * p.ar) / perim(p.poly[0]!) }));
    const width = Math.max(...pieces.map((p) => p.w));
    const real = pieces.filter((p) => p.w >= 2);
    let verdict: string, pop: number | undefined;
    if (width < 2) verdict = "sliver";
    else {
      const ck = `${key}|${o.a}|${o.b}`;
      pop = popCache[ck] ?? (await population(real.map((p) => p.poly)));
      popCache[ck] = pop;
      writeFileSync("popcache.json", JSON.stringify(popCache));
      verdict = pop >= 100 ? "real" : pop > 0 ? "real-small" : "empty";
      console.error(key, o.a, o.b, width.toFixed(1), o.km2.toFixed(3), "pop", pop);
    }
    out[key].push({
      a: o.a,
      b: o.b,
      km2: o.km2,
      width,
      ...(pop !== undefined ? { pop } : {}),
      verdict,
    });
  }
}
writeFileSync("classified.json", JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out))
  console.log(
    k,
    Object.entries(Object.groupBy(v, (x) => x.verdict)).map(([verdict, rows]) => [
      verdict,
      rows?.length,
    ]),
  );
