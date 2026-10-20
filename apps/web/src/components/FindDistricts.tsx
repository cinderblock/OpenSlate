import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAddress } from "../lib/address";
import { areaFromLookup } from "../lib/civicArea";
import type { AreaOptions } from "../lib/collate";
import {
  type GeoHit,
  type GeoLayer,
  NEAR_LINE_METERS,
  type StateGeo,
  areaFromHit,
  loadStateGeo,
  locate,
  mergeFoundArea,
} from "../lib/geo";
import {
  type Area,
  districtFamilyLabel,
  jurisdictionLabel,
  noRaceReason,
} from "../lib/jurisdictions";
import {
  type AddressMatch,
  ONLINE_LOOKUPS,
  type OnlineLookup,
  searchCensus,
  searchOpenStreetMap,
  useLookupConsent,
} from "../lib/lookups";
import { ballotQueryOptions, serverHealthOptions } from "../lib/query";
import { DistrictMap, LAYER_NAMES } from "./DistrictMap";
import { Segmented } from "./ui/Segmented";
import { TextField } from "./ui/TextField";

/**
 * "Find your districts": fills Where-you-vote from a spot on the map, the
 * device's location, or an address. The first two run entirely on this device
 * against the boundary data shipped with the app; an address needs a
 * geocoder, and each one the user can pick asks for their consent first.
 * See plans/find-my-districts.md.
 */

const STATE = "us/ca";

type Method = "map" | "location" | "address";

const METHODS: Array<{ id: Method; title: string; privacy: string }> = [
  { id: "map", title: "Pick on a map", privacy: "On this device" },
  { id: "location", title: "Use my location", privacy: "On this device" },
  { id: "address", title: "Type my address", privacy: "Sent to a service you choose" },
];

