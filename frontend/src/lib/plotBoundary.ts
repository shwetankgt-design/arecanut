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

export function formatArea(acres: number): string {
  return `${acres.toFixed(2)} acre${acres === 1 ? "" : "s"}`;
}
