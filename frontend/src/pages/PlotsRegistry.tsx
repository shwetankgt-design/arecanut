import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Polygon, Popup, Marker, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../api";
import { useLang } from "../LangContext";
import { trDistrict } from "../i18n";

interface Boundary {
  label: string | null;
  points: { lat: number; lng: number }[];
  area_acres: number | null;
}

interface PlotRow {
  survey_id: number;
  farmer_id: string | null;
  farmer_name: string | null;
  village: string | null;
  taluka: string | null;
  district: string | null;
  areca_area_acres: number | null;
  status: string;
  geo_lat: number | null;
  geo_long: number | null;
  boundaries: Boundary[];
}

const DISTRICT_COLORS: Record<string, string> = {
  Shivamogga: "#5A2D82",
  Chikkamagaluru: "#A6266E",
  Davanagere: "#F0AB00",
  Tumakuru: "#1E8E5A",
  Udupi: "#2563EB",
  "Dakshina Kannada": "#C4304A",
};
const DEFAULT_COLOR = "#5A2D82";
// The map is locked to Karnataka (approximate bounding box, a little padding around the state):
// the user cannot pan or zoom out beyond it, which keeps the tiles at a useful resolution,
// and points outside it (bad GPS fixes, test entries) are not drawn.
const KARNATAKA_BOUNDS: L.LatLngBoundsLiteral = [[11.3, 73.8], [18.7, 78.8]];
const KARNATAKA_CENTER: LatLngTuple = [14.8, 76.2];
const MIN_ZOOM = 7;
const MAX_ZOOM = 19;
// Farmer-name labels are always on from this zoom level; below it they appear on hover
// so a statewide view is not a wall of overlapping text.
const LABEL_ZOOM = 13;

const inKarnataka = (lat: number, lng: number) =>
  lat >= KARNATAKA_BOUNDS[0][0] && lat <= KARNATAKA_BOUNDS[1][0] && lng >= KARNATAKA_BOUNDS[0][1] && lng <= KARNATAKA_BOUNDS[1][1];

const validPoint = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
  && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

function pinIcon(color: string) {
  return L.divIcon({
    className: "",
    iconSize: [22, 30],
    iconAnchor: [11, 29],
    popupAnchor: [0, -26],
    html: `<svg width="22" height="30" viewBox="0 0 22 30" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 0C4.9 0 0 4.9 0 11c0 8.2 11 19 11 19s11-10.8 11-19C22 4.9 17.1 0 11 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="11" cy="11" r="4" fill="#fff"/></svg>`,
  });
}

// Name flags are hidden by CSS below LABEL_ZOOM. The class is toggled on the map element itself:
// MapContainer ignores later changes to its own className prop.
function applyLabelZoom(map: L.Map) {
  map.getContainer().classList.toggle("plot-labels-off", map.getZoom() < LABEL_ZOOM);
}

function FitToBounds({ bounds }: { bounds: LatLngBoundsExpression | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18, animate: false });
      applyLabelZoom(map); // the zoom listener below is briefly detached while React re-renders
    }
  }, [bounds, map]);
  return null;
}

function LabelZoomWatcher() {
  const map = useMapEvents({ zoomend: () => applyLabelZoom(map) });
  useEffect(() => { applyLabelZoom(map); }, [map]);
  return null;
}

