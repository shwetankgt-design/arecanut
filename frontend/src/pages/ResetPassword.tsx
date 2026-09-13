import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Sprout, AlertCircle, CheckCircle2 } from "lucide-react";
import { api } from "../api";

// Mirrors the backend's validate_password_strength() — client-side check is
// purely for a faster/friendlier error; the server re-validates regardless.
function passwordWeakness(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters.";
  if (!/[A-Z]/.test(pw)) return "Password must include at least one uppercase letter.";
  if (!/[0-9]/.test(pw)) return "Password must include at least one digit.";
  return null;
}

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const errs: { password?: string; confirm?: string } = {};
    const weakness = passwordWeakness(password);
    if (weakness) errs.password = weakness;
    if (confirm !== password) errs.confirm = "Passwords do not match.";
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate("/login"), 2500);
    } catch (err: any) {
      setError(err.message || "Could not reset password.");
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center gt-gradient p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6 text-center">
          <div className="flex items-center gap-1.5 text-sm text-[var(--gt-danger)] bg-red-50 border border-[var(--gt-danger)]/30 rounded-lg px-3 py-2 mb-4">
            <AlertCircle size={14} /> This reset link is missing its token.
          </div>
          <Link to="/forgot-password" className="text-sm text-[var(--gt-purple)] font-medium underline">
            Request a new reset link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center gt-gradient p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6">
        <div className="flex flex-col items-center gap-2 mb-6">
          <div className="w-14 h-14 rounded-2xl gt-gradient text-white flex items-center justify-center">
            <Sprout size={28} />
          </div>
          <div className="text-lg font-bold text-[var(--gt-purple-dark)]">Set a new password</div>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-3 text-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 size={22} />
            </div>
            <p className="text-sm text-[var(--gt-text)]">Password updated. Redirecting you to sign in…</p>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <div>
              <label className="gt-label">New Password</label>
              <div className={fieldErrors.password ? "field-error" : ""}>
                <input
                  type="password"
                  className="gt-input"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setFieldErrors((f) => ({ ...f, password: undefined })); }}
                  autoFocus
                />
              </div>
              {fieldErrors.password ? (
                <div className="flex items-center gap-1 text-xs text-[var(--gt-danger)] mt-1">
                  <AlertCircle size={12} /> {fieldErrors.password}
                </div>
              ) : (
                <div className="text-[11px] text-[var(--gt-text-muted)] mt-1">
                  At least 10 characters, one uppercase letter, one digit.
                </div>
              )}
            </div>
            <div>
              <label className="gt-label">Confirm Password</label>
              <div className={fieldErrors.confirm ? "field-error" : ""}>
                <input
                  type="password"
                  className="gt-input"
                  value={confirm}
                  onChange={(e) => { setConfirm(e.target.value); setFieldErrors((f) => ({ ...f, confirm: undefined })); }}
                />
              </div>
              {fieldErrors.confirm && (
                <div className="flex items-center gap-1 text-xs text-[var(--gt-danger)] mt-1">
                  <AlertCircle size={12} /> {fieldErrors.confirm}
                </div>
              )}
            </div>
            {error && (
              <div className="flex items-center gap-1.5 text-sm text-[var(--gt-danger)] bg-red-50 border border-[var(--gt-danger)]/30 rounded-lg px-3 py-2">
                <AlertCircle size={14} /> {error}
              </div>
            )}
            <button className="gt-btn-primary w-full" disabled={busy}>
              {busy ? "Updating…" : "Update Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
