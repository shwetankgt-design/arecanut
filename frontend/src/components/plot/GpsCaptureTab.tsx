import { useEffect, useRef, useState } from "react";
import { Geolocation } from "@capacitor/geolocation";
import { Capacitor } from "@capacitor/core";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Undo2, AlertCircle, Navigation, X, Play, Square, RotateCcw, RefreshCw } from "lucide-react";
import type { LatLngPoint, PlotBoundary } from "../../lib/plotBoundary";
import { areaInAcres, haversineMeters, formatArea, hasSelfIntersection } from "../../lib/plotBoundary";
import { t } from "../../i18n";
import { useLang } from "../../LangContext";

// @capacitor/geolocation (both the web shim and the native Android plugin)
// hard-rejects a non-positive `timeout` — the native side throws
// IONGLOCInvalidTimeoutException, surfaced as watchPosition's error callback
// rather than a thrown exception, which the original "Walk the Perimeter"
// code silently swallowed (`if (err || !pos) return`). That's why the mode
// never produced a single point on Android. `timeout` must stay positive.
//
// Separately: on Android, `interval` (the real update cadence) defaults to
// whatever `timeout` is set to when not passed explicitly — see the plugin's
// createOptions(): `call.getNumber("interval", -1).let { if (it < 0) timeout
// else it }`. Omitting `interval` here would silently throttle updates to
// once per TRACK_TIMEOUT_MS regardless of how fast the user is walking.
const TRACK_TIMEOUT_MS = 30000;
const TRACK_INTERVAL_MS = 1000;
const CORNERS_INTERVAL_MS = 1000;

// Known @capacitor/geolocation error codes (web: numeric per the W3C
// PositionError spec; Android native: "OS-PLUG-GLOC-00NN" strings from
// GeolocationErrors.kt) mapped to a field-readable message instead of being
// swallowed.
function geoErrorMessage(err: any): { message: string; isPermissionDenied: boolean } {
  const code = err?.code;
  if (code === 1 || code === "OS-PLUG-GLOC-0003") {
    return { message: "Location permission denied — enable it in your device/browser settings.", isPermissionDenied: true };
  }
  if (code === "OS-PLUG-GLOC-0007") {
    return { message: "Location services are turned off on this device — enable GPS and retry.", isPermissionDenied: false };
  }
  if (code === 3 || code === "OS-PLUG-GLOC-0010") {
    return { message: "Couldn't get a GPS fix in time — move to open sky and retry.", isPermissionDenied: false };
  }
  if (code === 2 || code === "OS-PLUG-GLOC-0002") {
    return { message: "Position temporarily unavailable — retrying automatically.", isPermissionDenied: false };
  }
  return { message: err?.message || "Could not get your location. Please try again.", isPermissionDenied: false };
}

const TRACK_MAP_DEFAULT_CENTER = { lat: 13.9299, lng: 75.5681 }; // Shivamogga, Karnataka arecanut belt — same fallback as DrawMapTab

