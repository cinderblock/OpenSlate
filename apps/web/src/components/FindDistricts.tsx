import { useEffect, useState } from "react";
import { useAddress } from "../lib/address";
import { BASEMAP_SOURCE, type Basemap, useBasemap } from "../lib/basemap";
import { type CivicRoute, civicBallot, useCivicRoutes } from "../lib/civic";
import { areaFromLookup } from "../lib/civicArea";
import type { AreaOptions } from "../lib/collate";
import {
  areaFromHit,
  cityPaths,
  type GeoHit,
  type GeoLayer,
  hasStateGeo,
  type LookupLayer,
  loadStateGeo,
  loadStateOutlines,
  locate,
  lookupsAt,
  mergeFoundArea,
  NEAR_LINE_METERS,
  type StateGeo,
  statesAt,
} from "../lib/geo";
import {
  type Area,
  areaStates,
  districtFamilyLabel,
  familyHasRaces,
  jurisdictionLabel,
  NO_DISTRICT,
  noRaceReason,
  stateLabel,
} from "../lib/jurisdictions";
import {
  type AddressMatch,
  LookupUnavailableError,
  ONLINE_LOOKUPS,
  type OnlineLookup,
  searchCensus,
  searchOpenStreetMap,
  useLookupConsent,
} from "../lib/lookups";
import { allRegions, layerWords, regionByCode, regionProfile } from "../lib/regions";
import { DistrictMap } from "./DistrictMap";
import { ReportCivicProblem } from "./ReportCivicProblem";
import { Segmented } from "./ui/Segmented";
import { Select } from "./ui/Select";
import { TextField } from "./ui/TextField";

/**
 * "Find your districts": fills Where-you-vote from a spot on the map, the
 * device's location, or an address. The first two run entirely on this device
 * against the boundary data shipped with the app; an address needs a
 * geocoder, and each one the user can pick asks for their consent first. The
 * map's street/satellite background (tiles from USGS, on by default) says
 * what it shares and can be switched off.
 * See plans/find-my-districts.md.
 */

type Method = "map" | "location" | "address";

const METHODS: Array<{ id: Method; title: string; privacy: string }> = [
  { id: "map", title: "Pick on a map", privacy: "On this device" },
  { id: "location", title: "Use my location", privacy: "On this device" },
  { id: "address", title: "Type my address", privacy: "Sent to a service you choose" },
];

/** The states the app has boundary files for, by name. */
const MAPPED = allRegions().filter((region) => hasStateGeo(region.path));

