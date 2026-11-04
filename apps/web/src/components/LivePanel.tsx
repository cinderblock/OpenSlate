import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Area } from "../lib/jurisdictions";
import { EMPTY_AREA, isAreaSet } from "../lib/jurisdictions";
import { useArea } from "../lib/myVote";
import { baseUrlFor } from "../lib/routing";
import {
  type CandidateResult,
  type ContestResult,
  contestLabel,
  contestQueryOptions,
  countySlug,
  DISTRICT_FAMILIES,
  type DistrictFamily,
  fetchCounties,
  LIVE_REFRESH_MS,
  type MeasureResult,
  NotOnBallot,
  propContest,
  STATEWIDE_OFFICES,
} from "../lib/sosCa";
import {
  addPlace,
  addSingle,
  districtsOfArea,
  type PlaceDistricts,
  removeFromGroups,
  removeGroup,
  setGroupCounty,
  skipContest,
  useWatch,
  type WatchGroup,
  type WatchSection,
  watchSections,
  watchStore,
} from "../lib/watch";
import { FindDistricts } from "./FindDistricts";
import { ComboBox, type SelectOption } from "./ui/Select";
import { TextField } from "./ui/TextField";

/**
 * Live results: the races the voter watches, by place, from the California
 * Secretary of State's count, checked every minute while the page is open.
 */

const PARTY_COLORS: Record<string, string> = {
  Dem: "var(--pole-left)",
  Rep: "var(--pole-right)",
  Grn: "#3f9a4a",
  Lib: "#d9a326",
  PF: "#9b4fb5",
  AI: "#8a6d3b",
};

function partyColor(party: string | undefined): string {
  return (party && PARTY_COLORS[party]) || "var(--pole-mid)";
}

const fmt = new Intl.NumberFormat("en-US");

/** The statewide measures, for the race list and the statewide group. */
function useMeasures() {
  const query = useQuery(contestQueryOptions("ballot-measures"));
  return query.data?.kind === "measures" ? query.data.measures : [];
}

/** Every county's name, from the Secretary of State's reporting status. */
function useCounties(): string[] {
  const query = useQuery({
    queryKey: ["sos-ca", "counties"] as const,
    queryFn: fetchCounties,
    staleTime: 1000 * 60 * 60 * 24,
  });
  return query.data ?? [];
}

function statewideContests(measures: MeasureResult[]): string[] {
  return [...STATEWIDE_OFFICES.map((o) => o.id), ...measures.map((m) => propContest(m.number))];
}

export function LivePanel() {
  const [groups] = useWatch();
  const measures = useMeasures();
  const [adding, setAdding] = useState<"place" | "race" | null>(null);
  const empty = groups.length === 0;

  return (
    <section className="panel live-panel">
      <h2>Live results</h2>
      <p className="hint">
        The California Secretary of State's count for the places and races you watch, checked every
        minute while this page is open. Kept in this browser.
      </p>
      <RefreshBar />
      <CivicApiStatus />

      <div className="live-actions">
        <button
          type="button"
          className={adding === "place" ? "primary" : ""}
          onClick={() => setAdding(adding === "place" ? null : "place")}
        >
          + Add races for a place
        </button>
        <button
          type="button"
          className={adding === "race" ? "primary" : ""}
          onClick={() => setAdding(adding === "race" ? null : "race")}
        >
          + Add one race
        </button>
      </div>
      {adding === "place" && <AddPlace measures={measures} onDone={() => setAdding(null)} />}
      {adding === "race" && <AddRace measures={measures} onDone={() => setAdding(null)} />}

      {empty && adding === null && (
        <p className="hint">
          Nothing watched yet. Add a place to watch its House, Senate, Assembly and Board of
          Equalization races with the statewide ones, or add races one at a time.
        </p>
      )}

      <PlacesBar groups={groups} />
      {watchSections(groups).map((section) => (
        <Section key={section.key} section={section} />
      ))}

      <p className="hint live-source">
        Source:{" "}
        <a href="https://electionresults.sos.ca.gov" target="_blank" rel="noreferrer">
          California Secretary of State ↗
        </a>
        . Semi-official election-night results; counties keep counting for weeks. Local races (city,
        county, school) are counted by each county: see its elections office. Races you follow from
        a race page are under <Link to="/races">All races → Following</Link>.
      </p>
    </section>
  );
}

