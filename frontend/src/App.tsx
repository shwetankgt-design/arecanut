import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./Layout";
import Dashboard from "./pages/Dashboard";
import FarmerList from "./pages/FarmerList";
import DataEntryWizard from "./pages/DataEntryWizard";
import MasterData from "./pages/MasterData";
import SurveyView from "./pages/SurveyView";
import PlotBoundaryCapture from "./pages/PlotBoundaryCapture";
import PlotsRegistry from "./pages/PlotsRegistry";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
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
                <Route path="/entry" element={<DataEntryWizard />} />
                <Route path="/farmers" element={<FarmerList />} />
                <Route path="/farmers/:id" element={<SurveyView />} />
                <Route path="/farmers/:id/plot-boundary" element={<PlotBoundaryCapture />} />
                <Route path="/plots" element={<PlotsRegistry />} />
                <Route path="/masters" element={<MasterData />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </LangProvider>
    </AuthProvider>
  );
}
