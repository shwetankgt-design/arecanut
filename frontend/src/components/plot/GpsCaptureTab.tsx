import { useState } from "react";
import { Geolocation } from "@capacitor/geolocation";
import { Capacitor } from "@capacitor/core";
import { MapPin, Undo2, AlertCircle, Navigation } from "lucide-react";
import type { LatLngPoint, PlotBoundary } from "../../lib/plotBoundary";

interface Props {
  points: PlotBoundary;
  onChange: (points: PlotBoundary) => void;
}

// Genuinely shared across web and the Capacitor Android app — @capacitor/geolocation
// normalizes the underlying platform API (browser Geolocation on web, native
// GPS on Android), matching the cross-platform contract in the spec §6.
export default function GpsCaptureTab({ points, onChange }: Props) {
  const [accuracyByIndex, setAccuracyByIndex] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isWeb = Capacitor.getPlatform() === "web";

  const capture = async () => {
    setError(null);

    if (isWeb && !window.isSecureContext) {
      setError("Location requires a secure connection (HTTPS) — this page is being served over plain HTTP.");
      return;
    }

    setBusy(true);
    try {
      const perm = await Geolocation.requestPermissions().catch(() => null);
      if (perm && perm.location === "denied") {
        setError("Location permission denied — enable it in your device/browser settings.");
        setBusy(false);
        return;
      }

      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
      const point: LatLngPoint = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const nextIndex = points.length;
      onChange([...points, point]);
      setAccuracyByIndex((prev) => ({ ...prev, [nextIndex]: pos.coords.accuracy }));
    } catch (e: any) {
      const code = e?.code;
      if (code === 1) setError("Location permission denied — enable it in your device/browser settings.");
      else if (code === 3) setError("Location request timed out — try again in an open area with better GPS signal.");
      else setError(e?.message || "Could not get your location. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const undo = () => {
    onChange(points.slice(0, -1));
    setAccuracyByIndex((prev) => {
      const next = { ...prev };
      delete next[points.length - 1];
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm text-[var(--gt-text-muted)]">
        Walk to each corner of the plot and tap "Capture Current Point" there. Capture at least 3 points, in order, to form the boundary.
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-[var(--gt-danger)]/30 text-[var(--gt-danger)] text-sm rounded-lg px-3 py-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="flex gap-2">
        <button className="gt-btn-primary flex items-center gap-2 flex-1 justify-center" onClick={capture} disabled={busy}>
          <Navigation size={16} className={busy ? "animate-pulse" : ""} /> {busy ? "Getting location…" : "Capture Current Point"}
        </button>
        <button className="gt-btn-secondary flex items-center gap-1.5" onClick={undo} disabled={points.length === 0}>
          <Undo2 size={16} /> Undo
        </button>
      </div>

      {points.length > 0 && (
        <div className="gt-card p-3 max-h-64 overflow-y-auto">
          {points.map((p, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-[var(--gt-border)] last:border-none text-sm">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[var(--gt-purple)] text-white text-xs font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                <span className="font-mono text-xs">{p.lat.toFixed(6)}, {p.lng.toFixed(6)}</span>
              </div>
              {accuracyByIndex[i] != null && (
                <span className="text-[11px] text-[var(--gt-text-muted)] flex items-center gap-1">
                  <MapPin size={11} /> ±{Math.round(accuracyByIndex[i])}m
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