/** When it last checked, and a button to check now. */
function RefreshBar() {
  const client = useQueryClient();
  const fetching = useIsFetching({ queryKey: ["sos-ca"] });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const last = Math.max(
    0,
    ...client
      .getQueryCache()
      .findAll({ queryKey: ["sos-ca"] })
      .map((q) => q.state.dataUpdatedAt),
  );
  const ago = last ? Math.max(0, Math.round((now - last) / 1000)) : null;
  return (
    <p className="live-refresh">
      {fetching > 0 ? (
        <span className="hint">Checking…</span>
      ) : ago !== null ? (
        <span className="hint">
          Checked{" "}
          {ago < 10 ? "just now" : `${ago < 60 ? `${ago} s` : `${Math.round(ago / 60)} min`} ago`} ·
          next check within {Math.round(LIVE_REFRESH_MS / 1000)} s
        </span>
      ) : null}{" "}
      <button
        type="button"
        className="link"
        onClick={() => void client.invalidateQueries({ queryKey: ["sos-ca"] })}
      >
        Check now
      </button>
    </p>
  );
}

/** civicAPI feeds race pages and slate results; say when it's down, so blanks there make sense. */
function CivicApiStatus() {
  const query = useQuery({
    queryKey: ["results", "civicapi-status"] as const,
    queryFn: async () => {
      const res = await fetch(`${baseUrlFor("civicapi")}/status`);
      return res.ok;
    },
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 60 * 2,
    retry: false,
  });
  if (query.data !== false && !query.isError) return null;
  return (
    <p className="hint warning-line">
      civicAPI, the source behind results on race pages and slate results, isn't answering right
      now. This page doesn't depend on it.
    </p>
  );
}

