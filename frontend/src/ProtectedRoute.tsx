import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { featureOn, type Feature } from "./lib/platform";

interface Props {
  /** Module key required to view this route, or "admin" for admin-only routes.
   * Omit for routes any authenticated user may view. */
  require?: string;
  /** Alternative to `require`: passes if the user has ANY of these modules —
   * for a route (like the New Entry landing page) that's a front door to
   * several independently-grantable modules. */
  requireAny?: string[];
  /** MIS pages: only MIS users (and admins) may open these. */
  mis?: boolean;
  /** Client pages: client users (and admins, for oversight) only. */
  clientArea?: boolean;
  /** Web-only feature (see lib/platform.ts): on the mobile app the route is closed unless the feature is enabled there. */
  feature?: Feature;
}

export default function ProtectedRoute({ require, requireAny, mis, clientArea, feature }: Props) {
  const { user, loading, hasPermission } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-[var(--gt-text-muted)]">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  // Roles whose whole job is a web-only feature get a notice on the mobile app instead of a redirect loop.
  if ((user.role === "mis_user" && !featureOn("mis")) || (user.role === "client" && !featureOn("client"))) {
    return <WebOnlyNotice />;
  }
  if (feature && !featureOn(feature)) {
    return <Navigate to="/" replace />;
  }
  // An MIS user may only ever see the MIS pages — anything else bounces to their reports landing page.
  if (user.role === "mis_user" && !location.pathname.startsWith("/mis")) {
    return <Navigate to="/mis" replace />;
  }
  // A client user only ever sees the client pages.
  if (user.role === "client" && !location.pathname.startsWith("/client")) {
    return <Navigate to="/client" replace />;
  }
  if (clientArea && user.role !== "client" && user.role !== "admin") {
    return <Navigate to="/" replace />;
  }
  if (mis && user.role !== "mis_user" && user.role !== "admin") {
    return <Navigate to="/" replace />;
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

function WebOnlyNotice() {
  const { logout } = useAuth();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-lg font-bold text-[var(--gt-purple-dark)]">Please use the web portal</div>
      <p className="text-sm text-[var(--gt-text-muted)] max-w-sm">This account's screens are not available in the mobile app. Sign in from a browser to use them.</p>
      <button type="button" className="gt-btn-secondary" onClick={() => void logout()}>Log out</button>
    </div>
  );
}
