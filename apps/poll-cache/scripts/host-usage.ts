/**
 * How many requests reached this worker under each of its hostnames, from
 * Cloudflare's zone analytics (read-only). Written for retiring
 * polls.openslate.us in favour of api.openslate.us: once polls. sees next to
 * nothing, it can go (plans/api-domain-rename.md).
 *
 *   CLOUDFLARE_API_TOKEN=… bun scripts/host-usage.ts [days]
 *
 * The token needs Analytics Read on the openslate.us zone; the ops repo's
 * cloudflare/.env.local has one (`bun --env-file=<that file> scripts/host-usage.ts`).
 * Cloudflare keeps about 30 days. Its counts are sampled, so small numbers are
 * estimates, and they include bots and our own checks.
 */

const ZONE = "openslate.us";
const HOSTS = ["api.openslate.us", "polls.openslate.us"];

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error("Set CLOUDFLARE_API_TOKEN (see the comment at the top).");
const days = Number(process.argv[2] ?? 7);
if (!(days > 0 && days <= 30)) throw new Error("days: 1 to 30");

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

interface Envelope<T> {
  result?: T;
  data?: T;
  errors?: { message: string }[];
}

async function cloudflare<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers,
  });
  const body = (await response.json()) as Envelope<T>;
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  const value = body.result ?? body.data;
  if (value === undefined) throw new Error(`Cloudflare answered ${response.status}`);
  return value;
}

const zone = (await cloudflare<{ id: string }[]>(`/zones?name=${ZONE}`))[0]?.id;
if (!zone) throw new Error(`No zone ${ZONE} for this token`);

interface Row {
  count: number;
  dimensions: { clientRequestHTTPHost: string; clientRequestPath: string; date: string };
}

const since = new Date(Date.now() - days * 86_400_000).toISOString();
const data = await cloudflare<{ viewer: { zones: { httpRequestsAdaptiveGroups: Row[] }[] } }>(
  "/graphql",
  {
    method: "POST",
    body: JSON.stringify({
      query: `query ($zone: String!, $since: Time!, $hosts: [String!]) {
        viewer { zones(filter: { zoneTag: $zone }) {
          httpRequestsAdaptiveGroups(
            limit: 10000
            filter: { datetime_geq: $since, clientRequestHTTPHost_in: $hosts }
          ) { count dimensions { clientRequestHTTPHost clientRequestPath date } }
        } }
      }`,
      variables: { zone, since, hosts: HOSTS },
    }),
  },
);
const rows = data.viewer.zones[0]?.httpRequestsAdaptiveGroups ?? [];

// The worker's routes (src/index.ts). Everything else, /api/.env and the
// like included, is scanners and crawlers.
const ROUTES = [
  /^\/api\/(polls|pollsters|subjects|poll-types)(\/|$)/,
  /^\/api\/results\/v2(\/|$)/,
  /^\/api\/(civic\/elections|civic\/voterinfo|geocode\/census|health)$/,
];
const app = rows.filter((row) => ROUTES.some((r) => r.test(row.dimensions.clientRequestPath)));

function tally(from: Row[], key: (row: Row) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const row of from) counts.set(key(row), (counts.get(key(row)) ?? 0) + row.count);
  return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
}

const host = (row: Row) => row.dimensions.clientRequestHTTPHost;
const other = new Map(tally(rows, host));
console.log(`App requests (the worker's routes) in the last ${days} day(s), by hostname:`);
for (const [name, count] of tally(app, host)) {
  console.log(`  ${name}: ${count}`);
  other.set(name, (other.get(name) ?? 0) - count);
}
console.log("Other requests (scanners, crawlers):");
for (const [name, count] of other) console.log(`  ${name}: ${count}`);

console.log("\nApp requests by day (UTC dates):");
for (const [key, count] of tally(app, (r) => `${r.dimensions.date}  ${host(r)}`)) {
  console.log(`  ${key}: ${count}`);
}

console.log("\npolls.openslate.us app requests, by path:");
const polls = app.filter((row) => host(row) === "polls.openslate.us");
for (const [path, count] of tally(polls, (r) => r.dimensions.clientRequestPath)) {
  console.log(`  ${path}: ${count}`);
}