/** The places watched: each with its county pick, a way to stop, and what it skipped. */
function PlacesBar({ groups }: { groups: WatchGroup[] }) {
  const counties = useCounties();
  const countyOptions: SelectOption[] = [
    { id: "", label: "No county breakdown" },
    ...counties.map((c) => ({ id: c, label: `${c} County` })),
  ];
  if (groups.length === 0) return null;
  return (
    <ul className="live-places">
      {groups.map((group) => (
        <li key={group.id} className="live-place">
          <strong>{group.label}</strong>
          <ComboBox
            aria-label={`County count for ${group.label}`}
            className="live-county"
            options={countyOptions}
            value={group.county ?? ""}
            placeholder="Add a county's count"
            onChange={(county) =>
              watchStore.set((gs) => setGroupCounty(gs, group.id, county || undefined))
            }
          />
          <button
            type="button"
            className="link"
            onClick={() => watchStore.set((gs) => removeGroup(gs, group.id))}
          >
            Stop watching
          </button>
          {group.skipped && group.skipped.length > 0 && (
            <span className="hint live-skipped">
              No race this election for {group.skipped.map(contestLabel).join(", ")}.
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Section({ section }: { section: WatchSection }) {
  const names = section.groups.map((g) => g.label);
  const title = names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}` : names[0];
  const counties = [...new Set(section.groups.flatMap((g) => (g.county ? [g.county] : [])))];
  const groupIds = section.groups.map((g) => g.id);
  return (
    <section className="live-group">
      <h3>{title}</h3>
      <ul className="live-contests">
        {section.contests.map((id) => (
          <ContestCard key={id} id={id} groupIds={groupIds} counties={counties} />
        ))}
      </ul>
    </section>
  );
}

function ContestCard({
  id,
  groupIds,
  counties,
}: {
  id: string;
  groupIds: string[];
  counties: string[];
}) {
  const query = useQuery(contestQueryOptions(id));
  const remove = () => watchStore.set((gs) => removeFromGroups(gs, groupIds, id));
  const result = query.data;
  const notOnBallot = query.error instanceof NotOnBallot;
  const changed = useChanged(result?.reporting.time);

  // A district with no race this election (odd State Senate seats in 2026)
  // leaves the list; its place says so.
  useEffect(() => {
    if (notOnBallot) watchStore.set((gs) => skipContest(gs, id));
  }, [notOnBallot, id]);
  if (notOnBallot) return null;

  return (
    <li className={`live-contest card${changed ? " live-changed" : ""}`}>
      <div className="live-contest-head">
        <strong>{contestLabel(id)}</strong>
        {result && <ReportingLine result={result} />}
        <button
          type="button"
          className="link live-remove"
          onClick={remove}
          aria-label={`Stop watching ${contestLabel(id)}`}
        >
          ✕
        </button>
      </div>
      {query.isError && !result ? (
        <p className="error">Couldn't get this count: {query.error.message}. Trying again.</p>
      ) : !result ? (
        <p className="hint">Loading…</p>
      ) : (
        <ResultBody result={result} />
      )}
      {result && counties.map((county) => <CountyCount key={county} id={id} county={county} />)}
    </li>
  );
}

function CountyCount({ id, county }: { id: string; county: string }) {
  const query = useQuery(contestQueryOptions(id, county));
  if (!query.data) return null;
  return (
    <div className="live-county-count">
      <span className="hint">
        {county} County
        {query.data.reporting.percent !== undefined &&
          ` (${query.data.reporting.percent}% of precincts)`}
        :
      </span>{" "}
      <CompactLine result={query.data} />
    </div>
  );
}

/** True for two minutes after the count's timestamp moves on. */
function useChanged(time: string | undefined): boolean {
  const previous = useRef(time);
  const [changedAt, setChangedAt] = useState(0);
  useEffect(() => {
    if (previous.current !== undefined && time !== undefined && time !== previous.current) {
      setChangedAt(Date.now());
    }
    previous.current = time;
  }, [time]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!changedAt) return;
    const t = setTimeout(() => tick((n) => n + 1), 120_000);
    return () => clearTimeout(t);
  }, [changedAt]);
  return changedAt > 0 && Date.now() - changedAt < 120_000;
}

function ReportingLine({ result }: { result: ContestResult }) {
  const { percent, time } = result.reporting;
  return (
    <span className="hint live-reporting" title={result.reporting.text}>
      {percent !== undefined ? `${percent}% of precincts` : result.reporting.text}
      {time && ` · updated ${time}`}
    </span>
  );
}

function ResultBody({ result }: { result: ContestResult }) {
  if (result.kind === "candidates") {
    if (result.candidates.length === 0) return <p className="hint">No candidates listed.</p>;
    const total = result.candidates.reduce((s, c) => s + c.votes, 0);
    return (
      <ul className="live-candidates">
        {result.candidates.map((c) => (
          <CandidateRow key={c.name} c={c} counted={total > 0} />
        ))}
      </ul>
    );
  }
  if (result.kind === "measure") return <MeasureRow m={result.measure} />;
  return (
    <ul className="live-candidates">
      {result.measures.map((m) => (
        <li key={m.number}>
          <MeasureRow m={m} />
        </li>
      ))}
    </ul>
  );
}

function CandidateRow({ c, counted }: { c: CandidateResult; counted: boolean }) {
  return (
    <li className="live-candidate">
      <span className="live-name">
        {c.name}
        {c.party && <span className="tag-inline"> {c.party}</span>}
        {c.incumbent && <span className="hint"> · incumbent</span>}
      </span>
      <span className="live-bar" aria-hidden="true">
        <span
          className="live-bar-fill"
          style={{ width: `${counted ? c.percent : 0}%`, background: partyColor(c.party) }}
        />
      </span>
      <span className="live-num">
        {counted ? `${c.percent.toFixed(1)}%` : "–"}
        <span className="hint"> {fmt.format(c.votes)}</span>
      </span>
    </li>
  );
}

function MeasureRow({ m }: { m: MeasureResult }) {
  const counted = m.yes + m.no > 0;
  const passing = counted && m.yesPercent > 50;
  return (
    <div className="live-measure">
      <div className="hint live-measure-name">{m.name}</div>
      <div className="live-yesno">
        <span className={counted ? (passing ? "ok" : "bad") : "hint"}>
          {counted ? (passing ? "Passing" : "Failing") : "No votes counted yet"}
        </span>
        <span className="live-bar" aria-hidden="true">
          <span
            className="live-bar-fill"
            style={{ width: `${m.yesPercent}%`, background: "var(--ok)" }}
          />
          <span
            className="live-bar-fill"
            style={{ width: `${m.noPercent}%`, background: "var(--bad)" }}
          />
        </span>
        <span className="live-num">
          Yes {m.yesPercent.toFixed(1)}% · No {m.noPercent.toFixed(1)}%
          <span className="hint">
            {" "}
            {fmt.format(m.yes)} / {fmt.format(m.no)}
          </span>
        </span>
      </div>
    </div>
  );
}

/** A county's count on one line. */
function CompactLine({ result }: { result: ContestResult }) {
  if (result.kind === "candidates") {
    const total = result.candidates.reduce((s, c) => s + c.votes, 0);
    if (total === 0) return <span className="hint">no votes counted yet</span>;
    return (
      <span>
        {result.candidates
          .slice(0, 3)
          .map((c) => `${c.name} ${c.percent.toFixed(1)}%`)
          .join(" · ")}
      </span>
    );
  }
  const m = result.kind === "measure" ? result.measure : undefined;
  if (!m) return null;
  if (m.yes + m.no === 0) return <span className="hint">no votes counted yet</span>;
  return (
    <span>
      Yes {m.yesPercent.toFixed(1)}% · No {m.noPercent.toFixed(1)}%
    </span>
  );
}

// ---- Adding ------------------------------------------------------------------

/** The county an area's localities name, if one is a county (`us/ca/santa-clara-county`). */
function countyOfArea(area: Area, counties: string[]): string | undefined {
  for (const path of [...area.localities, ...(area.found ?? [])]) {
    const leaf = path.split("/").pop() ?? "";
    const m = leaf.match(/^(.*)-county$/);
    const slug = m?.[1] ?? leaf;
    const hit = counties.find((c) => countySlug(c) === slug);
    if (hit) return hit;
  }
  return undefined;
}

function describe(d: PlaceDistricts): string {
  const parts = DISTRICT_FAMILIES.flatMap(({ family, label }) =>
    d[family] ? [`${label.replace(" District", "")} ${d[family]}`] : [],
  );
  return parts.join(", ");
}

/** Every district number of every family, so an address lookup keeps them all. */
const ALL_DISTRICT_OPTIONS = {
  localities: [] as string[],
  districts: Object.fromEntries(
    DISTRICT_FAMILIES.map(({ family, count }) => [
      `us/ca/${family}`,
      Array.from({ length: count }, (_, i) => String(i + 1)),
    ]),
  ),
};

function AddPlace({ measures, onDone }: { measures: MeasureResult[]; onDone: () => void }) {
  const [myArea] = useArea();
  const counties = useCounties();
  const mine = districtsOfArea(myArea);
  const [label, setLabel] = useState("");
  const [districts, setDistricts] = useState<PlaceDistricts>({});
  const [county, setCounty] = useState<string>("");
  const [found, setFound] = useState<Area>(EMPTY_AREA);

  function add(place: { label: string; districts: PlaceDistricts; county?: string }) {
    watchStore.set((gs) => addPlace(gs, place, statewideContests(measures)));
    onDone();
  }

  function onFound(area: Area) {
    setFound(area);
    setDistricts(districtsOfArea(area));
    const c = countyOfArea(area, counties);
    if (c) setCounty(c);
  }

  const countyOptions: SelectOption[] = [
    { id: "", label: "None" },
    ...counties.map((c) => ({ id: c, label: `${c} County` })),
  ];
  const hasAny = Object.values(districts).some(Boolean);

  return (
    <div className="card-inset live-add">
      {isAreaSet(myArea) && Object.keys(mine).length > 0 && (
        <p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const c = countyOfArea(myArea, counties);
              add({ label: "Where I vote", districts: mine, ...(c ? { county: c } : {}) });
            }}
          >
            Add where I vote
          </button>{" "}
          <span className="hint">{describe(mine)}</span>
        </p>
      )}

      <h4>Another place</h4>
      <FindDistricts
        options={ALL_DISTRICT_OPTIONS}
        area={found}
        election="2026-11-03"
        onChange={onFound}
        onAdjust={() => undefined}
      />
      <p className="hint">Or pick its districts:</p>
      <div className="live-district-pickers">
        {DISTRICT_FAMILIES.map(({ family, count, label: fl }) => (
          <ComboBox
            key={family}
            label={fl.replace(" District", "")}
            options={[
              { id: "", label: "None" },
              ...Array.from({ length: count }, (_, i) => ({
                id: String(i + 1),
                label: String(i + 1),
              })),
            ]}
            value={districts[family] ?? ""}
            onChange={(n) =>
              setDistricts((d) => {
                const next = { ...d };
                if (n) next[family as DistrictFamily] = n;
                else delete next[family as DistrictFamily];
                return next;
              })
            }
          />
        ))}
        <ComboBox label="County" options={countyOptions} value={county} onChange={setCounty} />
      </div>
      <TextField label="Call it" value={label} onChange={setLabel} placeholder="Mom's place" />
      <p>
        <button
          type="button"
          className="primary"
          disabled={!hasAny && !county}
          onClick={() =>
            add({
              label: label || describe(districts) || `${county} County`,
              districts,
              ...(county ? { county } : {}),
            })
          }
        >
          Watch this place
        </button>{" "}
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </p>
    </div>
  );
}

function AddRace({ measures, onDone }: { measures: MeasureResult[]; onDone: () => void }) {
  const options = useMemo<SelectOption[]>(() => {
    const out: SelectOption[] = STATEWIDE_OFFICES.map((o) => ({
      id: o.id,
      label: o.label,
      description: "Statewide",
    }));
    for (const m of measures) {
      out.push({
        id: propContest(m.number),
        label: `Proposition ${m.number}`,
        textValue: `Proposition ${m.number} Prop ${m.number} ${m.name}`,
        description: m.name,
      });
    }
    for (const { family, count, label } of DISTRICT_FAMILIES) {
      for (let n = 1; n <= count; n++) {
        const id = `${DISTRICT_FAMILIES.find((f) => f.family === family)?.path}/district/${n}`;
        out.push({ id, label: `${label} ${n}` });
      }
    }
    return out;
  }, [measures]);
  return (
    <div className="card-inset live-add">
      <ComboBox
        label="Race or measure"
        options={options}
        value={null}
        placeholder="Type to find: Governor, Prop 50, Assembly 24…"
        onChange={(id) => {
          watchStore.set((gs) => addSingle(gs, id));
          onDone();
        }}
      />
    </div>
  );
}
