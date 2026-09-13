import { useState } from "react";
import { Link } from "react-router-dom";
import { Sprout, AlertCircle, MailCheck, ArrowLeft } from "lucide-react";
import { api } from "../api";

export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!identifier.trim()) {
      setError("Enter your username or email.");
      return;
    }
    setBusy(true);
    try {
      await api.forgotPassword(identifier.trim());
      // Always shown, whether or not the account exists — the backend never
      // reveals which identifiers are registered.
      setSent(true);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center gt-gradient p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6">
        <div className="flex flex-col items-center gap-2 mb-6">
          <div className="w-14 h-14 rounded-2xl gt-gradient text-white flex items-center justify-center">
            <Sprout size={28} />
          </div>
          <div className="text-lg font-bold text-[var(--gt-purple-dark)]">Reset your password</div>
          <div className="text-xs text-[var(--gt-text-muted)] text-center">
            Enter your username or email and we'll send you a reset link.
          </div>
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-3 text-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <MailCheck size={22} />
            </div>
            <p className="text-sm text-[var(--gt-text)]">
              If an account matches <b>{identifier}</b>, a password reset email has been sent. Check your inbox.
            </p>
            <Link to="/login" className="text-sm text-[var(--gt-purple)] font-medium underline mt-2">
              Back to Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <div>
              <label className="gt-label">Username or Email</label>
              <div className={error ? "field-error" : ""}>
                <input
                  className="gt-input"
                  value={identifier}
                  onChange={(e) => { setIdentifier(e.target.value); setError(null); }}
                  autoFocus
                />
              </div>
              {error && (
                <div className="flex items-center gap-1 text-xs text-[var(--gt-danger)] mt-1">
                  <AlertCircle size={12} /> {error}
                </div>
              )}
            </div>
            <button className="gt-btn-primary w-full" disabled={busy}>
              {busy ? "Sending…" : "Send Reset Link"}
            </button>
            <Link to="/login" className="text-sm text-[var(--gt-text-muted)] flex items-center justify-center gap-1 mt-1">
              <ArrowLeft size={14} /> Back to Sign In
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