/** Load the state's boundaries once something needs them. */
function useStateGeo(enabled: boolean): { geo?: StateGeo; error?: string } {
  const [state, setState] = useState<{ geo?: StateGeo; error?: string }>({});
  useEffect(() => {
    if (!enabled || state.geo) return;
    let live = true;
    loadStateGeo(STATE).then(
      (geo) => live && setState({ geo }),
      (err: unknown) =>
        live && setState({ error: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [enabled, state.geo]);
  return state;
}

interface Found {
  /** How it was found, for the footnote. */
  via: string;
  /** What it was found from: an address as matched, or a description of the spot. */
  from?: string;
  point?: [number, number];
  hit?: GeoHit;
  area: Area;
  places: string[];
  notCovered: string[];
  nearLine: GeoLayer[];
}

export function FindDistricts({
  options,
  area,
  election,
  onChange,
}: {
  options: AreaOptions;
  area: Area;
  election?: string;
  onChange: (next: Area) => void;
}) {
  const [method, setMethod] = useState<Method | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { geo, error: geoError } = useStateGeo(method !== null);

  function choose(next: Method) {
    setMethod((m) => (m === next ? null : next));
    setError(null);
  }

  /** Apply a hit (from the boundaries or a geocoder) to the area. */
  function applyHit(
    hit: GeoHit,
    via: string,
    extra: { point?: [number, number]; from?: string } = {},
  ) {
    if (!geo) return;
    const result = areaFromHit(hit, STATE, options);
    onChange(mergeFoundArea(area, result.area, geo));
    setFound({ via, ...extra, hit, ...result, nearLine: hit.nearLine });
    setError(null);
  }

  function pickPoint(lon: number, lat: number, via: string, nearMeters = NEAR_LINE_METERS) {
    if (!geo) return;
    const hit = locate(geo, lon, lat, nearMeters);
    if (!hit) {
      setFound(null);
      setError("That spot isn't in California. OpenSlate only has California's districts so far.");
      return;
    }
    applyHit(hit, via, { point: [lon, lat] });
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
            <span className="find-method-privacy">{m.privacy}</span>
          </button>
        ))}
      </fieldset>

      {method && geoError && <p className="error">Couldn't load the district maps: {geoError}</p>}
      {method && !geo && !geoError && <p className="hint">Loading California's district maps…</p>}

      {geo && method === "map" && (
        <MapPanel
          geo={geo}
          found={found}
          onPick={(lon, lat) => pickPoint(lon, lat, "the map, on this device")}
        />
      )}
      {geo && method === "location" && (
        <LocationPanel
          onLocated={(lon, lat, accuracy) =>
            pickPoint(
              lon,
              lat,
              `your location (±${Math.round(accuracy)} m), on this device`,
              Math.max(NEAR_LINE_METERS, accuracy),
            )
          }
          onError={setError}
        />
      )}
      {geo && method === "address" && (
        <AddressPanel
          options={options}
          onMatch={(match, service) => {
            if (match.state && match.state !== "CA") {
              setFound(null);
              setError(
                "That address isn't in California. OpenSlate only has California's districts so far.",
              );
              return;
            }
            if (service === "census" && match.districts) {
              // The Census Bureau's own answer, from its full-resolution maps.
              applyHit(
                {
                  districts: match.districts,
                  county: match.county,
                  place: match.place,
                  nearLine: [],
                },
                "the US Census Bureau geocoder",
                { point: [match.lon, match.lat], from: match.label },
              );
              return;
            }
            const hit = locate(geo, match.lon, match.lat);
            if (!hit) {
              setFound(null);
              setError(
                "That address isn't in California. OpenSlate only has California's districts so far.",
              );
              return;
            }
            applyHit(hit, "OpenStreetMap's point, matched on this device", {
              point: [match.lon, match.lat],
              from: match.label,
            });
          }}
          onCivicArea={(civicArea, from) => {
            onChange(mergeFoundArea(area, civicArea, geo));
            setFound({
              via: "your server (Google Civic Information)",
              from,
              area: civicArea,
              places: civicArea.localities.map(jurisdictionLabel),
              notCovered: [],
              nearLine: [],
            });
            setError(null);
          }}
          onError={setError}
        />
      )}

      {error && <p className="error">{error}</p>}
      {found && method && (
        <FoundSummary
          found={found}
          options={options}
          election={election}
          onShowMap={found.point && method !== "map" ? () => setMethod("map") : undefined}
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
  const [layer, setLayer] = useState<GeoLayer>("sd");
  const highlight: Partial<Record<GeoLayer, string>> = {
    ...found?.hit?.districts,
    ...(found?.hit?.county ? { county: found.hit.county } : {}),
    ...(found?.hit?.place ? { place: found.hit.place } : {}),
  };
  return (
    <div className="find-panel">
      <Segmented
        label="Show"
        value={layer}
        onChange={setLayer}
        options={[
          { id: "cd", label: "Congress" },
          { id: "sd", label: "State Senate" },
          { id: "ad", label: "Assembly" },
          { id: "county", label: "Counties" },
        ]}
      />
      <DistrictMap
        geo={geo}
        layer={layer}
        point={found?.point}
        highlight={highlight}
        onPick={onPick}
      />
      <p className="hint">
        Drawn from Census boundaries stored with the app ({geo.vintage.replace(/^.*; /, "")}), so
        nothing about where you click leaves this device. Zoom in and click your home.
      </p>
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
}: {
  options: AreaOptions;
  onMatch: (match: AddressMatch, service: OnlineLookup) => void;
  onCivicArea: (area: Area, from: string) => void;
  onError: (message: string) => void;
}) {
  const health = useQuery(serverHealthOptions());
  const queryClient = useQueryClient();
  const { consents, grant, revoke } = useLookupConsent();
  const [address, setAddress] = useAddress();
  const [draft, setDraft] = useState(address);
  const [service, setService] = useState<OnlineLookup>("census");
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<AddressMatch[] | null>(null);

  const services: OnlineLookup[] = health.data?.ballotLookup
    ? ["census", "osm", "server"]
    : ["census", "osm"];
  const info = ONLINE_LOOKUPS[service];
  const allowed = consents[service];

  async function lookUp() {
    const text = draft.trim();
    if (!text) return;
    if (!allowed) grant(service);
    setAddress(text);
    setBusy(true);
    setChoices(null);
    try {
      if (service === "server") {
        const lookup = await queryClient.fetchQuery(ballotQueryOptions(text));
        const civic = areaFromLookup(lookup, options);
        if (!civic) throw new Error("the lookup didn't say which state that address is in");
        onCivicArea(civic.area, text);
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
      onError(err instanceof Error ? err.message : String(err));
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
}: {
  found: Found;
  options: AreaOptions;
  election?: string;
  onShowMap?: () => void;
}) {
  const districts = Object.entries(found.area.districts);
  const near = found.nearLine.filter((l): l is "cd" | "sd" | "ad" =>
    ["cd", "sd", "ad"].includes(l),
  );
  return (
    <div className="find-found" aria-live="polite">
      <p>
        <strong>Found{found.places.length ? `: ${found.places.join(" · ")}` : ""}</strong>
        {found.from && <span className="hint"> ({found.from})</span>}
      </p>
      <ul className="find-found-list">
        {districts.map(([family, n]) => {
          const present = options.districts[family] ?? [];
          const hasRace = present.includes(n);
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
          {near.map((l) => LAYER_NAMES[l].toLowerCase()).join(" and ")} line, where the maps stored
          with the app may be off. Check it with an address lookup (the Census Bureau uses the exact
          lines).
        </p>
      )}
      {found.notCovered.length > 0 && (
        <p className="hint">
          Not found this way:{" "}
          {found.notCovered.map((f) => districtFamilyLabel(f.split("/").pop() ?? f)).join(", ")}.
          Set {found.notCovered.length === 1 ? "it" : "them"} below if you vote in one.
        </p>
      )}
      <p className="hint">
        From {found.via}. Your ballot is updated; adjust anything below.
        {onShowMap && (
          <>
            {" "}
            <button type="button" className="link" onClick={onShowMap}>
              Show it on the map
            </button>
          </>
        )}
      </p>
    </div>
  );
}