export default function PlotsRegistry() {
  const [plots, setPlots] = useState<PlotRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [districtFilter, setDistrictFilter] = useState("");
  const [districts, setDistricts] = useState<string[]>([]);
  const navigate = useNavigate();
  const { lang } = useLang();

  useEffect(() => {
    api.listPlots(false).then((d) => { setPlots(d); setLoaded(true); }).catch((e) => { setError(e.message); setLoaded(true); });
    api.districts().then(setDistricts).catch(console.error);
  }, []);

  const filtered = useMemo(
    () => (districtFilter ? plots.filter((p) => p.district === districtFilter) : plots),
    [plots, districtFilter]
  );

  // One entry per farmer: its drawn boundaries (cleaned) plus the point the name flag sits on
  // (centre of the first boundary, or the survey's own GPS point when no boundary exists).
  const { items, outsideCount } = useMemo(() => {
    const out: { plot: PlotRow; polygons: LatLngTuple[][]; anchor: LatLngTuple; hasBoundary: boolean }[] = [];
    let outside = 0;
    for (const p of filtered) {
      const polygons: LatLngTuple[][] = [];
      for (const b of p.boundaries || []) {
        const pts = (b.points || []).filter((pt) => validPoint(pt?.lat, pt?.lng)).map((pt) => [pt.lat, pt.lng] as LatLngTuple);
        if (pts.length >= 3) polygons.push(pts);
      }
      let anchor: LatLngTuple | null = null;
      if (polygons.length > 0) {
        const first = polygons[0];
        anchor = [first.reduce((a, c) => a + c[0], 0) / first.length, first.reduce((a, c) => a + c[1], 0) / first.length];
      } else if (validPoint(p.geo_lat, p.geo_long)) {
        anchor = [p.geo_lat as number, p.geo_long as number];
      }
      if (!anchor) continue;
      if (!inKarnataka(anchor[0], anchor[1])) { outside++; continue; }
      out.push({ plot: p, polygons, anchor, hasBoundary: polygons.length > 0 });
    }
    return { items: out, outsideCount: outside };
  }, [filtered]);

  // Zoom target: every boundary vertex + every pin currently shown, so picking a district zooms
  // to exactly that district's plots.
  const bounds = useMemo<LatLngBoundsExpression | undefined>(() => {
    const pts: LatLngTuple[] = [];
    for (const it of items) {
      pts.push(it.anchor);
      for (const poly of it.polygons) pts.push(...poly);
    }
    return pts.length ? pts : undefined;
  }, [items]);

  const boundaryCount = items.filter((i) => i.hasBoundary).length;
  const pointOnlyCount = items.length - boundaryCount;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">Plots Registry Map</h1>
          <p className="text-sm text-[var(--gt-text-muted)]">
            {items.length} farmer(s) on the map: {boundaryCount} with plot boundary, {pointOnlyCount} GPS point only
            {districtFilter ? ` · ${trDistrict(districtFilter, lang)}` : " · all districts"}
          </p>
          {outsideCount > 0 && (
            <p className="text-xs text-amber-700 mt-0.5">
              {outsideCount} farmer(s) have coordinates outside Karnataka (likely wrong GPS) and are not shown on this map.
            </p>
          )}
        </div>
        <select className="gt-input w-auto" value={districtFilter} onChange={(e) => setDistrictFilter(e.target.value)}>
          <option value="">All Districts</option>
          {districts.map((d) => (
            <option key={d} value={d}>{trDistrict(d, lang)}</option>
          ))}
        </select>
      </div>

      {error && <div className="text-sm text-[var(--gt-danger)] bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="gt-card overflow-hidden" style={{ height: 560 }}>
        <MapContainer
          center={KARNATAKA_CENTER}
          zoom={MIN_ZOOM}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          maxBounds={KARNATAKA_BOUNDS}
          maxBoundsViscosity={1}
          style={{ height: "100%", width: "100%" }}
        >
          <FitToBounds bounds={bounds} />
          <LabelZoomWatcher />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            bounds={KARNATAKA_BOUNDS}
            maxZoom={MAX_ZOOM}
            detectRetina
          />
          {items.map(({ plot, polygons, anchor, hasBoundary }) => {
            const color = (plot.district && DISTRICT_COLORS[plot.district]) || DEFAULT_COLOR;
            const name = plot.farmer_name || "(name not entered)";
            const popup = (
              <Popup>
                <div className="text-sm">
                  <div className="font-semibold">{name}</div>
                  {plot.farmer_id && <div className="text-xs">{plot.farmer_id}{plot.status === "draft" ? " · draft" : ""}</div>}
                  <div>{[plot.village, plot.taluka].filter(Boolean).join(", ") || "—"}</div>
                  <div>{plot.district || "—"}</div>
                  <div className="mt-1">
                    Declared: <b>{plot.areca_area_acres ?? "—"} ac</b>
                    {polygons.length > 0 && (
                      <>
                        <br />
                        Mapped: <b>{plot.boundaries.map((b) => (b.area_acres != null ? `${b.area_acres} ac` : "—")).join(" + ")}</b>
                      </>
                    )}
                    {!hasBoundary && <><br /><span className="text-xs">GPS point only — no boundary captured</span></>}
                  </div>
                  <button className="text-[var(--gt-purple)] underline text-xs mt-1.5" onClick={() => navigate(`/farmers/${plot.survey_id}`)}>
                    Open farmer record
                  </button>
                </div>
              </Popup>
            );
            return (
              <Fragment key={plot.survey_id}>
                {polygons.map((positions, i) => (
                  <Polygon key={i} positions={positions} pathOptions={{ color, fillOpacity: 0.35, weight: 2 }}>
                    {popup}
                  </Polygon>
                ))}
                <Marker position={anchor} icon={pinIcon(hasBoundary ? color : "#6B7280")} title={name}>
                  <Tooltip direction="top" offset={[0, -26]} permanent className="plot-name-label">
                    {name}
                  </Tooltip>
                  {popup}
                </Marker>
              </Fragment>
            );
          })}
        </MapContainer>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--gt-text-muted)]">
        <span>Map is limited to Karnataka</span>
        <span>Coloured shape + pin = plot boundary (colour = district)</span>
        <span><span style={{ color: "#6B7280" }}>●</span> Grey pin = GPS point only</span>
        <span>Farmer names are written next to the pins from zoom level {LABEL_ZOOM}; when zoomed out, hover a pin to see the name</span>
      </div>

      {loaded && !error && items.length === 0 && (
        <div className="text-center text-sm text-[var(--gt-text-muted)] py-6">
          {districtFilter ? "No plots with coordinates inside Karnataka for this district." : "No plot coordinates captured yet. Open a farmer record and use \"Plot Boundary\" to add one."}
        </div>
      )}
    </div>
  );
}