const LIVE_MARKER_ICON = L.divIcon({
  className: "",
  html: `<div style="width:16px;height:16px;border-radius:9999px;background:#2563EB;border:2px solid white;box-shadow:0 0 2px rgba(0,0,0,0.4);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

interface Props {
  points: PlotBoundary;
  onChange: (points: PlotBoundary) => void;
  /** Farmer-reported area, if any — used only for a finish-time sanity check
   * (GPS area wildly off the reported figure), never written back. */
  reportedAreaAcres?: number;
}

type GpsMode = "corners" | "track";

// A GPS chip's very first fix after a cold/warm start is usually its worst —
// it often comes from a cell-tower/wifi estimate before the chip has had time
// to lock onto enough satellites. The old implementation called
// getCurrentPosition() once and accepted whatever came back, which is why
// field accuracy was inconsistent (sometimes ±3m, sometimes ±50m+ depending
// on how quickly that single fix arrived). This version instead watches for
// up to MAX_WAIT_MS, keeps the single best (lowest-accuracy) sample seen, and
// auto-accepts early once a genuinely good fix (<= TARGET_ACCURACY_M) shows
// up — so a clear-sky reading still returns quickly, but a noisy one gets a
// real chance to settle instead of being accepted on the first jittery read.
const MAX_WAIT_MS = 20000;
const TARGET_ACCURACY_M = 6;
const WARN_ACCURACY_M = 20; // accepted, but flagged — canopy/urban-canyon conditions can genuinely not do better than this

// Continuous "walk the perimeter" track mode: a point is only kept once the
// walker has moved at least the chosen step distance from the last kept
// point (GPS jitter while standing still would otherwise flood the polygon
// with noise right on top of itself). The step distance is user-selectable
// because a small plot wants a fine spacing for shape accuracy, while a
// larger farm's perimeter is long enough that a finer spacing means more
// points and a longer walk. Capped at 10m (previously went up to 50m) —
// on a typical sub-acre plot here (~45m across, ~180m perimeter) a 50m
// spacing produced a 3-point triangle instead of an actual boundary, which
// is exactly the bad reading reported from the field.
const STEP_OPTIONS_M = [3, 5, 10];
const DEFAULT_STEP_M = 5;
// Two-tier accuracy handling: a reading this noisy or worse is dropped
// outright (one bad moment would otherwise put a visible spike in the
// boundary); a reading between FLAG and MAX is kept — rejecting anything
// above ~15m would make the mode unusable under arecanut canopy — but
// flagged, so the post-walk summary can tell the user how much of the
// boundary came from a weak fix.
const MAX_TRACK_ACCURACY_M = 30;
const FLAG_TRACK_ACCURACY_M = 15;
// Before the walk starts recording vertices, wait for a fix at least this
// good — otherwise the first vertex is often a cold-start cell/wifi estimate
// that can be hundreds of meters off, which skews every area calculation
// for the rest of the walk (the GPS chip hasn't had time to lock onto
// satellites yet; see the same reasoning in "Tap Each Corner" below).
const GATE_ACCURACY_M = 15;
const GATE_MAX_WAIT_MS = 20000; // after this long still failing to reach GATE_ACCURACY_M, let the user start anyway rather than stranding them
// If no GPS fix at all arrives for this long mid-walk, surface it — a
// silently stalled watch (screen lock, WebView suspended, lost signal
// entirely) would otherwise look identical to "still walking, 0 new points"
// with no indication anything is wrong.
const STALL_WARNING_MS = 20000;

// Genuinely shared across web and the Capacitor Android app — @capacitor/geolocation
// normalizes the underlying platform API (browser Geolocation on web, native
// GPS on Android), matching the cross-platform contract in the spec §6.
export default function GpsCaptureTab({ points, onChange, reportedAreaAcres }: Props) {
  const { lang } = useLang();
  const [mode, setMode] = useState<GpsMode>("corners");

  // --- "Tap Each Corner" mode state ---
  const [accuracyByIndex, setAccuracyByIndex] = useState<Record<number, number>>({});
  const [capturing, setCapturing] = useState(false);
  const [liveAccuracy, setLiveAccuracy] = useState<number | null>(null);
  const [lastAccuracy, setLastAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<string | null>(null);
  const bestRef = useRef<{ point: LatLngPoint; accuracy: number } | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  // --- "Walk the Perimeter" track mode state ---
  const [tracking, setTracking] = useState(false);
  // True while waiting for an initial fix good enough to seed vertex #1 —
  // during this phase fixes update the live marker/accuracy readout but
  // nothing is appended to trackPoints yet.
  const [acquiring, setAcquiring] = useState(false);
  const [acquiringTimedOut, setAcquiringTimedOut] = useState(false);
  const [trackPoints, setTrackPoints] = useState<PlotBoundary>([]);
  // Parallel to trackPoints: true at index i if that vertex's accuracy was in
  // the "flagged" band (kept, but noisier than ideal) — kept in local state
  // only, never written into the exported PlotBoundary shape.
  const [trackFlags, setTrackFlags] = useState<boolean[]>([]);
  const [trackSkipped, setTrackSkipped] = useState(0); // readings dropped for being too noisy — surfaced so a user in bad-signal terrain understands why progress looks slow
  const [stepMeters, setStepMeters] = useState(DEFAULT_STEP_M);
  const [trackLiveAccuracy, setTrackLiveAccuracy] = useState<number | null>(null);
  const [signalStalled, setSignalStalled] = useState(false);
  const [pendingWarnings, setPendingWarnings] = useState<string[] | null>(null);
  const trackWatchIdRef = useRef<string | null>(null);
  const lastKeptRef = useRef<LatLngPoint | null>(null);
  // Mirrors trackPoints/trackFlags synchronously — finishTrack reads these
  // instead of the state variables, because a fix can still arrive and call
  // setTrackPoints while finishTrack is mid-`await` on clearWatch, and the
  // state variable it closed over at call time would then be one point stale.
  const trackPointsRef = useRef<PlotBoundary>([]);
  const trackFlagsRef = useRef<boolean[]>([]);
  const lastFixAtRef = useRef<number>(0);
  const stallCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<any>(null);
  // The watchPosition callback lives for the whole duration of the walk —
  // far longer than a single render — so it can't rely on the `acquiring`
  // state value (it would see whatever that was at the moment the watch
  // started, frozen forever). This ref is the live source of truth for it.
  const acquiringRef = useRef(false);

  // --- Walk the Perimeter live map (shows the user's current position and
  // the path walked so far, so they can see on-screen whether they're
  // actually tracing the real plot boundary rather than drifting off it) ---
  const [livePosition, setLivePosition] = useState<LatLngPoint | null>(null);
  const trackMapDivRef = useRef<HTMLDivElement>(null);
  const trackMapRef = useRef<L.Map | null>(null);
  const trackMarkerRef = useRef<L.Marker | null>(null);
  const trackPolylineRef = useRef<L.Polyline | null>(null);
  const trackPolygonRef = useRef<L.Polygon | null>(null);

  const isWeb = Capacitor.getPlatform() === "web";

  const requestLocationPermission = async (): Promise<boolean> => {
    try {
      const perm = await Geolocation.requestPermissions().catch(() => null);
      if (perm && perm.location === "denied") {
        setError("Location permission denied — enable it in your device/browser settings.");
        return false;
      }
    } catch {
      // requestPermissions can throw on some platforms even when permission is fine — proceed and let watchPosition itself report a real failure.
    }
    return true;
  };

  // ---------------- Tap Each Corner ----------------

  const finishCapture = async (suppressNoFixError = false) => {
    if (watchIdRef.current) {
      await Geolocation.clearWatch({ id: watchIdRef.current }).catch(() => {});
      watchIdRef.current = null;
    }
    stopRef.current = null;
    setCapturing(false);
    setLiveAccuracy(null);

    const best = bestRef.current;
    bestRef.current = null;
    if (!best) {
      // suppressNoFixError: a more specific error (e.g. permission denied)
      // was already set by the caller — don't clobber it with the generic
      // "no fix" message.
      if (!suppressNoFixError) setError(t("No GPS fix was obtained — try again in an open area with better signal.", lang));
      return;
    }
    const nextIndex = points.length;
    onChange([...points, best.point]);
    setAccuracyByIndex((prev) => ({ ...prev, [nextIndex]: best.accuracy }));
    setLastAccuracy(best.accuracy);
  };

  const capture = async () => {
    setError(null);
    setLastAccuracy(null);

    if (isWeb && !window.isSecureContext) {
      setError("Location requires a secure connection (HTTPS) — this page is being served over plain HTTP.");
      return;
    }
    if (!(await requestLocationPermission())) return;

    bestRef.current = null;
    setLiveAccuracy(null);
    setCapturing(true);

    const timeoutId = setTimeout(() => finishCapture(), MAX_WAIT_MS);
    stopRef.current = () => {
      clearTimeout(timeoutId);
      finishCapture();
    };

    try {
      const id = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: MAX_WAIT_MS, interval: CORNERS_INTERVAL_MS, maximumAge: 0, minimumUpdateInterval: CORNERS_INTERVAL_MS },
        (pos, err) => {
          if (err || !pos) {
            // A permission revoke mid-capture won't fix itself by waiting —
            // stop immediately instead of burning the full MAX_WAIT_MS.
            // Any other error (timeout/position-unavailable on a single
            // tick) is treated as transient, same as before: the outer
            // MAX_WAIT_MS timer is the real safety net for those.
            const { message, isPermissionDenied } = geoErrorMessage(err);
            if (isPermissionDenied) {
              clearTimeout(timeoutId);
              setError(t(message, lang));
              finishCapture(true);
            }
            return;
          }
          const accuracy = pos.coords.accuracy;
          setLiveAccuracy(accuracy);
          if (!bestRef.current || accuracy < bestRef.current.accuracy) {
            bestRef.current = { point: { lat: pos.coords.latitude, lng: pos.coords.longitude }, accuracy };
          }
          if (accuracy <= TARGET_ACCURACY_M) {
            clearTimeout(timeoutId);
            finishCapture();
          }
        }
      );
      watchIdRef.current = id;
    } catch (e: any) {
      clearTimeout(timeoutId);
      setCapturing(false);
      setLiveAccuracy(null);
      setError(t(geoErrorMessage(e).message, lang));
    }
  };

  const cancelCapture = () => {
    stopRef.current?.();
  };

  const undo = () => {
    onChange(points.slice(0, -1));
    setAccuracyByIndex((prev) => {
      const next = { ...prev };
      delete next[points.length - 1];
      return next;
    });
  };

  // ---------------- Walk the Perimeter live map ----------------

  // The map div unmounts whenever `mode` leaves "track" (conditional render
  // below), so the Leaflet instance tied to that div must be torn down and
  // recreated on the way back in — reusing a stale map/div pairing would
  // silently no-op every update.
  useEffect(() => {
    if (mode !== "track") {
      trackMapRef.current?.remove();
      trackMapRef.current = null;
      trackMarkerRef.current = null;
      trackPolylineRef.current = null;
      trackPolygonRef.current = null;
      return;
    }
    if (trackMapRef.current || !trackMapDivRef.current) return;
    const center = trackPoints[0] || TRACK_MAP_DEFAULT_CENTER;
    const map = L.map(trackMapDivRef.current, { center: [center.lat, center.lng], zoom: 18 });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    }).addTo(map);
    // Esri's satellite tiles are pure imagery with no labels — this reference
    // overlay adds place names/roads/boundaries on top, matching Google's old
    // "hybrid" map type. Same approach as DrawMapTab.
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      pane: "overlayPane",
    }).addTo(map);
    trackMapRef.current = map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Live position (every raw GPS fix, even ones dropped from the saved track
  // for being too close together) keeps the on-map marker moving smoothly so
  // the user can see they're tracking their actual position in real time.
  useEffect(() => {
    const map = trackMapRef.current;
    if (!livePosition || !map) return;
    const latlng: L.LatLngTuple = [livePosition.lat, livePosition.lng];
    if (!trackMarkerRef.current) {
      trackMarkerRef.current = L.marker(latlng, { icon: LIVE_MARKER_ICON, zIndexOffset: 999 }).addTo(map);
    } else {
      trackMarkerRef.current.setLatLng(latlng);
    }
    map.panTo(latlng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePosition]);

  // The walked path (only the kept/filtered points) redraws as a line, and
  // once there are enough points to close a shape, a translucent polygon
  // preview too — so the user can tell early whether the shape looks right.
  useEffect(() => {
    const map = trackMapRef.current;
    if (!map) return;
    trackPolylineRef.current?.remove();
    trackPolygonRef.current?.remove();
    trackPolylineRef.current = null;
    trackPolygonRef.current = null;
    const latlngs = trackPoints.map((p) => [p.lat, p.lng] as [number, number]);
    if (trackPoints.length >= 2) {
      trackPolylineRef.current = L.polyline(latlngs, { color: "#A6266E", weight: 3 }).addTo(map);
    }
    if (trackPoints.length >= 3) {
      trackPolygonRef.current = L.polygon(latlngs, { color: "#A6266E", weight: 2, fillColor: "#5A2D82", fillOpacity: 0.25 }).addTo(map);
    }
  }, [trackPoints]);

  // ---------------- Walk the Perimeter ----------------

  // Shared by both the initial watch and a manual restart after a signal
  // stall — defined once per render and read via refs for anything that
  // must stay live across the whole (long-running) watch, since Capacitor
  // holds onto whichever callback instance it was given at watchPosition()
  // time regardless of later re-renders.
  const handleTrackFix = (pos: any, err: any) => {
    lastFixAtRef.current = Date.now();
    setSignalStalled(false);
    if (err || !pos) {
      const { message, isPermissionDenied } = geoErrorMessage(err);
      if (isPermissionDenied) {
        setError(t(message, lang));
        stopTrackingWatch();
      }
      // Any other error on a single tick is treated as transient — the
      // stall watchdog below is what flags a *prolonged* loss of signal,
      // rather than reacting to one noisy/missed reading.
      return;
    }
    const { latitude, longitude, accuracy } = pos.coords;
    const point: LatLngPoint = { lat: latitude, lng: longitude };
    setLivePosition(point); // every raw fix moves the on-map marker, regardless of the filters below
    setTrackLiveAccuracy(accuracy);

    if (acquiringRef.current) {
      // Gate: don't record a vertex until either a genuinely good fix shows
      // up, or we've waited long enough that holding the enumerator up
      // any further would do more harm than a slightly noisier first point.
      if (accuracy <= GATE_ACCURACY_M || Date.now() - acquireStartedAtRef.current > GATE_MAX_WAIT_MS) {
        acquiringRef.current = false;
        setAcquiring(false);
        setAcquiringTimedOut(accuracy > GATE_ACCURACY_M);
        lastKeptRef.current = point;
        const flagged = accuracy > FLAG_TRACK_ACCURACY_M;
        trackPointsRef.current = [point];
        trackFlagsRef.current = [flagged];
        setTrackPoints([point]);
        setTrackFlags([flagged]);
      }
      return;
    }

    if (accuracy > MAX_TRACK_ACCURACY_M) {
      setTrackSkipped((n) => n + 1);
      return;
    }
    if (lastKeptRef.current && haversineMeters(lastKeptRef.current, point) < stepMeters) {
      return; // hasn't moved far enough since the last kept point yet — standing still or walking very slowly
    }
    lastKeptRef.current = point;
    const flagged = accuracy > FLAG_TRACK_ACCURACY_M;
    trackPointsRef.current = [...trackPointsRef.current, point];
    trackFlagsRef.current = [...trackFlagsRef.current, flagged];
    setTrackPoints(trackPointsRef.current);
    setTrackFlags(trackFlagsRef.current);
  };

  const acquireStartedAtRef = useRef(0);

  const startTracking = async () => {
    setError(null);
    setPendingWarnings(null);
    if (isWeb && !window.isSecureContext) {
      setError("Location requires a secure connection (HTTPS) — this page is being served over plain HTTP.");
      return;
    }
    if (!(await requestLocationPermission())) return;

    setTrackPoints([]);
    setTrackFlags([]);
    trackPointsRef.current = [];
    trackFlagsRef.current = [];
    setTrackSkipped(0);
    lastKeptRef.current = null;
    acquiringRef.current = true;
    setAcquiring(true);
    setAcquiringTimedOut(false);
    setSignalStalled(false);
    acquireStartedAtRef.current = Date.now();
    lastFixAtRef.current = Date.now();
    setTracking(true);

    try {
      const id = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: TRACK_TIMEOUT_MS, interval: TRACK_INTERVAL_MS, maximumAge: 0, minimumUpdateInterval: TRACK_INTERVAL_MS },
        handleTrackFix
      );
      trackWatchIdRef.current = id;
    } catch (e: any) {
      setTracking(false);
      setAcquiring(false);
      setError(t(geoErrorMessage(e).message, lang));
    }
  };

  // Recovery path for a stalled watch (see the stall-watchdog effect below)
  // — re-requests a fresh watch without discarding the walk in progress.
  const restartTrackingWatch = async () => {
    if (trackWatchIdRef.current) {
      await Geolocation.clearWatch({ id: trackWatchIdRef.current }).catch(() => {});
      trackWatchIdRef.current = null;
    }
    setSignalStalled(false);
    lastFixAtRef.current = Date.now();
    try {
      const id = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: TRACK_TIMEOUT_MS, interval: TRACK_INTERVAL_MS, maximumAge: 0, minimumUpdateInterval: TRACK_INTERVAL_MS },
        handleTrackFix
      );
      trackWatchIdRef.current = id;
    } catch (e: any) {
      setError(t(geoErrorMessage(e).message, lang));
    }
  };

  // ---------------- Dev-only simulation harness ----------------
  // This feature has shipped broken twice (missing `interval`, then a
  // rejected `timeout: 0`) without any way to catch it short of physically
  // walking a field. This replays synthetic fixes through the exact same
  // handleTrackFix() the real GPS watch uses — same gate, same spacing
  // filter, same accuracy flagging, same closure/self-intersection checks —
  // so the pipeline is regression-testable in a browser in seconds.
  // Dev-build only: tree-shaken out of the production bundle since
  // `import.meta.env.DEV` is statically false there.
  const [simRunning, setSimRunning] = useState(false);

  function buildSimulatedSquareTrack(order: "clean" | "bowtie"): { lat: number; lng: number; accuracy: number }[] {
    const center = TRACK_MAP_DEFAULT_CENTER;
    const halfSideM = 22.5; // a 45m square ≈ 2025 m² ≈ 0.50 acres — comparable to the field-reported plot size
    const dLat = halfSideM / 111320;
    const dLng = halfSideM / (111320 * Math.cos((center.lat * Math.PI) / 180));
    const bl = { lat: center.lat - dLat, lng: center.lng - dLng };
    const br = { lat: center.lat - dLat, lng: center.lng + dLng };
    const tr = { lat: center.lat + dLat, lng: center.lng + dLng };
    const tl = { lat: center.lat + dLat, lng: center.lng - dLng };
    // "clean": walks the perimeter in order — a proper, non-crossing square.
    // "bowtie": visits the corners out of order (bl → tr → br → tl) so the
    // two "diagonal" edges cross at the center — a deliberate self-
    // intersection to verify hasSelfIntersection() catches it end-to-end.
    const corners = order === "clean" ? [bl, br, tr, tl] : [bl, tr, br, tl];
    const fixes: { lat: number; lng: number; accuracy: number }[] = [
      // A noisy cold-start fix ~200m off, well outside the gate threshold —
      // must be held back by the gate and never become vertex #1.
      { lat: center.lat + 0.0018, lng: center.lng + 0.0018, accuracy: 80 },
    ];
    for (let side = 0; side < 4; side++) {
      const from = corners[side];
      const to = corners[(side + 1) % 4];
      for (let step = 0; step <= 4; step++) {
        const f = step / 4;
        const accuracy = step === 2 ? 18 : 5; // one mid-edge point per side deliberately in the "flagged" (15-30m) band
        fixes.push({ lat: from.lat + (to.lat - from.lat) * f, lng: from.lng + (to.lng - from.lng) * f, accuracy });
      }
    }
    if (order === "bowtie") fixes.splice(fixes.length - 2); // also leave the loop unclosed, to exercise that warning too
    return fixes;
  }

  const runSimulation = async (variant: "clean" | "bowtie") => {
    setError(null);
    setPendingWarnings(null);
    setTrackPoints([]);
    setTrackFlags([]);
    trackPointsRef.current = [];
    trackFlagsRef.current = [];
    setTrackSkipped(0);
    lastKeptRef.current = null;
    acquiringRef.current = true;
    setAcquiring(true);
    setAcquiringTimedOut(false);
    acquireStartedAtRef.current = Date.now();
    lastFixAtRef.current = Date.now();
    setTracking(true);
    setSimRunning(true);

    for (const fix of buildSimulatedSquareTrack(variant)) {
      handleTrackFix({ coords: { latitude: fix.lat, longitude: fix.lng, accuracy: fix.accuracy } }, null);
      await new Promise((r) => setTimeout(r, 30)); // fast-forwarded — only the sequence/filtering is under test, not real-time pacing
    }
    setSimRunning(false);
    // Deliberately leaves `tracking` on so "Finish" can be tapped through
    // the real UI, exercising the actual closure/self-intersection warning
    // panel rather than asserting on internal state directly.
  };

  const stopTrackingWatch = async () => {
    if (trackWatchIdRef.current) {
      await Geolocation.clearWatch({ id: trackWatchIdRef.current }).catch(() => {});
      trackWatchIdRef.current = null;
    }
    setTracking(false);
    acquiringRef.current = false;
    setAcquiring(false);
    setLivePosition(null);
    setTrackLiveAccuracy(null);
    setSignalStalled(false);
    trackMarkerRef.current?.remove();
    trackMarkerRef.current = null;
  };

  // Loop-closure, self-intersection and reported-area sanity checks — none
  // of these are fatal, since a field enumerator sometimes genuinely can't
  // complete a perfect loop (fences, water, terrain), so they're surfaced
  // as warnings with an explicit "Save Anyway" rather than blocking.
  const collectTrackWarnings = (finalPoints: PlotBoundary): string[] => {
    const warnings: string[] = [];
    const closureGap = haversineMeters(finalPoints[0], finalPoints[finalPoints.length - 1]);
    const closureThreshold = Math.max(30, stepMeters * 4);
    if (closureGap > closureThreshold) {
      warnings.push(
        t("The walked path doesn't return close to where it started (gap: {n}m) — the boundary may be cut short.", lang).replace("{n}", String(Math.round(closureGap)))
      );
    }
    if (hasSelfIntersection(finalPoints)) {
      warnings.push(t("The walked path crosses itself — the resulting shape may not reflect the real boundary.", lang));
    }
    if (reportedAreaAcres && reportedAreaAcres > 0) {
      const gpsArea = areaInAcres(finalPoints);
      const diffPct = (Math.abs(gpsArea - reportedAreaAcres) / reportedAreaAcres) * 100;
      if (diffPct > 40) {
        warnings.push(
          t("GPS-measured area ({gps} acres) is very different from the reported area ({reported} acres).", lang)
            .replace("{gps}", gpsArea.toFixed(2))
            .replace("{reported}", reportedAreaAcres.toFixed(2))
        );
      }
    }
    return warnings;
  };

  const finishTrack = async (force = false) => {
    const finalPoints = trackPointsRef.current;
    if (finalPoints.length < 3) {
      setError(t("The walked path needs at least 3 distinct points to form a boundary — keep walking further around the plot and try again.", lang));
      return;
    }
    if (!force) {
      const warnings = collectTrackWarnings(finalPoints);
      if (warnings.length > 0) {
        // Deliberately don't stop the watch here — "Go Back & Keep Walking"
        // needs the walk still live and still accumulating points, not a
        // dead watch the user would otherwise have to restart from scratch
        // (which would also wipe the very points they're trying to keep).
        setPendingWarnings(warnings);
        return;
      }
    }
    await stopTrackingWatch();
    onChange(finalPoints); // a completed walk replaces the plot's boundary outright — it's the whole perimeter, not one more corner
    setPendingWarnings(null);
    setTrackPoints([]);
    setTrackFlags([]);
    trackPointsRef.current = [];
    trackFlagsRef.current = [];
    lastKeptRef.current = null;
  };

  const discardTrack = async () => {
    await stopTrackingWatch();
    setTrackPoints([]);
    setTrackFlags([]);
    trackPointsRef.current = [];
    trackFlagsRef.current = [];
    setTrackSkipped(0);
    setPendingWarnings(null);
    lastKeptRef.current = null;
  };

  // Stall watchdog: if tracking is on but no fix (good, bad, or error) has
  // arrived for a while, something's actually wrong (screen lock suspended
  // the WebView, signal lost entirely, etc.) rather than the walker just
  // moving slowly — surface it instead of silently showing "0 new points".
  useEffect(() => {
    if (!tracking) {
      if (stallCheckIntervalRef.current) {
        clearInterval(stallCheckIntervalRef.current);
        stallCheckIntervalRef.current = null;
      }
      return;
    }
    stallCheckIntervalRef.current = setInterval(() => {
      if (Date.now() - lastFixAtRef.current > STALL_WARNING_MS) setSignalStalled(true);
    }, 5000);
    return () => {
      if (stallCheckIntervalRef.current) {
        clearInterval(stallCheckIntervalRef.current);
        stallCheckIntervalRef.current = null;
      }
    };
  }, [tracking]);

  // A multi-minute walk is long enough for the screen to lock mid-way,
  // which suspends the WebView and silently stops location updates — hold
  // a screen wake lock for the duration. Feature-detected: unsupported or
  // denied just means the screen can lock as before, no functional loss.
  useEffect(() => {
    if (!tracking) {
      wakeLockRef.current?.release?.().catch(() => {});
      wakeLockRef.current = null;
      return;
    }
    let cancelled = false;
    const acquireWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          const lock = await (navigator as any).wakeLock.request("screen");
          if (cancelled) {
            lock.release().catch(() => {});
            return;
          }
          wakeLockRef.current = lock;
        }
      } catch {
        // Unsupported browser/WebView, or the user denied it — the walk
        // still works, the screen may just dim/lock mid-way.
      }
    };
    acquireWakeLock();
    // The Wake Lock API auto-releases whenever the page goes to the
    // background, so coming back to the foreground needs a fresh request.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      wakeLockRef.current?.release?.().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [tracking]);

  const trackDistanceMeters = trackPoints.reduce(
    (sum, p, i) => (i === 0 ? 0 : sum + haversineMeters(trackPoints[i - 1], p)),
    0
  );
  const trackAreaAcres = trackPoints.length >= 3 ? areaInAcres(trackPoints) : 0;
  const trackFlaggedCount = trackFlags.filter(Boolean).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {([
          { key: "corners" as const, label: "Tap Each Corner" },
          { key: "track" as const, label: "Walk the Perimeter" },
        ]).map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            disabled={capturing || tracking}
            className={`flex-1 text-sm font-medium px-3 py-2 rounded-lg border transition-colors ${
              mode === m.key
                ? "gt-gradient text-white border-transparent shadow-sm"
                : "bg-white text-[var(--gt-text-muted)] border-[var(--gt-border)]"
            }`}
          >
            {t(m.label, lang)}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-[var(--gt-danger)]/30 text-[var(--gt-danger)] text-sm rounded-lg px-3 py-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {mode === "corners" && (
        <>
          <div className="text-sm text-[var(--gt-text-muted)]">
            {t("Walk to each corner of the plot and tap \"Capture Current Point\" there. Capture at least 3 points, in order, to form the boundary.", lang)}
          </div>

          {lastAccuracy != null && lastAccuracy > WARN_ACCURACY_M && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 text-amber-800 text-sm rounded-lg px-3 py-2">
              <AlertCircle size={16} /> {t("Last point's accuracy was only ±{n}m — that corner may be off. Step into open sky (away from trees/buildings) and tap \"Undo\" then recapture it if you can.", lang).replace("{n}", String(Math.round(lastAccuracy)))}
            </div>
          )}

          {capturing && (
            <div className="gt-card p-3 flex items-center justify-between gap-3 bg-[#F1EBF7] border-none">
              <div className="flex items-center gap-2 text-sm text-[var(--gt-purple-dark)]">
                <Navigation size={16} className="animate-pulse" />
                {liveAccuracy != null
                  ? t("Improving accuracy… current best ±{n}m", lang).replace("{n}", String(Math.round(liveAccuracy)))
                  : t("Getting a GPS fix…", lang)}
              </div>
              <button type="button" className="text-xs font-semibold text-[var(--gt-purple-dark)] underline flex items-center gap-1" onClick={cancelCapture}>
                <X size={12} /> {t("Use this reading now", lang)}
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <button className="gt-btn-primary flex items-center gap-2 flex-1 justify-center" onClick={capture} disabled={capturing}>
              <Navigation size={16} className={capturing ? "animate-pulse" : ""} /> {t(capturing ? "Capturing…" : "Capture Current Point", lang)}
            </button>
            <button className="gt-btn-secondary flex items-center gap-1.5" onClick={undo} disabled={points.length === 0 || capturing}>
              <Undo2 size={16} /> {t("Undo", lang)}
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
                    <span className={`text-[11px] flex items-center gap-1 ${accuracyByIndex[i] > WARN_ACCURACY_M ? "text-amber-600 font-medium" : "text-[var(--gt-text-muted)]"}`}>
                      <MapPin size={11} /> ±{Math.round(accuracyByIndex[i])}m
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {mode === "track" && (
        <>
          <div className="text-sm text-[var(--gt-text-muted)]">
            {t("Stand at one corner, tap \"Start Walking\", then walk the full boundary of the plot once, in order, back to where you started. The system logs your position automatically as you go — no tapping needed per corner. Tap \"Finish\" once you've walked the whole perimeter.", lang)}
          </div>

          <div className="relative w-full rounded-xl border border-[var(--gt-border)] bg-[#F1EBF7]" style={{ height: 280 }}>
            {/* Same DOM-ownership caveat as DrawMapTab: Leaflet takes over this
                div directly once created, so it must stay free of React-rendered
                children — the placeholder below is an absolutely-positioned sibling. */}
            <div ref={trackMapDivRef} className="w-full h-full rounded-xl" />
            {!tracking && trackPoints.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--gt-text-muted)] bg-white/60 pointer-events-none px-4 text-center">
                {t("Tap \"Start Walking\" to see your live position and walked path here.", lang)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-sm text-[var(--gt-text)] whitespace-nowrap">{t("Capture a point every", lang)}</label>
            <select
              className="gt-input w-auto"
              value={stepMeters}
              onChange={(e) => setStepMeters(Number(e.target.value))}
              disabled={tracking}
            >
              {STEP_OPTIONS_M.map((m) => (
                <option key={m} value={m}>{m} {t("meters", lang)}</option>
              ))}
            </select>
            <span className="text-xs text-[var(--gt-text-muted)]">
              {t("Use a smaller spacing for a small/precise plot, a larger spacing for a bigger farm (fewer points, faster walk).", lang)}
            </span>
          </div>

          {tracking && acquiring && (
            <div className="gt-card p-3 flex items-center justify-between gap-3 bg-[#F1EBF7] border-none">
              <div className="flex items-center gap-2 text-sm text-[var(--gt-purple-dark)]">
                <Navigation size={16} className="animate-pulse" />
                {trackLiveAccuracy != null
                  ? t("Acquiring GPS fix… current ±{n}m", lang).replace("{n}", String(Math.round(trackLiveAccuracy)))
                  : t("Acquiring GPS fix…", lang)}
              </div>
            </div>
          )}

          {tracking && !acquiring && (
            <div className="gt-card p-3 flex flex-col gap-2 bg-[#F1EBF7] border-none">
              <div className="flex items-center gap-2 text-sm text-[var(--gt-purple-dark)] font-medium">
                <Navigation size={16} className="animate-pulse" /> {t("Walking… keep moving along the boundary", lang)}
              </div>
              <div className="flex items-center gap-4 text-sm flex-wrap">
                <span><b>{trackPoints.length}</b> {t("points logged", lang)}</span>
                <span>{t("Distance walked:", lang)} <b>{Math.round(trackDistanceMeters)}m</b></span>
                {trackPoints.length >= 3 && <span>{t("Enclosed area so far:", lang)} <b>{formatArea(trackAreaAcres, lang)}</b></span>}
                {trackLiveAccuracy != null && <span className="text-xs text-[var(--gt-text-muted)]">{t("current accuracy:", lang)} ±{Math.round(trackLiveAccuracy)}m</span>}
                <span className="text-xs text-[var(--gt-text-muted)]">{t("spacing:", lang)} {stepMeters}m</span>
                {trackSkipped > 0 && <span className="text-[var(--gt-text-muted)]">({trackSkipped} {t("noisy readings skipped", lang)})</span>}
                {trackFlaggedCount > 0 && <span className="text-amber-600">({trackFlaggedCount} {t("lower-accuracy points kept", lang)})</span>}
              </div>
            </div>
          )}

          {acquiringTimedOut && tracking && !acquiring && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 text-amber-800 text-sm rounded-lg px-3 py-2">
              <AlertCircle size={16} /> {t("Couldn't reach a strong GPS fix before starting — the first point of this walk may be less accurate. Consider discarding and retrying from open sky if possible.", lang)}
            </div>
          )}

          {signalStalled && tracking && (
            <div className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-300 text-amber-800 text-sm rounded-lg px-3 py-2">
              <span className="flex items-center gap-2"><AlertCircle size={16} /> {t("No GPS updates for a while — signal may be lost.", lang)}</span>
              <button type="button" className="text-xs font-semibold underline shrink-0 flex items-center gap-1" onClick={restartTrackingWatch}>
                <RefreshCw size={12} /> {t("Restart GPS", lang)}
              </button>
            </div>
          )}

          {pendingWarnings && (
            <div className="gt-card p-3 flex flex-col gap-2 bg-amber-50 border border-amber-300">
              <div className="flex items-center gap-2 text-sm text-amber-800 font-medium">
                <AlertCircle size={16} /> {t("This walk has some issues — review before saving:", lang)}
              </div>
              <ul className="text-sm text-amber-800 list-disc pl-5 flex flex-col gap-1">
                {pendingWarnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
              <div className="flex gap-2 mt-1">
                <button type="button" className="gt-btn-secondary flex-1" onClick={() => setPendingWarnings(null)}>
                  {t("Go Back & Keep Walking", lang)}
                </button>
                <button type="button" className="gt-btn-primary flex-1" onClick={() => finishTrack(true)}>
                  {t("Save Anyway", lang)}
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {!tracking ? (
              <button className="gt-btn-primary flex items-center gap-2 flex-1 justify-center" onClick={startTracking}>
                <Play size={16} /> {t("Start Walking", lang)}
              </button>
            ) : (
              <>
                <button className="gt-btn-primary flex items-center gap-2 flex-1 justify-center" onClick={() => finishTrack()}>
                  <Square size={16} /> {t("Finish", lang)}
                </button>
                <button className="gt-btn-secondary flex items-center gap-1.5" onClick={discardTrack}>
                  <RotateCcw size={16} /> {t("Discard", lang)}
                </button>
              </>
            )}
          </div>

          {!tracking && points.length >= 3 && (
            <div className="gt-card p-3 flex items-center justify-between flex-wrap gap-2 text-sm">
              <span><b>{points.length}</b> {t("points in saved boundary", lang)}</span>
              <span className="text-[var(--gt-purple-dark)] font-semibold">{formatArea(areaInAcres(points), lang)}</span>
            </div>
          )}

          {import.meta.env.DEV && !tracking && (
            <div className="gt-card p-3 flex flex-col gap-2 border-dashed">
              <div className="text-xs font-semibold text-[var(--gt-text-muted)]">Dev only — replay a synthetic walk through the real capture pipeline</div>
              <div className="flex gap-2">
                <button type="button" className="gt-btn-secondary flex-1 text-xs" disabled={simRunning} onClick={() => runSimulation("clean")}>
                  Simulate clean 45m square (~0.50 acre)
                </button>
                <button type="button" className="gt-btn-secondary flex-1 text-xs" disabled={simRunning} onClick={() => runSimulation("bowtie")}>
                  Simulate self-crossing / unclosed walk
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