/** "California", "California and Texas", "12 states". */
function mappedStates(): string {
  if (MAPPED.length === 0) return "no state";
  if (MAPPED.length > 3) return `${MAPPED.length} states`;
  const names = MAPPED.map((region) => region.name);
  return names.length === 1
    ? (names[0] as string)
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The state to start in: the one the voter's area names, else the only one
 * there are maps of. With neither, the map asks.
 */
function startingState(area: Area): string | undefined {
  const states = [...areaStates(area)];
  if (states.length === 1) return states[0];
  return MAPPED.length === 1 ? MAPPED[0]?.path : undefined;
}

/** Load a state's boundaries once something needs them; none for a state the app has no file for. */
function useStateGeo(state: string | undefined): { geo?: StateGeo; error?: string } {
  const [loaded, setLoaded] = useState<{ state?: string; geo?: StateGeo; error?: string }>({});
  useEffect(() => {
    if (!state || !hasStateGeo(state)) return;
    let live = true;
    loadStateGeo(state).then(
      (geo) => live && setLoaded({ state, geo }),
      (err: unknown) =>
        live && setLoaded({ state, error: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [state]);
  // Another state's boundaries aren't this one's.
  return loaded.state === state ? loaded : {};
}

interface Found {
  /** How it was found, for the footnote. */
  via: string;
  /** What it was found from: an address as matched, or a description of the spot. */
  from?: string;
  /** The state it was found in. */
  state?: string;
  point?: [number, number];
  hit?: GeoHit;
  area: Area;
  places: string[];
  notCovered: string[];
  nearLine: (GeoLayer | LookupLayer)[];
}

/** What to call a lookup layer's district in "near a … line". */
const UNSURE_NAMES: Partial<Record<GeoLayer | LookupLayer, string>> = {
  unsd: "school district",
  elsd: "school district",
  scsd: "school district",
  boe: "Board of Equalization district",
  ccd: "community college district",
  sup: "supervisorial district",
  council: "city council district",
};

export function FindDistricts({
  options,
  area,
  election,
  onChange,
  onAdjust,
}: {
  options: AreaOptions;
  area: Area;
  election?: string;
  onChange: (next: Area) => void;
  /** Switch to setting the area by hand, to fix or fill in what was found. */
  onAdjust: () => void;
}) {
  const [method, setMethod] = useState<Method | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  // The state being looked in: the map's, and wherever the last lookup landed.
  const [state, setState] = useState<string | undefined>(() => startingState(area));
  const [basemap] = useBasemap();
  // `google` says which Google route failed, so the error can offer a report.
  const [error, setErrorState] = useState<{ message: string; google?: CivicRoute } | null>(null);
  const setError = (message: string | null, google?: CivicRoute) =>
    setErrorState(message === null ? null : { message, ...(google ? { google } : {}) });
  // Which lookup couldn't answer: not an error to fix, so it gets a way around it.
  const [unavailable, setUnavailable] = useState<OnlineLookup | null>(null);
  const mapped = state !== undefined && hasStateGeo(state);
  const { geo, error: geoError } = useStateGeo(method !== null && mapped ? state : undefined);

  function choose(next: Method) {
    setMethod((m) => (m === next ? null : next));
    setError(null);
    setUnavailable(null);
  }

  /** A state's boundaries, when the app has them and they load. */
  async function geoOf(path: string): Promise<StateGeo | undefined> {
    if (!hasStateGeo(path)) return undefined;
    return loadStateGeo(path).catch(() => undefined);
  }

  /**
   * Apply a hit (from the boundaries or a geocoder) to the area. `within`: the
   * state's boundaries when the app has them, which tell a city's path from a
   * county's and keep what a lookup can't know.
   */
  function applyHit(
    hit: GeoHit,
    path: string,
    within: StateGeo | undefined,
    via: string,
    extra: { point?: [number, number]; from?: string } = {},
  ) {
    const result = areaFromHit(hit, path, options, within ? cityPaths(within) : undefined);
    onChange(mergeFoundArea(area, result.area, within));
    setState(path);
    setFound({ via, ...extra, state: path, hit, ...result, nearLine: hit.nearLine });
    setError(null);
  }

  /** A click on the map: in the state it shows. */
  function pickPoint(lon: number, lat: number) {
    if (!geo || !state) return;
    const hit = locate(geo, lon, lat);
    if (!hit) {
      setFound(null);
      setError(
        MAPPED.length > 1
          ? `That spot isn't in ${stateLabel(state)}. Choose another state above the map.`
          : `That spot isn't in ${stateLabel(state)}. OpenSlate only has ${stateLabel(state)}'s district maps so far: for anywhere else, type your address.`,
      );
      return;
    }
    applyHit(hit, state, geo, "the map, on this device", { point: [lon, lat] });
  }

  /**
   * A point from the device or a geocoder: find its state (`hint`, when the
   * source said; else the states' outlines), then its districts in that
   * state's boundaries. `unmapped` words the error for a state with none.
   */
  async function placePoint(
    lon: number,
    lat: number,
    via: string,
    opts: {
      nearMeters?: number;
      hint?: string;
      from?: string;
      unmapped: (stateName: string) => string;
    },
  ) {
    const outlines = opts.hint ? undefined : await loadStateOutlines();
    const candidates = opts.hint
      ? [opts.hint]
      : outlines
        ? statesAt(outlines, lon, lat)
        : MAPPED.map((region) => region.path);
    for (const path of candidates) {
      const within = await geoOf(path);
      const hit = within && locate(within, lon, lat, opts.nearMeters);
      if (hit && within) {
        applyHit(hit, path, within, via, {
          point: [lon, lat],
          ...(opts.from ? { from: opts.from } : {}),
        });
        return;
      }
    }
    setFound(null);
    // The outlines (or the source) said which state: one the app has no maps of.
    const known = (opts.hint || outlines) && candidates[0];
    setError(
      known
        ? opts.unmapped(stateLabel(known))
        : `That spot isn't anywhere OpenSlate has district maps of (${mappedStates()} so far). Type your address instead.`,
    );
  }

  async function matched(match: AddressMatch, service: OnlineLookup) {
    const region = match.state ? regionByCode("us", match.state) : undefined;
    if (match.state && !region) {
      setFound(null);
      setError(`OpenSlate doesn't know "${match.state}" as a US state or territory.`);
      return;
    }
    if (service === "census" && match.districts && region) {
      // The Census Bureau's own answer, from its full-resolution maps, for any
      // state; school, supervisorial and other districts from ours where the
      // app has that state's, at the point it matched.
      const within = await geoOf(region.path);
      const extra = within ? lookupsAt(within, match.lon, match.lat, match) : undefined;
      applyHit(
        {
          districts: match.districts,
          county: match.county,
          place: match.place,
          nearLine: extra?.nearLine ?? [],
          ...(extra ? { lookups: extra.lookups } : {}),
        },
        region.path,
        within,
        "the US Census Bureau geocoder",
        { point: [match.lon, match.lat], from: match.label },
      );
      return;
    }
    // OpenStreetMap finds the spot and no more: the districts come from the maps here.
    await placePoint(match.lon, match.lat, "OpenStreetMap's point, matched on this device", {
      from: match.label,
      ...(region ? { hint: region.path } : {}),
      unmapped: (name) =>
        `OpenStreetMap only finds the spot, and OpenSlate has no district maps of ${name} yet to place it in. Look it up with the US Census Bureau instead: it answers with the districts.`,
    });
  }

  return (
    <div className="find-districts">
      <fieldset className="find-methods">
        <legend className="sr-only">How to find them</legend>
        {METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`find-method${method === m.id ? " on" : ""}`}
            aria-pressed={method === m.id}
            onClick={() => choose(m.id)}
          >
            <span className="find-method-title">{m.title}</span>
            <span className="find-method-privacy">
              {m.id === "map" && basemap !== "off"
                ? "On this device; map images from USGS"
                : m.privacy}
            </span>
          </button>
        ))}
      </fieldset>

      {method === "map" && MAPPED.length > 1 && (
        <Select
          label="State"
          placeholder="Choose a state"
          value={mapped ? state : undefined}
          onChange={(next) => {
            setState(next);
            setFound(null);
            setError(null);
          }}
          options={MAPPED.map((region) => ({ id: region.path, label: region.name }))}
        />
      )}
      {method === "map" && state && !mapped && (
        <p className="hint" role="status">
          OpenSlate has no district maps of {stateLabel(state)} yet
          {MAPPED.length > 0 && ` (${mappedStates()} so far)`}.{" "}
          <button type="button" className="link" onClick={() => choose("address")}>
            Type your address
          </button>{" "}
          instead: the Census Bureau knows every state's districts.
        </p>
      )}
      {method === "map" && geoError && (
        <p className="error">Couldn't load the district maps: {geoError}</p>
      )}
      {method === "map" && mapped && !geo && !geoError && (
        <p className="hint">Loading {stateLabel(state)}'s district maps…</p>
      )}

      {geo && method === "map" && <MapPanel geo={geo} found={found} onPick={pickPoint} />}
      {method === "location" && (
        <LocationPanel
          onLocated={(lon, lat, accuracy) =>
            void placePoint(
              lon,
              lat,
              `your location (±${Math.round(accuracy)} m), on this device`,
              {
                nearMeters: Math.max(NEAR_LINE_METERS, accuracy),
                unmapped: (name) =>
                  `You're in ${name}, and OpenSlate has no district maps of ${name} yet to work it out on this device. Type your address instead: the Census Bureau knows every state's districts.`,
              },
            )
          }
          onError={setError}
        />
      )}
      {method === "address" && (
        <AddressPanel
          options={options}
          onMatch={(match, service) => void matched(match, service)}
          onCivicArea={(civicArea, from, service) => {
            const [path] = [...areaStates(civicArea)];
            void (path ? geoOf(path) : Promise.resolve(undefined)).then((within) => {
              onChange(mergeFoundArea(area, civicArea, within));
              if (path) setState(path);
              setFound({
                via:
                  service === "google-key"
                    ? "Google Civic Information, with your key"
                    : "Google Civic Information, through OpenSlate",
                from,
                ...(path ? { state: path } : {}),
                area: civicArea,
                places: civicArea.localities.map(jurisdictionLabel),
                notCovered: [],
                nearLine: [],
              });
              setError(null);
            });
          }}
          onError={(message, google) => {
            setUnavailable(null);
            setError(message, google);
          }}
          onUnavailable={(service) => {
            setError(null);
            setUnavailable(service);
          }}
        />
      )}

      {unavailable && (
        <p className="warning" role="status">
          {unavailable === "osm" ? "OpenStreetMap's search" : "Our address lookup"} is overloaded or
          out of reach right now. Try another service above, or do it without a lookup, which
          doesn't need our servers:{" "}
          <button type="button" className="link" onClick={() => choose("map")}>
            Pick on the map
          </button>
          {" · "}
          <button type="button" className="link" onClick={onAdjust}>
            Set your districts by hand
          </button>
        </p>
      )}
      {error && (
        <p className="error">
          {error.message}
          {error.google && (
            <>
              {" "}
              <ReportCivicProblem lookup="ballot" route={error.google} message={error.message} />
            </>
          )}
        </p>
      )}
      {found && method && (
        <FoundSummary
          found={found}
          options={options}
          election={election}
          onShowMap={
            found.point && method !== "map" && found.state && hasStateGeo(found.state)
              ? () => setMethod("map")
              : undefined
          }
          onAdjust={onAdjust}
        />
      )}
    </div>
  );
}

function MapPanel({
  geo,
  found,
  onPick,
}: {
  geo: StateGeo;
  found: Found | null;
  onPick: (lon: number, lat: number) => void;
}) {
  const region = regionProfile(geo.state);
  const [picked, setLayer] = useState<GeoLayer>("sd");
  // Another state may not have the layer the last one showed.
  const layer = geo.layers[picked].length > 0 ? picked : "cd";
  const [basemap, setBasemap] = useBasemap();
  const highlight: Partial<Record<GeoLayer, string>> = {
    ...found?.hit?.districts,
    ...(found?.hit?.county ? { county: found.hit.county } : {}),
    ...(found?.hit?.place ? { place: found.hit.place } : {}),
  };
  const vintage = geo.vintage.replace(/^.*; /, "");
  return (
    <div className="find-panel">
      <div className="find-map-options">
        <Segmented
          aria-label="Boundaries to show"
          value={layer}
          onChange={setLayer}
          options={(["cd", "sd", "ad", "county"] as const).flatMap((id) => {
            // A chamber the state doesn't have gets no tab.
            const words = geo.layers[id].length > 0 ? layerWords(region, id) : undefined;
            return words ? [{ id, label: words.tab }] : [];
          })}
        />
        <Segmented<Basemap>
          label="Background"
          value={basemap}
          onChange={setBasemap}
          options={[
            { id: "off", label: "Off" },
            { id: "streets", label: "Streets" },
            { id: "satellite", label: "Satellite" },
          ]}
        />
      </div>
      <DistrictMap
        geo={geo}
        layer={layer}
        point={found?.point}
        highlight={highlight}
        basemap={basemap}
        onPick={onPick}
      />
      {basemap === "off" ? (
        <p className="hint">
          Drawn from Census boundaries stored with the app ({vintage}), so nothing about where you
          click leaves this device. Zoom in and click your home. A street or satellite background
          loads map images from {BASEMAP_SOURCE.recipient}, which can see roughly where you're
          looking.
        </p>
      ) : (
        <p className="hint">
          The background loads map images from <strong>{BASEMAP_SOURCE.recipient}</strong>, so they
          can see roughly where you're looking (switch it off to stop).{" "}
          <a href={BASEMAP_SOURCE.policyUrl} target="_blank" rel="noreferrer">
            Their privacy policy
          </a>
          . The districts are drawn from Census boundaries stored with the app ({vintage}), and
          where you click is worked out on this device. Zoom in and click your home.
        </p>
      )}
    </div>
  );
}

function LocationPanel({
  onLocated,
  onError,
}: {
  onLocated: (lon: number, lat: number, accuracy: number) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const supported = typeof navigator !== "undefined" && "geolocation" in navigator;

  function locateMe() {
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setBusy(false);
        onLocated(position.coords.longitude, position.coords.latitude, position.coords.accuracy);
      },
      (err) => {
        setBusy(false);
        onError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was declined. You can pick on the map instead."
            : `Couldn't get your location: ${err.message || "unknown error"}`,
        );
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className="find-panel">
      <p className="hint">
        Your browser will ask to share your location with this page. The districts are worked out
        here, from the maps stored with the app; your location isn't sent anywhere by OpenSlate
        (your browser or phone may use its own location service to find it). Use this at home: it
        finds where you are, not where you're registered.
      </p>
      <button type="button" className="primary" onClick={locateMe} disabled={!supported || busy}>
        {busy
          ? "Finding you…"
          : supported
            ? "Find my districts here"
            : "This browser can't share a location"}
      </button>
    </div>
  );
}

function AddressPanel({
  options,
  onMatch,
  onCivicArea,
  onError,
  onUnavailable,
}: {
  options: AreaOptions;
  onMatch: (match: AddressMatch, service: OnlineLookup) => void;
  onCivicArea: (area: Area, from: string, service: OnlineLookup) => void;
  /** `google`: the Google route that failed, when it was Google. */
  onError: (message: string, google?: CivicRoute) => void;
  onUnavailable: (service: OnlineLookup) => void;
}) {
  const civic = useCivicRoutes();
  const { consents, grant, revoke } = useLookupConsent();
  const [address, setAddress] = useAddress();
  const [draft, setDraft] = useState(address);
  const [picked, setService] = useState<OnlineLookup>("census");
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<AddressMatch[] | null>(null);

  // Google, when this browser has a key or OpenSlate's relay can ask it.
  const services: OnlineLookup[] = [
    "census",
    "osm",
    ...civic.routes.map((route): OnlineLookup => (route === "key" ? "google-key" : "google")),
  ];
  // A route can go away (the key forgotten in Settings): fall back to Census.
  const service = services.includes(picked) ? picked : "census";
  const info = ONLINE_LOOKUPS[service];
  const allowed = consents[service];

  async function lookUp() {
    const text = draft.trim();
    if (!text) return;
    if (!allowed) grant(service);
    setAddress(text);
    setBusy(true);
    setChoices(null);
    const google: CivicRoute | undefined =
      service === "google-key" ? "key" : service === "google" ? "relay" : undefined;
    // Google's ballot data comes state by state, and late: an address it has no
    // election or no contests for yet tells us nothing. That's not a bug to report.
    const NO_BALLOT_YET =
      "Google has no ballot for that address yet, so it can't tell your districts. Try Census or OpenStreetMap.";
    try {
      if (google) {
        const ballot = await civicBallot(google, civic.key, text).catch((err: unknown) => {
          if (err instanceof Error && /Election unknown/i.test(err.message)) return null;
          throw err;
        });
        if (!ballot || ballot.contests.length === 0) {
          onError(NO_BALLOT_YET);
          return;
        }
        const found = areaFromLookup(ballot, options);
        if (!found) throw new Error("Google didn't say which state that address is in");
        onCivicArea(found.area, text, service);
        return;
      }
      const matches =
        service === "census" ? await searchCensus(text) : await searchOpenStreetMap(text);
      if (matches.length === 0) {
        onError("No match for that address. Try adding the city and ZIP code.");
      } else if (matches.length === 1 || service === "census") {
        // Census answers one address, or several readings of it; the first is its best.
        onMatch(matches[0] as AddressMatch, service);
      } else {
        setChoices(matches);
      }
    } catch (err) {
      if (err instanceof LookupUnavailableError) onUnavailable(service);
      else onError(err instanceof Error ? err.message : String(err), google);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="find-panel">
      <TextField
        label="Your address"
        placeholder="street address, city, ZIP"
        value={draft}
        onChange={setDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void lookUp();
          }
        }}
      />
      <Segmented
        label="Look it up with"
        value={service}
        onChange={setService}
        options={services.map((key) => ({ id: key, label: ONLINE_LOOKUPS[key].name }))}
      />
      <div className={`consent${allowed ? " granted" : ""}`}>
        <p>
          {allowed ? "You allowed sending addresses to " : "Looking up sends your address to "}
          <strong>{info.recipient}</strong>. {info.how}{" "}
          <a href={info.policyUrl} target="_blank" rel="noreferrer">
            Their privacy policy
          </a>
        </p>
        {allowed && (
          <button type="button" className="link" onClick={() => revoke(service)}>
            Stop allowing {info.name}
          </button>
        )}
      </div>
      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={() => void lookUp()}
          disabled={busy || !draft.trim()}
        >
          {busy ? "Looking up…" : allowed ? "Look up" : `Allow ${info.name} and look up`}
        </button>
      </div>
      <p className="hint">The address is remembered in this browser only, for next time.</p>
      {service === "osm" && (
        <p className="hint">
          Search by{" "}
          <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noreferrer">
            Nominatim
          </a>
          , data ©{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap contributors
          </a>
          .
        </p>
      )}
      {choices && (
        <div className="find-choices">
          <p className="hint">Several places match. Which one?</p>
          {choices.map((m) => (
            <button
              key={`${m.lon},${m.lat}`}
              type="button"
              className="find-choice"
              onClick={() => {
                setChoices(null);
                onMatch(m, service);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FoundSummary({
  found,
  options,
  election,
  onShowMap,
  onAdjust,
}: {
  found: Found;
  options: AreaOptions;
  election?: string;
  onShowMap?: () => void;
  onAdjust: () => void;
}) {
  const districts = Object.entries(found.area.districts).filter(([, n]) => n !== NO_DISTRICT);
  const near = found.nearLine.filter((l): l is "cd" | "sd" | "ad" =>
    ["cd", "sd", "ad"].includes(l),
  );
  // Lookup layers the spot is near a line of, so their districts weren't set.
  const unsure = [
    ...new Set(found.nearLine.flatMap((l) => (l in UNSURE_NAMES ? [UNSURE_NAMES[l]] : []))),
  ];
  return (
    <div className="find-found" aria-live="polite">
      <p>
        <strong>Found{found.places.length ? `: ${found.places.join(" · ")}` : ""}</strong>
        {found.from && <span className="hint"> ({found.from})</span>}
      </p>
      <ul className="find-found-list">
        {districts.map(([family, n]) => {
          const label = found.area.labels?.[family];
          // A school district only narrows races filed under the county: no
          // race of its own to be missing.
          if (label) return <li key={family}>{label}</li>;
          const present = options.districts[family] ?? [];
          const hasRace = present.includes(n) || !familyHasRaces(family);
          return (
            <li key={family}>
              {jurisdictionLabel(`${family}-${n}`)}
              {!hasRace && (
                <span className="hint"> · {noRaceReason(family, n, present, election)}</span>
              )}
            </li>
          );
        })}
      </ul>
      {near.length > 0 && (
        <p className="warning">
          This spot is within about {NEAR_LINE_METERS} m of a{" "}
          {near
            .map((l) =>
              (layerWords(regionProfile(found.state), l)?.one ?? "district").toLowerCase(),
            )
            .join(" and ")}{" "}
          line, where the maps stored with the app may be off. Check it with an address lookup (the
          Census Bureau uses the exact lines).
        </p>
      )}
      {unsure.length > 0 && (
        <p className="hint">
          This spot is near a {unsure.join(" and ")} line, so OpenSlate can't tell which one you're
          in. Your ballot lists the races only those districts vote on as ones that might be on it.
        </p>
      )}
      {found.notCovered.length > 0 && (
        <p className="hint">
          Not found this way:{" "}
          {found.notCovered
            .map((f) => districtFamilyLabel(f.split("/").pop() ?? f, found.state))
            .join(", ")}
          . If you vote in one, set it by hand.
        </p>
      )}
      <p className="hint">
        From {found.via}. Your ballot is updated.{" "}
        <button type="button" className="link" onClick={onAdjust}>
          Adjust by hand
        </button>
        {onShowMap && (
          <>
            {" · "}
            <button type="button" className="link" onClick={onShowMap}>
              Show it on the map
            </button>
          </>
        )}
      </p>
    </div>
  );
}
