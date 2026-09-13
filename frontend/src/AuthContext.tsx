import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken, getRefreshToken, setRefreshToken, AUTH_EVENT } from "./api";

interface AuthUser {
  username: string;
  full_name: string;
  role: "admin" | "enumerator";
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({ user: null, loading: true, login: async () => {}, logout: () => {} });

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
    // after login doesn't get bounced back to the login screen.
    const cached = readCachedUser();
    if (cached) setUser(cached);

    api
      .me()
      .then((u: AuthUser) => {
        setUser(u);
        cacheUser(u);
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
    const res = await api.login(username, password);
    setToken(res.access_token);
    setRefreshToken(res.refresh_token);
    const u = { username: res.username, full_name: res.full_name, role: res.role };
    setUser(u);
    cacheUser(u);
  };

  const logout = () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) api.logout(refreshToken).catch(() => {});
    setToken(null);
    setRefreshToken(null);
    localStorage.removeItem(USER_CACHE_KEY);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
