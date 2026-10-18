import { t, type Lang } from "../i18n";
// Canonical, platform-independent plot boundary shape + helpers.
// Every capture method (draw / Excel / GPS) and every consumer (registry map,
// area display, backend payload) uses exactly this shape — never redefined
// per method or per screen.

export type LatLngPoint = { lat: number; lng: number };
export type PlotBoundary = LatLngPoint[];
export type CaptureMethod = "draw" | "excel" | "gps";

const EARTH_RADIUS_M = 6378137;

/**
 * Spherical polygon area (square meters) via the "sum of longitude-weighted
 * latitude excess" formula — accurate for plot-sized polygons (a few hectares
 * to a few hundred) without needing a full geodesic library, and correct
 * regardless of which hemisphere/meridian the plot sits in.
 */
export function polygonAreaSqMeters(points: PlotBoundary): number {
  if (points.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const lat1 = (p1.lat * Math.PI) / 180;
    const lat2 = (p2.lat * Math.PI) / 180;
    const lng1 = (p1.lng * Math.PI) / 180;
    const lng2 = (p2.lng * Math.PI) / 180;
    total += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

const SQM_PER_ACRE = 4046.8564224;

export function areaInAcres(points: PlotBoundary): number {
  return Math.round((polygonAreaSqMeters(points) / SQM_PER_ACRE) * 100) / 100;
}

export function haversineMeters(a: LatLngPoint, b: LatLngPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function geographicMidpoint(a: LatLngPoint, b: LatLngPoint): LatLngPoint {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

export interface BoundaryValidation {
  valid: boolean;
  error?: string;
}

/** Same minimum-vertex rule everywhere (draw / Excel / GPS), so no method is
 * more permissive than another. */
export function validateBoundary(points: PlotBoundary): BoundaryValidation {
  if (points.length < 3) {
    return { valid: false, error: "A plot boundary needs at least 3 points." };
  }
  const bad = points.find((p) => Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180);
  if (bad) {
    return { valid: false, error: "One or more points have an invalid latitude/longitude." };
  }
  return { valid: true };
}

// Returns true if segment p1-p2 and p3-p4 cross. Standard orientation-based
// test (no special-casing of collinear overlap — "touching" cases are rare
// enough for a field-walked GPS boundary that a false negative there isn't
// worth the extra complexity).
function segmentsIntersect(p1: LatLngPoint, p2: LatLngPoint, p3: LatLngPoint, p4: LatLngPoint): boolean {
  const orientation = (a: LatLngPoint, b: LatLngPoint, c: LatLngPoint) =>
    Math.sign((b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng));
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/** True if any two non-adjacent edges of the closed ring cross (a "bow-tie"
 * shape) — the shoelace area formula silently under-reports for these rather
 * than erroring, so it's worth flagging to the user rather than saving quietly. */
export function hasSelfIntersection(points: PlotBoundary): boolean {
  const n = points.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Skip edges that share a vertex (adjacent edges, and the pair that
      // both touch the closing edge) — those always "intersect" at the
      // shared point, which isn't a real crossing.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a1 = points[i], a2 = points[(i + 1) % n];
      const b1 = points[j], b2 = points[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

export function formatArea(acres: number, lang: Lang = "en"): string {
  // Kannada has no separate singular form here, so only English pluralises.
  if (lang === "kn") return `${acres.toFixed(2)} ${t("acres", lang)}`;
  return `${acres.toFixed(2)} acre${acres === 1 ? "" : "s"}`;
}
