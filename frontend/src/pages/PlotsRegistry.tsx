import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Polygon, Popup, useMap } from "react-leaflet";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../api";
import { useLang } from "../LangContext";
import { trDistrict } from "../i18n";

interface PlotRow {
  survey_id: number;
  farmer_name: string;
  village: string;
  taluka: string;
  district: string;
  areca_area_acres: number;
  plot_boundary?: string | null;
  plot_boundary_area_acres?: number | null;
}

const DISTRICT_COLORS: Record<string, string> = {
  Shivamogga: "#5A2D82",
  Chikkamagaluru: "#A6266E",
  Davanagere: "#F0AB00",
  Tumakuru: "#1E8E5A",
  Udupi: "#2563EB",
  "Dakshina Kannada": "#C4304A",
};

const KARNATAKA_CENTER: LatLngTuple = [13.9, 75.6];

function FitToBounds({ bounds }: { bounds: LatLngBoundsExpression | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
  }, [bounds, map]);
  return null;
}

export default function PlotsRegistry() {
  const [plots, setPlots] = useState<PlotRow[]>([]);
  const [districtFilter, setDistrictFilter] = useState("");
  const [districts, setDistricts] = useState<string[]>([]);
  const navigate = useNavigate();
  const { lang } = useLang();

  useEffect(() => {
    api.listPlots(true).then(setPlots).catch(console.error);
    api.districts().then(setDistricts).catch(console.error);
  }, []);

  const filtered = useMemo(
    () => (districtFilter ? plots.filter((p) => p.district === districtFilter) : plots),
    [plots, districtFilter]
  );

  const polygons = useMemo(
    () =>
      filtered
        .map((p) => {
          if (!p.plot_boundary) return null;
          try {
            const pts: { lat: number; lng: number }[] = JSON.parse(p.plot_boundary);
            return { plot: p, positions: pts.map((pt) => [pt.lat, pt.lng] as LatLngTuple) };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as { plot: PlotRow; positions: LatLngTuple[] }[],
    [filtered]
  );

  const bounds: LatLngBoundsExpression | undefined =
    polygons.length > 0 ? polygons.flatMap((p) => p.positions) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">Plots Registry Map</h1>
          <p className="text-sm text-[var(--gt-text-muted)]">{polygons.length} plot(s) with a captured boundary</p>
        </div>
        <select className="gt-input w-auto" value={districtFilter} onChange={(e) => setDistrictFilter(e.target.value)}>
          <option value="">All Districts</option>
          {districts.map((d) => (
            <option key={d} value={d}>{trDistrict(d, lang)}</option>
          ))}
        </select>
      </div>

      <div className="gt-card overflow-hidden" style={{ height: 520 }}>
        <MapContainer center={KARNATAKA_CENTER} zoom={8} style={{ height: "100%", width: "100%" }}>
          <FitToBounds bounds={bounds} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {polygons.map(({ plot, positions }) => (
            <Polygon
              key={plot.survey_id}
              positions={positions}
              pathOptions={{
                color: DISTRICT_COLORS[plot.district] || "#5A2D82",
                fillOpacity: 0.35,
                weight: 2,
              }}
            >
              <Popup>
                <div className="text-sm">
                  <div className="font-semibold">{plot.farmer_name}</div>
                  <div>{plot.village}, {plot.taluka}</div>
                  <div>{plot.district}</div>
                  <div className="mt-1">
                    Declared: <b>{plot.areca_area_acres} ac</b><br />
                    Mapped: <b>{plot.plot_boundary_area_acres ?? "—"} ac</b>
                  </div>
                  <button
                    className="text-[var(--gt-purple)] underline text-xs mt-1.5"
                    onClick={() => navigate(`/farmers/${plot.survey_id}`)}
                  >
                    Open farmer record
                  </button>
                </div>
              </Popup>
            </Polygon>
          ))}
        </MapContainer>
      </div>

      {polygons.length === 0 && (
        <div className="text-center text-sm text-[var(--gt-text-muted)] py-6">
          No plot boundaries captured yet. Open a farmer record and use "Capture Plot Boundary" to add one.
        </div>
      )}
    </div>
  );
}
