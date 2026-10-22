import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken, getRefreshToken, setRefreshToken, AUTH_EVENT } from "./api";
import { analytics, identifyUser, resetIdentity } from "./lib/analytics";
import { setCurrentUser as setSyncUser } from "./lib/syncManager";
import { pendingCount } from "./offlineQueue";

export interface AuthUser {
  username: string;
  full_name: string;
  role: "admin" | "field";
  permissions: string[];
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  // Resolves to false if the user cancelled because of unsynced surveys —
  // the caller should not navigate away in that case.
  logout: () => Promise<boolean>;
  hasPermission: (module: string) => boolean;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  login: async () => {},
  logout: async () => true,
  hasPermission: () => false,
});

const USER_CACHE_KEY = "gt_user_cache";

function cacheUser(u: AuthUser) {
  localStorage.setItem(USER_CACHE_KEY, JSON.stringify(u));
}
function readCachedUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = () => {
    const token = getToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    // Show the cached identity immediately so a device that goes offline right
    // after login doesn't get bounced back to the login screen. Also scope
    // the sync queue to this user right away — otherwise a device that's
    // offline through this whole check (the common field case) never tells
    // the sync manager who's logged in until/unless api.me() succeeds.
    // sessionRestored: this session carried through from before — including
    // across an app update — so anything queued on this device was
    // collected by this same user. See syncManager.setCurrentUser.
    const cached = readCachedUser();
    if (cached) {
      setUser(cached);
      setSyncUser(cached.username, { sessionRestored: true });
    }

    api
      .me()
      .then((u: AuthUser) => {
        setUser(u);
        cacheUser(u);
        identifyUser(u.username, u.role);
        setSyncUser(u.username, { sessionRestored: true });
      })
      .catch(() => {
        // A genuine 401 already cleared the token via AUTH_EVENT — respect that.
        // Any other failure (offline, DNS, etc.) just means we can't refresh the
        // profile right now; keep working from the cached identity.
        if (!getToken()) setUser(null);
        else if (!cached) setUser(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadMe();
    const onExpired = () => setUser(null);
    window.addEventListener(AUTH_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EVENT, onExpired);
  }, []);

  const login = async (username: string, password: string) => {
    try {
      const res = await api.login(username, password);
      setToken(res.access_token);
      setRefreshToken(res.refresh_token);
      const u = { username: res.username, full_name: res.full_name, role: res.role, permissions: res.permissions || [] };
      setUser(u);
      cacheUser(u);
      identifyUser(u.username, u.role);
      analytics.track("login_success");
      setSyncUser(u.username);
    } catch (e) {
      analytics.track("login_failed");
      throw e;
    }
  };

  const logout = async () => {
    // A shared device logging out with unsynced surveys still queued is
    // exactly how they end up getting flushed under the next person's
    // account (see offlineQueue.ts's per-user scoping) — ask first rather
    // than silently stranding or mis-attributing the data.
    if (user) {
      const pending = await pendingCount(user.username);
      if (pending > 0) {
        const proceed = window.confirm(
          `You have ${pending} survey${pending === 1 ? "" : "s"} not yet synced to the server. ` +
            `Logging out now won't delete them, but they won't sync until you log back in as ${user.username}. Log out anyway?`
        );
        if (!proceed) return false;
      }
    }
    const refreshToken = getRefreshToken();
    if (refreshToken) api.logout(refreshToken).catch(() => {});
    setToken(null);
    setRefreshToken(null);
    localStorage.removeItem(USER_CACHE_KEY);
    setUser(null);
    resetIdentity();
    setSyncUser(null);
    return true;
  };

  const hasPermission = (module: string) => !!user && (user.role === "admin" || user.permissions.includes(module));

  return <Ctx.Provider value={{ user, loading, login, logout, hasPermission }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
