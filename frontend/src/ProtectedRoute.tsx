import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

interface Props {
  /** Module key required to view this route, or "admin" for admin-only routes.
   * Omit for routes any authenticated user may view. */
  require?: string;
  /** Alternative to `require`: passes if the user has ANY of these modules —
   * for a route (like the New Entry landing page) that's a front door to
   * several independently-grantable modules. */
  requireAny?: string[];
}

export default function ProtectedRoute({ require, requireAny }: Props) {
  const { user, loading, hasPermission } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-[var(--gt-text-muted)]">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  if (require === "admin" && user.role !== "admin") {
    return <Navigate to="/" replace />;
  }
  if (require && require !== "admin" && !hasPermission(require)) {
    return <Navigate to="/" replace />;
  }
  if (requireAny && !requireAny.some((m) => hasPermission(m))) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
