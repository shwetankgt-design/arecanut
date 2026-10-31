import { Navigate } from "react-router-dom";
import Dashboard from "./Dashboard";
import { useAuth } from "../AuthContext";
import { featureOn } from "../lib/platform";

// "/" is the Programme Dashboard where it is available; on the mobile app (dashboard is web-only) it sends the user to
// the first module they can use instead.
export default function Home() {
  const { hasPermission } = useAuth();
  if (featureOn("dashboard")) return <Dashboard />;
  if (hasPermission("survey_entry") || hasPermission("fpo_consultation")) return <Navigate to="/entry" replace />;
  if (hasPermission("farmer_records")) return <Navigate to="/farmers" replace />;
  if (hasPermission("plots_map")) return <Navigate to="/plots" replace />;
  return <div className="text-center py-16 text-sm text-[var(--gt-text-muted)]">No mobile modules are assigned to this account.</div>;
}
