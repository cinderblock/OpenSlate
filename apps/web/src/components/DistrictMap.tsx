import polylabel from "polylabel";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BASEMAP_SOURCE,
  BASEMAPS,
  type Basemap,
  type BasemapInfo,
  tilesToDraw,
  tileUrl,
  tileZoom,
} from "../lib/basemap";
import type { GeoLayer, GeoShape, StateGeo } from "../lib/geo";
import { shapeAt } from "../lib/geo";
import { webMercator } from "../lib/projection";

/**
 * California on a map, drawn from the boundary data on this device. Under it,
 * street or satellite tiles from USGS (lib/basemap.ts), unless the user turns
 * them off: tiles tell USGS roughly where they're looking.
 * Drag to pan, wheel or pinch to zoom, click to pick a spot. Keyboard: arrows
 * pan, + and - zoom, Enter picks the centre.
 */

/** Map units across the world: 1 unit ≈ 60 m in California, so one decimal is ~6 m. */
const SCALE = 2 ** 19;

function project(lon: number, lat: number): [number, number] {
  const [x, y] = webMercator.project(lon, lat);
  return [x * SCALE, y * SCALE];
}

function invert(x: number, y: number): [number, number] {
  return webMercator.invert(x / SCALE, y / SCALE);
}

interface Projected {
  id: string;
  d: string;
  /** Map colour, 0–3, different from every neighbour's (see fourColor). */
  color: number;
  /** Projected bbox. */
  box: [number, number, number, number];
  /** Where its label goes: the point deepest inside its roomiest polygon. */
  label: [number, number];
  /** Distance from `label` to the nearest edge: how big a label fits there. */
  room: number;
}

