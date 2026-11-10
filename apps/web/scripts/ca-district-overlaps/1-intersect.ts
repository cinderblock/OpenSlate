// Step 1 of 3 for src/lib/regions/us-ca/districtOverlaps.ts (California district overlaps for the
// ballot order). Run from apps/web, in order:
//   bun scripts/ca-district-overlaps/1-intersect.ts
//   bun scripts/ca-district-overlaps/2-classify.ts
//   bun scripts/ca-district-overlaps/3-emit.ts src/lib/regions/us-ca/districtOverlaps.ts
// Work files go in the OS temp dir (openslate-district-overlaps). plans/ballot-order.md has the method.
// Which ADs each CD / BOE / SD touches, and which counties each SD / AD touches.
// TIGERweb geometry at ~1 m; intersection areas in km², so slivers can be told apart.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import area from "@turf/area";
import pc from "polygon-clipping";

const SERVICE =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer";

import { tmpdir } from "node:os";

const work = join(tmpdir(), "openslate-district-overlaps");
mkdirSync(work, { recursive: true });
process.chdir(work);
const cache = join(work, "cache");
mkdirSync(cache, { recursive: true });

type Feat = { id: string; geom: pc.MultiPolygon; bbox: [number, number, number, number] };

async function fetchLayer(name: string, url: string, where: string, key: string): Promise<Feat[]> {
  const file = join(cache, `${name}.json`);
  let fc: any;
  if (existsSync(file)) fc = JSON.parse(readFileSync(file, "utf8"));
  else {
    const features: any[] = [];
    // page by object id to stay under the transfer limit
    for (let offset = 0; ; offset += 20) {
      const params = new URLSearchParams({
        where,
        outFields: key,
        returnGeometry: "true",
        outSR: "4326",
        maxAllowableOffset: "0.00001",
        geometryPrecision: "6",
        resultOffset: String(offset),
        resultRecordCount: "20",
        orderByFields: key,
        f: "geojson",
      });
      const r = await fetch(`${url}/query?${params}`);
      if (!r.ok) throw new Error(`${name} ${r.status}`);
      const j: any = await r.json();
      features.push(...j.features);
      console.error(name, features.length);
      if (j.features.length < 20) break;
    }
    fc = { type: "FeatureCollection", features };
    writeFileSync(file, JSON.stringify(fc));
  }
  return fc.features.map((f: any) => {
    const g = f.geometry;
    const geom: pc.MultiPolygon = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    let [x0, y0, x1, y1] = [180, 90, -180, -90];
    for (const poly of geom)
      for (const [x, y] of poly[0]!) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    return { id: String(f.properties[key]), geom, bbox: [x0, y0, x1, y1] };
  });
}

function km2(geom: pc.MultiPolygon): number {
  return area({ type: "MultiPolygon", coordinates: geom } as any) / 1e6;
}

function overlaps(a: Feat[], b: Feat[]) {
  const out: Array<{ a: string; b: string; km2: number; shareOfB: number }> = [];
  for (const x of a)
    for (const y of b) {
      if (
        x.bbox[0] > y.bbox[2] ||
        y.bbox[0] > x.bbox[2] ||
        x.bbox[1] > y.bbox[3] ||
        y.bbox[1] > x.bbox[3]
      )
        continue;
      const inter = pc.intersection(x.geom, y.geom);
      if (!inter.length) continue;
      const k = km2(inter);
      if (k <= 0) continue;
      out.push({ a: x.id, b: y.id, km2: k, shareOfB: k / km2(y.geom) });
    }
  return out;
}

const STATE = "STATE='06'";
const cd = await fetchLayer("cd", `${SERVICE}/54`, STATE, "BASENAME");
const sd = await fetchLayer("sd", `${SERVICE}/56`, STATE, "BASENAME");
const ad = await fetchLayer("ad", `${SERVICE}/58`, STATE, "BASENAME");
const county = await fetchLayer("county", `${SERVICE}/82`, STATE, "BASENAME");
const boe = await fetchLayer(
  "boe",
  "https://services.gis.ca.gov/arcgis/rest/services/Government/CaliforniaDistricts/MapServer/3",
  "1=1",
  "DISTRICT",
);
console.error("counts", cd.length, sd.length, ad.length, county.length, boe.length);

const result = {
  cdAd: overlaps(cd, ad),
  boeAd: overlaps(boe, ad),
  sdCounty: overlaps(sd, county),
  adCounty: overlaps(ad, county),
};
writeFileSync(join(work, "overlaps.json"), JSON.stringify(result, null, 1));
for (const [k, v] of Object.entries(result)) {
  const small = v.filter((o) => o.km2 < 1).length;
  console.log(k, v.length, "pairs,", small, "under 1 km²");
}
