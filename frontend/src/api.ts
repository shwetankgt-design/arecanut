// In the browser dev server, relative "/api" works via the Vite proxy.
// Packaged into the Android app there's no dev-server proxy, so the mobile
// build is compiled with VITE_API_BASE pointing at the backend's real host.
const BASE = import.meta.env.VITE_API_BASE || "/api";
const TOKEN_KEY = "gt_token";
const REFRESH_KEY = "gt_refresh_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY);
}
export function setRefreshToken(token: string | null) {
  if (token) localStorage.setItem(REFRESH_KEY, token);
  else localStorage.removeItem(REFRESH_KEY);
}

// Fired only once both the access token AND a silent refresh attempt have
// failed, so the app forces a re-login.
export const AUTH_EVENT = "gt-auth-expired";

async function rawFetch(path: string, options?: RequestInit, token?: string | null) {
  return fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
}

// Coalesces concurrent 401s into a single refresh call instead of firing one
// per in-flight request.
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await rawFetch("/auth/refresh", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) });
        if (!res.ok) return false;
        const data = await res.json();
        setToken(data.access_token);
        setRefreshToken(data.refresh_token);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

const AUTH_ENDPOINTS = ["/auth/login", "/auth/refresh", "/auth/forgot-password", "/auth/reset-password"];

async function req(path: string, options?: RequestInit) {
  let res = await rawFetch(path, options, getToken());

  // A 401 from login itself (bad credentials) or from the other public auth
  // endpoints is a normal request failure, not an expired session — it must
  // fall through to the generic error handler below and show the backend's
  // actual message instead of "Session expired".
  if (res.status === 401 && !AUTH_ENDPOINTS.includes(path)) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await rawFetch(path, options, getToken());
    } else {
      setToken(null);
      setRefreshToken(null);
      window.dispatchEvent(new Event(AUTH_EVENT));
      throw new Error("Session expired — please log in again.");
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  login: (username: string, password: string) =>
    req("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: (refreshToken: string) => req("/auth/logout", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) }),
  me: () => req("/auth/me"),
  forgotPassword: (identifier: string) => req("/auth/forgot-password", { method: "POST", body: JSON.stringify({ identifier }) }),
  resetPassword: (token: string, newPassword: string) =>
    req("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, new_password: newPassword }) }),
  districts: () => req("/masters/districts"),
  talukas: (district: string) => req(`/masters/talukas?district=${encodeURIComponent(district)}`),
  villages: (district: string, taluka: string) =>
    req(`/masters/villages?district=${encodeURIComponent(district)}&taluka=${encodeURIComponent(taluka)}`),
  villagesFlat: (): Promise<{ village: string; taluka: string; district: string }[]> => req("/masters/villages-flat"),
  societies: () => req("/masters/societies"),
  crops: () => req("/masters/crops"),
  schemes: () => req("/masters/schemes"),
  machines: () => req("/masters/machines"),
  options: (listCode: string) => req(`/masters/options?list_code=${encodeURIComponent(listCode)}`),
  lookupFarmer: (q: string) => req(`/farmer-master/lookup?q=${encodeURIComponent(q)}`),
  listSurveys: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return req(`/surveys${qs}`);
  },
  getSurvey: (id: number) => req(`/surveys/${id}`),
  createSurvey: (data: any) => req("/surveys", { method: "POST", body: JSON.stringify(data) }),
  updateSurvey: (id: number, data: any) => req(`/surveys/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSurvey: (id: number) => req(`/surveys/${id}`, { method: "DELETE" }),
  dashboardKpis: () => req("/dashboard/kpis"),
  yieldBenchmarks: () => req("/dashboard/yield-benchmarks"),
};