function projectShape(shape: GeoShape): Projected {
  let d = "";
  const box: [number, number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  let label: [number, number] = [0, 0];
  let room = -1;
  for (const rings of shape.polygons) {
    const projected = rings.map((ring, i) => {
      const points = ring.map(([lon = 0, lat = 0], j): [number, number] => {
        const [x, y] = project(lon, lat);
        d += `${j ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
        if (i === 0) {
          if (x < box[0]) box[0] = x;
          if (y < box[1]) box[1] = y;
          if (x > box[2]) box[2] = x;
          if (y > box[3]) box[3] = y;
        }
        return [x, y];
      });
      d += "Z";
      return points;
    });
    // Pole of inaccessibility, to a precision of a few hundredths of the
    // polygon's size: plenty for placing a label.
    const xs = projected[0]?.map((p) => p[0]) ?? [];
    const ys = projected[0]?.map((p) => p[1]) ?? [];
    const extent = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const pole = polylabel(projected, Math.max(0.5, extent / 100));
    if (pole.distance > room) {
      label = [pole[0], pole[1]];
      room = pole.distance;
    }
  }
  return { id: shape.id, d, color: shape.color, box, label, room };
}

const projectedCache = new WeakMap<GeoShape[], Projected[]>();
function projectedLayer(shapes: GeoShape[]): Projected[] {
  let out = projectedCache.get(shapes);
  if (!out) {
    out = shapes.map(projectShape);
    projectedCache.set(shapes, out);
  }
  return out;
}

const LayerPaths = memo(function LayerPaths({
  shapes,
  className,
  colored = false,
}: {
  shapes: Projected[];
  className: string;
  /** Fill each shape with its map colour. */
  colored?: boolean;
}) {
  return (
    <g className={className}>
      {shapes.map((s) => (
        <path
          key={s.id}
          d={s.d}
          className={colored ? `map-color-${s.color}` : undefined}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
});

/** Whether a label of `chars` characters at `fontSize` fits inside a shape. */
function labelFits(s: Projected, chars: number, fontSize: number): boolean {
  // Room is a radius; a label is about 0.6 em per character wide, 1 em tall.
  return s.room >= Math.max(chars * 0.33, 0.6) * fontSize;
}

type ViewBox = { x: number; y: number; w: number; h: number };

/** The background tiles for an area of the map `pixelsAcross` device pixels wide. */
function basemapTiles(
  info: BasemapInfo,
  area: ViewBox,
  pixelsAcross: number,
  loaded: ReadonlySet<string>,
) {
  const world = { x: area.x / SCALE, y: area.y / SCALE, w: area.w / SCALE, h: area.h / SCALE };
  const z = tileZoom(world, pixelsAcross, info.maxZoom);
  return tilesToDraw(world, z, (t) => loaded.has(tileUrl(info, t.z, t.x, t.y))).map((t) => {
    const size = SCALE / 2 ** t.z;
    return { href: tileUrl(info, t.z, t.x, t.y), x: t.x * size, y: t.y * size, size };
  });
}

export const LAYER_NAMES: Record<GeoLayer, string> = {
  cd: "Congressional district",
  sd: "State Senate district",
  ad: "Assembly district",
  county: "County",
  place: "City",
};

const LAYER_PLURALS: Record<GeoLayer, string> = {
  cd: "congressional districts",
  sd: "state senate districts",
  ad: "assembly districts",
  county: "counties",
  place: "cities",
};

function describeShape(layer: GeoLayer, id: string): string {
  if (layer === "county") return `${id} County`;
  if (layer === "place") return id;
  return `${LAYER_NAMES[layer]} ${id}`;
}

export function DistrictMap({
  geo,
  layer,
  point,
  highlight,
  basemap = "off",
  onPick,
}: {
  geo: StateGeo;
  /** Which boundaries to draw on top (and label). */
  layer: GeoLayer;
  /** The picked spot, if any. */
  point?: [number, number];
  /** Shape ids to highlight, per layer (the ones containing the picked spot). */
  highlight?: Partial<Record<GeoLayer, string>>;
  /** Street or satellite tiles underneath (each load tells USGS the area). */
  basemap?: Basemap;
  onPick: (lon: number, lat: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  // The map's size on screen, so labels can be sized in pixels.
  const [screen, setScreen] = useState({ w: 600, h: 416 });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry?.contentRect ?? {};
      if (width && height) setScreen({ w: width, h: height });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  const counties = useMemo(() => projectedLayer(geo.layers.county), [geo]);
  const places = useMemo(() => projectedLayer(geo.layers.place), [geo]);
  const top = useMemo(() => projectedLayer(geo.layers[layer]), [geo, layer]);

  const home = useMemo<ViewBox>(() => {
    const [x0, y0, x1, y1] = counties.reduce(
      ([a, b, c, d], s) => [
        Math.min(a, s.box[0]),
        Math.min(b, s.box[1]),
        Math.max(c, s.box[2]),
        Math.max(d, s.box[3]),
      ],
      [
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ],
    );
    const pad = (x1 - x0) * 0.03;
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  }, [counties]);
  const [view, setView] = useState<ViewBox>(home);
  useEffect(() => setView(home), [home]);

  // Centre on a newly picked spot that is off screen (e.g. from an address lookup).
  const lastPoint = useRef<string>("");
  useEffect(() => {
    if (!point) return;
    const key = point.join(",");
    if (key === lastPoint.current) return;
    lastPoint.current = key;
    const [x, y] = project(point[0], point[1]);
    setView((v) => {
      const inside = x > v.x && x < v.x + v.w && y > v.y && y < v.y + v.h;
      if (inside && v.w < home.w / 8) return v;
      // Zoom to roughly a city's width around it.
      const w = Math.min(v.w, home.w / 40);
      const h = (w * home.h) / home.w;
      return { x: x - w / 2, y: y - h / 2, w, h };
    });
  }, [point, home]);

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      setView((v) => {
        const w = Math.min(home.w * 1.5, Math.max(home.w / 2000, v.w * factor));
        const k = w / v.w;
        const h = v.h * k;
        return { x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, w, h };
      });
    },
    [home],
  );

  /** Client (screen) coordinates → map coordinates. */
  const toMap = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return [p.x, p.y];
  }, []);

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = toMap(e.clientX, e.clientY);
      if (at) zoomAt(1.2 ** (e.deltaY / 100), at[0], at[1]);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toMap, zoomAt]);

  // Pointers: one drags, two pinch; a press that barely moves is a click.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; pinch?: number }>({ moved: false });
  const [hover, setHover] = useState<string>("");

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = { moved: false };
    else gesture.current.moved = true;
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      // Just hovering: say what's under the cursor.
      const at = toMap(e.clientX, e.clientY);
      if (!at) return;
      const [lon, lat] = invert(at[0], at[1]);
      const shape = shapeAt(geo, layer, lon, lat);
      const place = layer === "place" ? undefined : shapeAt(geo, "place", lon, lat);
      setHover(
        shape ? [describeShape(layer, shape.id), place?.id].filter(Boolean).join(" · ") : "",
      );
      return;
    }
    const all = [...pointers.current.values()];
    if (pointers.current.size === 2) {
      const other = all.find((p) => p !== prev);
      if (!other) return;
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      const mid = toMap((e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
      if (before > 0 && mid) zoomAt(before / after, mid[0], mid[1]);
    } else {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) {
        const a = toMap(prev.x, prev.y);
        const b = toMap(e.clientX, e.clientY);
        if (a && b) setView((v) => ({ ...v, x: v.x - (b[0] - a[0]), y: v.y - (b[1] - a[1]) }));
      }
      if (Math.hypot(dx, dy) > 0) {
        const start = gesture.current;
        start.moved ||= Math.hypot(dx, dy) > 3;
      }
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const was = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (!was || gesture.current.moved || pointers.current.size > 0) return;
    const at = toMap(e.clientX, e.clientY);
    if (!at) return;
    const [lon, lat] = invert(at[0], at[1]);
    onPick(lon, lat);
  }

  function onKeyDown(e: React.KeyboardEvent<SVGSVGElement>) {
    const step = view.w / 8;
    const cx = view.x + view.w / 2;
    const cy = view.y + view.h / 2;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[e.key];
    if (move) setView((v) => ({ ...v, x: v.x + move[0], y: v.y + move[1] }));
    else if (e.key === "+" || e.key === "=") zoomAt(1 / 1.5, cx, cy);
    else if (e.key === "-" || e.key === "_") zoomAt(1.5, cx, cy);
    else if (e.key === "Enter" || e.key === " ") {
      const [lon, lat] = invert(cx, cy);
      onPick(lon, lat);
    } else return;
    e.preventDefault();
  }

  // The view is fitted inside the SVG, so one side shows more than asked for.
  const perPixel = Math.max(view.w / screen.w, view.h / screen.h);
  const shown: ViewBox = {
    x: view.x + (view.w - screen.w * perPixel) / 2,
    y: view.y + (view.h - screen.h * perPixel) / 2,
    w: screen.w * perPixel,
    h: screen.h * perPixel,
  };
  const info = basemap === "off" ? undefined : BASEMAPS[basemap];
  // Background tiles that have finished loading (by URL).
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const onTileLoad = useCallback(
    (href: string) => setLoaded((s) => (s.has(href) ? s : new Set(s).add(href))),
    [],
  );
  const tiles = info
    ? basemapTiles(info, shown, screen.w * Math.min(2, window.devicePixelRatio || 1), loaded)
    : [];

  // Labels that fit at this zoom: district numbers, and city names once zoomed in.
  // 11 screen pixels, in map units.
  const fontSize = 11 * perPixel;
  const visible = (s: Projected) =>
    s.box[2] > view.x &&
    s.box[0] < view.x + view.w &&
    s.box[3] > view.y &&
    s.box[1] < view.y + view.h;
  // District numbers a little larger; county names are long enough already.
  const topFontSize = layer === "county" ? fontSize : fontSize * 1.3;
  const topLabels =
    layer === "place"
      ? []
      : top.filter((s) => visible(s) && labelFits(s, s.id.length, topFontSize));
  const placeLabels =
    view.w < home.w / 6
      ? places
          .filter((s) => visible(s) && labelFits(s, s.id.length, fontSize))
          .sort((a, b) => b.room - a.room)
          .slice(0, 40)
      : [];

  const highlighted = (shapes: Projected[], id: string | undefined) =>
    id ? shapes.find((s) => s.id === id) : undefined;
  const hiTop = highlighted(top, highlight?.[layer]);
  const hiPlace = layer === "place" ? undefined : highlighted(places, highlight?.place);
  const marker = point ? project(point[0], point[1]) : undefined;

  return (
    <div className={info ? `district-map basemap-${basemap}` : "district-map"}>
      <svg
        ref={svgRef}
        className="district-map-svg"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="application"
        aria-label={`Map of California's ${LAYER_PLURALS[layer]}. Arrow keys pan, plus and minus zoom, Enter picks the centre.`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the map is a widget (arrows pan, +/- zoom, Enter picks; see onKeyDown)
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
        onPointerLeave={() => setHover("")}
        onKeyDown={onKeyDown}
      >
        {/* Each district (or county) its own colour, neighbours always
            different, with a gap between them, and county lines faint on top
            for finding your way. Cities are named, not shaded: their patchy
            limits would break every district into pieces. Over a background
            map the colours turn mostly transparent (styles.css). */}
        {info ? (
          <g className="map-tiles">
            {tiles.map((t) => (
              // A pixel of overlap hides the hairline seams between tiles.
              <image
                key={t.href}
                href={t.href}
                onLoad={() => onTileLoad(t.href)}
                x={t.x}
                y={t.y}
                width={t.size + perPixel}
                height={t.size + perPixel}
                preserveAspectRatio="none"
              />
            ))}
          </g>
        ) : (
          <LayerPaths shapes={counties} className="map-land" />
        )}
        <LayerPaths
          shapes={top}
          className={hiTop ? "map-fills map-fills-dimmed" : "map-fills"}
          colored
        />
        {layer !== "county" && <LayerPaths shapes={counties} className="map-county-lines" />}
        {hiTop && (
          <path
            className={`map-highlight map-color-${hiTop.color}`}
            d={hiTop.d}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {hiPlace && (
          <path className="map-highlight-place" d={hiPlace.d} vectorEffect="non-scaling-stroke" />
        )}
        <g className="map-labels" fontSize={fontSize}>
          {placeLabels.map((s) => (
            <text key={`p-${s.id}`} x={s.label[0]} y={s.label[1]} className="map-label-place">
              {s.id}
            </text>
          ))}
          {topLabels.map((s) => (
            <text key={s.id} x={s.label[0]} y={s.label[1]} fontSize={topFontSize}>
              {s.id}
            </text>
          ))}
        </g>
        {marker && (
          <circle
            className="map-marker"
            cx={marker[0]}
            cy={marker[1]}
            r={view.w / 120}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path
          className="map-crosshair"
          d={`M${view.x + view.w / 2 - view.w / 60} ${view.y + view.h / 2}h${view.w / 30}M${view.x + view.w / 2} ${view.y + view.h / 2 - view.w / 60}v${view.w / 30}`}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="district-map-controls">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => zoomAt(1 / 1.5, view.x + view.w / 2, view.y + view.h / 2)}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoomAt(1.5, view.x + view.w / 2, view.y + view.h / 2)}
        >
          −
        </button>
        <button type="button" aria-label="Show all of California" onClick={() => setView(home)}>
          ⌂
        </button>
      </div>
      <div className="district-map-readout" aria-live="polite">
        {hover || "Click where you live"}
      </div>
      {info && (
        <a
          className="district-map-credit"
          href={BASEMAP_SOURCE.creditUrl}
          target="_blank"
          rel="noreferrer"
        >
          {BASEMAP_SOURCE.credit}
        </a>
      )}
    </div>
  );
}
