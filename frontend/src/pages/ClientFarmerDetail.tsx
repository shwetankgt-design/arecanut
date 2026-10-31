import { serialNo } from "../lib/farmerSerial";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { api } from "../api";

type Groups = Record<string, Record<string, string | number | null>>;
const NC = "Not captured";
const show = (v: string | number | null | undefined, key: string) =>
  v === null || v === undefined || v === "" ? NC : typeof v === "number" && !/year/.test(key) ? v.toLocaleString("en-IN") : String(v);

// Read-only farmer profile (a full page, not a popup). Fields come from the masked server response only.
export default function ClientFarmerDetail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const id = params.get("id");
  const [state, setState] = useState<{ id: string; groups?: Groups; error?: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    api.clientFarmer(id)
      .then((d) => live && setState({ id, groups: d.groups }))
      .catch((e) => live && setState({ id, error: e.message }));
    return () => { live = false; };
  }, [id]);

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/client/farmers"));
  const backBtn = (
    <button type="button" onClick={back} className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-[var(--gt-border)] bg-white text-[var(--gt-purple)] hover:bg-[#F6F4F9] self-start">
      <ArrowLeft size={15} /> Back
    </button>
  );
  const cur = state && state.id === id ? state : null;
  const name = cur?.groups?.Personal?.farmer_name;

  return (
    <div className="flex flex-col gap-4">
      {backBtn}
      <div>
        <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">{name ? String(name) : "Farmer profile"}</h1>
        <p className="text-sm text-[var(--gt-text-muted)]">{serialNo(id)} · read-only</p>
      </div>
      {!id && <div className="text-sm text-red-700">No farmer selected.</div>}
      {id && !cur && <div className="text-center py-12 text-[var(--gt-text-muted)]">Loading…</div>}
      {cur?.error && <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle size={15} /> {cur.error}</div>}
      <div className="grid md:grid-cols-2 gap-3">
        {cur?.groups && Object.entries(cur.groups).map(([g, fields]) => (
          <section key={g} className="gt-card p-4">
            <h2 className="text-xs font-bold uppercase tracking-wide text-[var(--gt-purple)] mb-2">{g}</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {Object.entries(fields).map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[11px] text-[var(--gt-text-muted)]">{k.replace(/_/g, " ")}</dt>
                  <dd className={`break-words ${v === null || v === "" ? "text-[var(--gt-text-muted)]" : ""}`}>{k === "farmer_id" ? serialNo(String(v)) : show(v, k)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="pt-1">{backBtn}</div>
    </div>
  );
}
