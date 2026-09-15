import { useEffect, useRef, useState } from "react";
import { Undo2, RotateCcw, CheckCircle2, AlertCircle, MapPinned } from "lucide-react";
import { loadGoogleMaps, isGoogleMapsConfigured } from "../../lib/googleMaps";
import type { PlotBoundary } from "../../lib/plotBoundary";

interface Props {
  points: PlotBoundary;
  onChange: (points: PlotBoundary) => void;
}

const DEFAULT_CENTER = { lat: 13.9299, lng: 75.5681 }; // Shivamogga, Karnataka arecanut belt

// Web-only for now (the app runs as a Vite web build inside the Capacitor
// WebView too, so this same component already covers "web + the installed
// Android app" per the v1 stack decision — no react-native-maps split needed).
export default function DrawMapTab({ points, onChange }: Props) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polygonRef = useRef<google.maps.Polygon | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const pointsRef = useRef<PlotBoundary>(points);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [editable, setEditable] = useState(points.length >= 3);

  pointsRef.current = points;

  useEffect(() => {
    if (!isGoogleMapsConfigured()) {
      setStatus("error");
      setError("Google Maps API key is not configured yet — this tab will activate once it's added (VITE_GOOGLE_MAPS_API_KEY).");
      return;
    }
    setStatus("loading");
    loadGoogleMaps()
      .then(() => {
        if (!mapDivRef.current) return;
        const center = points[0] || DEFAULT_CENTER;
        const map = new google.maps.Map(mapDivRef.current, {
          center,
          zoom: points.length ? 18 : 16,
          mapTypeId: "hybrid",
          streetViewControl: false,
          fullscreenControl: false,
        });
        mapRef.current = map;

        if (points.length >= 3) {
          drawEditablePolygon(points);
        } else {
          map.addListener("click", (e: google.maps.MapMouseEvent) => {
            if (!e.latLng) return;
            addPoint({ lat: e.latLng.lat(), lng: e.latLng.lng() });
          });
        }
        setStatus("ready");
      })
      .catch((e: Error) => {
        setStatus("error");
        setError(e.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearOverlays() {
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    polygonRef.current?.setMap(null);
    polygonRef.current = null;
  }

  function addPoint(point: { lat: number; lng: number }) {
    const map = mapRef.current;
    if (!map) return;
    const next = [...pointsRef.current, point];
    onChange(next);

    const marker = new google.maps.Marker({
      position: point,
      map,
      label: { text: String(next.length), color: "white", fontSize: "11px", fontWeight: "600" },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 11,
        fillColor: "#5A2D82",
        fillOpacity: 1,
        strokeColor: "white",
        strokeWeight: 2,
      },
    });
    markersRef.current.push(marker);

    polygonRef.current?.setMap(null);
    if (next.length >= 2) {
      polygonRef.current = new google.maps.Polygon({
        paths: next,
        map,
        strokeColor: "#A6266E",
        strokeWeight: 2,
        fillColor: "#5A2D82",
        fillOpacity: 0.25,
      });
    }
  }

  function undo() {
    const next = pointsRef.current.slice(0, -1);
    onChange(next);
    const marker = markersRef.current.pop();
    marker?.setMap(null);
    polygonRef.current?.setMap(null);
    polygonRef.current = null;
    if (next.length >= 2 && mapRef.current) {
      polygonRef.current = new google.maps.Polygon({
        paths: next,
        map: mapRef.current,
        strokeColor: "#A6266E",
        strokeWeight: 2,
        fillColor: "#5A2D82",
        fillOpacity: 0.25,
      });
    }
  }

  function drawEditablePolygon(pts: PlotBoundary) {
    const map = mapRef.current;
    if (!map) return;
    clearOverlays();
    const polygon = new google.maps.Polygon({
      paths: pts,
      map,
      strokeColor: "#A6266E",
      strokeWeight: 2,
      fillColor: "#5A2D82",
      fillOpacity: 0.25,
      editable: true,
      draggable: false,
    });
    polygonRef.current = polygon;

    const syncBack = () => {
      const path = polygon.getPath();
      const next: PlotBoundary = [];
      for (let i = 0; i < path.getLength(); i++) {
        const latLng = path.getAt(i);
        next.push({ lat: latLng.lat(), lng: latLng.lng() });
      }
      onChange(next); // always the full array, never a delta
    };

    const path = polygon.getPath();
    google.maps.event.addListener(path, "set_at", syncBack);
    google.maps.event.addListener(path, "insert_at", syncBack);
    google.maps.event.addListener(path, "remove_at", syncBack);
    setEditable(true);
  }

  function finishBoundary() {
    if (pointsRef.current.length < 3) return;
    // Remove click-to-place markers/listener implicitly by rebuilding as an
    // editable polygon (fresh map click listeners aren't re-added).
    if (mapRef.current) {
      google.maps.event.clearListeners(mapRef.current, "click");
    }
    drawEditablePolygon(pointsRef.current);
  }

  function redraw() {
    clearOverlays();
    onChange([]);
    setEditable(false);
    if (mapRef.current) {
      google.maps.event.clearListeners(mapRef.current, "click");
      mapRef.current.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        addPoint({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-[var(--gt-text-muted)]">
        {editable
          ? "Drag a corner to move it, drag a midpoint to add a vertex, or alt/right-click a corner to delete it."
          : "Tap the map to place each corner of the plot, in order. At least 3 points are needed."}
      </div>

      {status === "error" && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-3">
          <AlertCircle size={18} className="shrink-0" /> {error}
        </div>
      )}

      {status !== "error" && (
        <div
          ref={mapDivRef}
          className="w-full rounded-xl border border-[var(--gt-border)] bg-[#F1EBF7]"
          style={{ height: 360 }}
        >
          {status === "loading" && (
            <div className="w-full h-full flex items-center justify-center text-sm text-[var(--gt-text-muted)]">
              <MapPinned size={18} className="animate-pulse mr-2" /> Loading map…
            </div>
          )}
        </div>
      )}

      {status === "ready" && (
        <div className="flex gap-2">
          {!editable ? (
            <>
              <button className="gt-btn-secondary flex items-center gap-1.5" onClick={undo} disabled={points.length === 0}>
                <Undo2 size={15} /> Undo
              </button>
              <button className="gt-btn-primary flex items-center gap-1.5" onClick={finishBoundary} disabled={points.length < 3}>
                <CheckCircle2 size={15} /> Finish Boundary
              </button>
            </>
          ) : (
            <button className="gt-btn-secondary flex items-center gap-1.5" onClick={redraw}>
              <RotateCcw size={15} /> Redraw
            </button>
          )}
        </div>
      )}
    </div>
  );
}
