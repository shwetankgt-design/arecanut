import { useNavigate } from "react-router-dom";
import { ClipboardList, Building2, ChevronRight } from "lucide-react";
import { useAuth } from "../AuthContext";

// Deliberately light — no data fetching, no heavy components. Its only job is
// to route the field team to the form they need; each destination page owns
// its own data loading.
export default function EntryLanding() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  const options = [
    {
      key: "farmer",
      show: hasPermission("survey_entry"),
      icon: ClipboardList,
      title: "Farmer Survey",
      description: "Full arecanut farmer data collection — land holding, cultivation, sales, finance, and plot boundary.",
      to: "/entry/farmer",
    },
    {
      key: "fpo",
      show: hasPermission("fpo_consultation"),
      icon: Building2,
      title: "FPO Consultation",
      description: "FPO screening questionnaire — governance, compliance, business performance, and financing readiness.",
      to: "/entry/fpo",
      extra: hasPermission("fpo_consultation") ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); navigate("/fpo-consultations"); }}
          className="text-xs font-medium text-[var(--gt-purple)] underline mt-2 block"
        >
          Resume a saved draft
        </button>
      ) : null,
    },
  ].filter((o) => o.show);

  return (
    <div className="flex flex-col gap-4 max-w-xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">New Entry</h1>
        <p className="text-sm text-[var(--gt-text-muted)]">Choose what you're recording today.</p>
      </div>

      <div className="flex flex-col gap-3">
        {options.map(({ key, icon: Icon, title, description, to, extra }) => (
          <button
            key={key}
            type="button"
            onClick={() => navigate(to)}
            className="gt-card p-4 text-left flex items-start gap-3 hover:border-[var(--gt-purple)] border border-transparent transition-colors"
          >
            <div className="w-11 h-11 rounded-xl gt-gradient text-white flex items-center justify-center shrink-0">
              <Icon size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[var(--gt-purple-dark)]">{title}</div>
              <p className="text-sm text-[var(--gt-text-muted)] mt-0.5">{description}</p>
              {extra}
            </div>
            <ChevronRight size={18} className="text-[var(--gt-text-muted)] shrink-0 mt-2" />
          </button>
        ))}
      </div>
    </div>
  );
}
