import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./Layout";
import Dashboard from "./pages/Dashboard";
import FarmerList from "./pages/FarmerList";
import DataEntryWizard from "./pages/DataEntryWizard";
import MasterData from "./pages/MasterData";
import SurveyView from "./pages/SurveyView";
import FarmerHistory from "./pages/FarmerHistory";
import PlotBoundaryCapture from "./pages/PlotBoundaryCapture";
import PlotsRegistry from "./pages/PlotsRegistry";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import UserManagement from "./pages/UserManagement";
import EntryLanding from "./pages/EntryLanding";
import SyncQueue from "./pages/SyncQueue";
import MisHome from "./pages/MisHome";
import MisViewer from "./pages/MisViewer";
import MisCatalog from "./pages/MisCatalog";
import ClientDashboard from "./pages/ClientDashboard";
import ClientFarmers from "./pages/ClientFarmers";
import ClientFarmerDetail from "./pages/ClientFarmerDetail";
import FPOConsultationWizard from "./pages/FPOConsultationWizard";
import FPOConsultationsList from "./pages/FPOConsultationsList";
import { LangProvider } from "./LangContext";
import { AuthProvider } from "./AuthContext";
import ProtectedRoute from "./ProtectedRoute";

export default function App() {
  return (
    <AuthProvider>
      <LangProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<Dashboard />} />
                {/* No permission gate — this is the logged-in user's own
                    device queue, not a shared/admin resource. */}
                <Route path="/sync-queue" element={<SyncQueue />} />
                <Route element={<ProtectedRoute mis />}>
                  <Route path="/mis" element={<MisHome />} />
                  <Route path="/mis/view/:code" element={<MisViewer />} />
                </Route>
                <Route element={<ProtectedRoute clientArea />}>
                  <Route path="/client" element={<ClientDashboard />} />
                  <Route path="/client/farmers" element={<ClientFarmers />} />
                  <Route path="/client/farmer" element={<ClientFarmerDetail />} />
                </Route>
                <Route element={<ProtectedRoute requireAny={["survey_entry", "fpo_consultation"]} />}>
                  <Route path="/entry" element={<EntryLanding />} />
                </Route>
                <Route element={<ProtectedRoute require="survey_entry" />}>
                  <Route path="/entry/farmer" element={<DataEntryWizard />} />
                </Route>
                <Route element={<ProtectedRoute require="fpo_consultation" />}>
                  <Route path="/entry/fpo" element={<FPOConsultationWizard />} />
                  <Route path="/fpo-consultations" element={<FPOConsultationsList />} />
                </Route>
                <Route element={<ProtectedRoute require="farmer_records" />}>
                  <Route path="/farmers" element={<FarmerList />} />
                  <Route path="/farmers/:id" element={<SurveyView />} />
                  <Route path="/farmers/:id/history" element={<FarmerHistory />} />
                </Route>
                <Route element={<ProtectedRoute require="plots_map" />}>
                  <Route path="/farmers/:id/plot-boundary" element={<PlotBoundaryCapture />} />
                  <Route path="/plots" element={<PlotsRegistry />} />
                </Route>
                <Route element={<ProtectedRoute require="admin" />}>
                  <Route path="/masters" element={<MasterData />} />
                  <Route path="/users" element={<UserManagement />} />
                  <Route path="/mis-catalog" element={<MisCatalog />} />
                </Route>
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </LangProvider>
    </AuthProvider>
  );
}
