import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, FileEdit, CheckCircle2 } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../AuthContext";

interface Row {
  id: number;
  status: string;
  fpo_name: string | null;
  district: string | null;
  respondent_name: string | null;
  created_at: string;
  updated_at: string;
}

export default function FPOConsultationsList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    api.listFpoConsultations().then(setRows).catch((e) => setError(e.message));
  }, []);

  const drafts = rows.filter((r) => r.status === "draft");
  const submitted = rows.filter((r) => r.status === "submitted");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">FPO Consultations</h1>
          <p className="text-sm text-[var(--gt-text-muted)]">Resume a draft or review a completed consultation.</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/entry/fpo")}
          className="flex items-center gap-1.5 bg-[var(--gt-purple)] text-white px-3 py-2 rounded-lg text-sm font-semibold shrink-0"
        >
          <Plus size={16} /> New
        </button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div>
        <div className="font-semibold text-sm mb-2 text-[var(--gt-purple-dark)]">Drafts <span className="text-[var(--gt-text-muted)] font-normal">({drafts.length})</span></div>
        <div className="flex flex-col gap-2">
          {drafts.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => navigate(`/entry/fpo?id=${r.id}`)}
              className="gt-card p-3 text-left flex items-center gap-3 hover:border-[var(--gt-purple)] border border-transparent transition-colors"
            >
              <FileEdit size={18} className="text-amber-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{r.fpo_name || "(FPO name not yet entered)"}</div>
                <div className="text-xs text-[var(--gt-text-muted)]">{r.district || "—"} · by {user?.full_name} · last saved {new Date(r.updated_at).toLocaleString()}</div>
              </div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 shrink-0">Draft</span>
            </button>
          ))}
          {drafts.length === 0 && <div className="text-sm text-[var(--gt-text-muted)] px-1">No drafts in progress.</div>}
        </div>
      </div>

      <div>
        <div className="font-semibold text-sm mb-2 text-[var(--gt-purple-dark)]">Submitted <span className="text-[var(--gt-text-muted)] font-normal">({submitted.length})</span></div>
        <div className="flex flex-col gap-2">
          {submitted.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => navigate(`/entry/fpo?id=${r.id}`)}
              className="gt-card p-3 text-left flex items-center gap-3 hover:border-[var(--gt-purple)] border border-transparent transition-colors"
            >
              <CheckCircle2 size={18} className="text-[var(--gt-success)] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{r.fpo_name || "—"}</div>
                <div className="text-xs text-[var(--gt-text-muted)]">{r.district || "—"} · submitted {new Date(r.updated_at).toLocaleString()}</div>
              </div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700 shrink-0">Submitted</span>
            </button>
          ))}
          {submitted.length === 0 && <div className="text-sm text-[var(--gt-text-muted)] px-1">No submitted consultations yet.</div>}
        </div>
      </div>
    </div>
  );
}
