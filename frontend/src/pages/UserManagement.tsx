import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api";
import {
  UserPlus, ShieldCheck, X, Search, Pencil, Eye, EyeOff, Copy, Check, RefreshCw, KeyRound,
  CheckCircle2, AlertCircle, Power, UserCog, Building2,
} from "lucide-react";
import MultiSelect from "../components/MultiSelect";
import CatalogPicker from "../components/CatalogPicker";
import type { CatalogItem } from "../lib/mis";
import type { SelectOption } from "../components/MultiSelect";
import Pagination from "../components/Pagination";
import ClientOrgsPanel, { Drawer as SideDrawer } from "./ClientAdmin";
import { paginate, DEFAULT_PAGE_SIZE } from "../lib/paging";

interface UserRow {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  role: string;
  permissions: string[];
  mapped_user_ids: number[];
  mis_access_all?: boolean;
  catalog_item_ids?: number[];
  data_scope_districts?: string[];
  client_id?: number | null;
  client_name?: string | null;
  client_module_codes?: string[];
  is_active: boolean;
  created_at: string;
  locked_until: string | null;
}

// Roles and modules come from the backend (auth.ROLE_DEFS / MODULE_DEFS via /users/access-options), so a new
// one needs no change here. These fallbacks only apply if that request fails.
interface RoleDef { key: string; label: string; description: string; uses_modules: boolean; single_instance: boolean; uses_catalog?: boolean; uses_client?: boolean }
interface ModuleDef { key: string; label: string; description: string; requires_mapped_users?: boolean }
const FALLBACK_ROLES: RoleDef[] = [
  { key: "field", label: "Field Team", description: "Works with records they own; access is set by the modules.", uses_modules: true, single_instance: false },
  { key: "admin", label: "Administrator", description: "Full access to every module and all records.", uses_modules: false, single_instance: true },
];
const FALLBACK_MODULES: ModuleDef[] = [
  { key: "survey_entry", label: "New Survey Entry", description: "Create and edit farmer surveys, including saving drafts." },
  { key: "farmer_records", label: "Farmer Records", description: "View, search, filter and export farmer records; edit them." },
  { key: "plots_map", label: "Plots & Map", description: "See plot boundaries on the map and capture new boundaries." },
  { key: "fpo_consultation", label: "FPO Consultation", description: "Run and review FPO screening consultations." },
  { key: "data_verifier", label: "Data Verifier", description: "Verify the records of mapped users and freeze / unfreeze them (web only).", requires_mapped_users: true },
];

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
const AVATAR_COLORS = ["#5A2D82", "#A6266E", "#1E8E5A", "#2563EB", "#C4304A", "#B45309", "#0F766E"];
function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return (
    <div className="rounded-full text-white font-semibold flex items-center justify-center shrink-0" style={{ width: size, height: size, background: AVATAR_COLORS[h], fontSize: size * 0.38 }}>
      {initials(name)}
    </div>
  );
}

function passwordRules(pw: string) {
  return [
    { ok: pw.length >= 10, label: "At least 10 characters", required: true },
    { ok: /[A-Z]/.test(pw), label: "One uppercase letter", required: true },
    { ok: /\d/.test(pw), label: "One digit", required: true },
    { ok: /[a-z]/.test(pw), label: "One lowercase letter", required: false },
    { ok: /[^A-Za-z0-9]/.test(pw), label: "One symbol (recommended)", required: false },
  ];
}
function strength(pw: string) {
  const rules = passwordRules(pw);
  const score = rules.filter((r) => r.ok).length + (pw.length >= 14 ? 1 : 0);
  const requiredOk = rules.filter((r) => r.required).every((r) => r.ok);
  if (!pw) return { pct: 0, label: "", color: "#E5E7EB", requiredOk };
  if (!requiredOk || score <= 3) return { pct: 30, label: "Weak", color: "#DC2626", requiredOk };
  if (score === 4) return { pct: 55, label: "Fair", color: "#F59E0B", requiredOk };
  if (score === 5) return { pct: 80, label: "Good", color: "#16A34A", requiredOk };
  return { pct: 100, label: "Strong", color: "#15803D", requiredOk };
}
function generatePassword(): string {
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnopqrstuvwxyz", D = "23456789", S = "!@#$%&*?";
  const all = U + L + D + S;
  const buf = new Uint32Array(16);
  crypto.getRandomValues(buf);
  const pick = (set: string, i: number) => set[buf[i] % set.length];
  const chars = [pick(U, 0), pick(L, 1), pick(D, 2), pick(S, 3), ...Array.from({ length: 10 }, (_, i) => pick(all, i + 4))];
  for (let i = chars.length - 1; i > 0; i--) { const j = buf[i] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

function Section({ step, title, hint, children }: { step: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--gt-border)] bg-white">
      <header className="flex items-start gap-3 px-4 pt-4">
        <span className="w-6 h-6 rounded-full bg-[#F1EBF7] text-[var(--gt-purple-dark)] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{step}</span>
        <div>
          <h3 className="text-sm font-semibold text-[var(--gt-purple-dark)] leading-tight">{title}</h3>
          {hint && <p className="text-xs text-[var(--gt-text-muted)] mt-0.5">{hint}</p>}
        </div>
      </header>
      <div className="p-4 pt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function FieldBox({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--gt-text)] mb-1">
        {label} {required && <span className="text-[var(--gt-danger)]">*</span>}
      </label>
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-xs text-[var(--gt-danger)] mt-1"><AlertCircle size={12} /> {error}</p>
      ) : hint ? (
        <p className="text-xs text-[var(--gt-text-muted)] mt-1">{hint}</p>
      ) : null}
    </div>
  );
}

interface FormState {
  username: string;
  full_name: string;
  email: string;
  password: string;
  role: string;
  permissions: string[];
  mapped_user_ids: number[];
  mis_access_all: boolean;
  catalog_item_ids: number[];
  data_scope_districts: string[];
  client_id: string;
  client_module_codes: string[];
}

function UserDrawer({
  editing, users, roles, modules, catalog, districts, onClose, onSaved,
}: {
  editing: UserRow | null;
  users: UserRow[];
  roles: RoleDef[];
  modules: ModuleDef[];
  catalog: CatalogItem[];
  districts: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const initial = useMemo<FormState>(() => editing
    ? { username: editing.username, full_name: editing.full_name, email: editing.email || "", password: "", role: editing.role, permissions: editing.permissions, mapped_user_ids: editing.mapped_user_ids || [],
        mis_access_all: !!editing.mis_access_all, catalog_item_ids: editing.catalog_item_ids || [], data_scope_districts: editing.data_scope_districts || [],
        client_id: editing.client_id ? String(editing.client_id) : "", client_module_codes: editing.client_module_codes || [] }
    : { username: "", full_name: "", email: "", password: "", role: "field", permissions: [], mapped_user_ids: [], mis_access_all: false, catalog_item_ids: [], data_scope_districts: [], client_id: "", client_module_codes: [] }, [editing]);
  const [form, setForm] = useState<FormState>(initial);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [orgs, setOrgs] = useState<{ id: number; name: string; is_active: boolean; modules: string[]; scope: { district: string[]; taluka: string[]; survey_year: string[] } }[]>([]);
  const [clientModules, setClientModules] = useState<{ code: string; label: string; description: string }[]>([]);
  const firstRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const requestClose = () => {
    if (dirty && !confirm("Discard your unsaved changes?")) return;
    onClose();
  };

  useEffect(() => { firstRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") requestClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));
  const show = (k: string) => touched[k] || submitted;

  const roleDef = roles.find((r) => r.key === form.role);
  const usesModules = roleDef ? roleDef.uses_modules : true;
  const usesCatalog = !!roleDef?.uses_catalog;
  const usesClient = !!roleDef?.uses_client;
  useEffect(() => {
    if (!usesClient) return;
    api.clientAdminOrgs().then(setOrgs).catch(() => {});
    api.clientAdminModules().then(setClientModules).catch(() => {});
  }, [usesClient]);
  const selectedOrg = orgs.find((o) => String(o.id) === form.client_id);
  const misUsers = users.filter((u) => u.role === form.role && u.id !== editing?.id);
  const verifierKeys = modules.filter((m) => m.requires_mapped_users).map((m) => m.key);
  const wantsVerifier = usesModules && form.permissions.some((p) => verifierKeys.includes(p));
  const errors: Record<string, string> = {};
  if (!form.full_name.trim()) errors.full_name = "Full name is required.";
  if (!editing) {
    const u = form.username.trim();
    if (!u) errors.username = "Username is required.";
    else if (u.length < 3) errors.username = "Use at least 3 characters.";
    else if (!USERNAME_RE.test(u)) errors.username = "Only letters, numbers, dot, underscore and hyphen.";
    else if (users.some((x) => x.username.toLowerCase() === u.toLowerCase())) errors.username = "This username is already taken.";
  }
  if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) errors.email = "Enter a valid email address.";
  const pw = strength(form.password);
  if (!editing && !form.password) errors.password = "Password is required.";
  else if (form.password && !pw.requiredOk) errors.password = "Password does not meet the required rules.";
  if (usesClient && !form.client_id) errors.client = "Select the client organisation.";
  if (usesClient && form.client_id && form.client_module_codes.length === 0) errors.client_modules = "Select at least one module, otherwise this user sees nothing.";
  if (wantsVerifier && form.mapped_user_ids.length === 0) errors.mapped = "Select at least one user this verifier will review.";
  const errorKeys = Object.keys(errors);

  const candidates = users.filter((u) => u.role === "field" && u.is_active && u.id !== editing?.id);

  const roleOptions: SelectOption[] = roles.map((r) => {
    const heldByOther = r.single_instance && users.some((u) => u.role === r.key && u.id !== editing?.id);
    return {
      value: r.key, label: r.label, description: r.description,
      badge: r.single_instance ? "Only one allowed" : undefined,
      disabled: heldByOther, disabledReason: heldByOther ? `Another user already holds the ${r.label} role.` : undefined,
    };
  });
  const moduleOptions: SelectOption[] = modules.map((m) => ({ value: m.key, label: m.label, description: m.description }));
  const userOptions: SelectOption[] = candidates.map((u) => ({
    value: String(u.id), label: u.full_name, description: `@${u.username}`, icon: <Avatar name={u.full_name} size={24} />,
  }));

  const submit = async () => {
    setSubmitted(true);
    setServerError("");
    if (errorKeys.length) {
      bodyRef.current?.querySelector("[data-invalid='true']")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy(true);
    try {
      const permissions = usesModules ? form.permissions : [];
      const mapped = wantsVerifier ? form.mapped_user_ids : [];
      if (editing) {
        await api.updateUser(editing.id, {
          full_name: form.full_name.trim(),
          email: form.email.trim() || null,
          role: form.role,
          permissions,
          mapped_user_ids: mapped,
          ...(usesCatalog ? { mis_access_all: form.mis_access_all, catalog_item_ids: form.mis_access_all ? form.catalog_item_ids : form.catalog_item_ids, data_scope_districts: form.data_scope_districts } : {}),
          ...(usesClient ? { client_id: Number(form.client_id), client_module_codes: form.client_module_codes } : {}),
          ...(form.password ? { new_password: form.password } : {}),
        });
        onSaved(`${form.full_name.trim()} was updated.`);
      } else {
        await api.createUser({
          username: form.username.trim(),
          full_name: form.full_name.trim(),
          email: form.email.trim() || null,
          password: form.password,
          role: form.role,
          permissions,
          mapped_user_ids: mapped,
          ...(usesCatalog ? { mis_access_all: form.mis_access_all, catalog_item_ids: form.catalog_item_ids, data_scope_districts: form.data_scope_districts } : {}),
          ...(usesClient ? { client_id: Number(form.client_id), client_module_codes: form.client_module_codes } : {}),
        });
        onSaved(`${form.full_name.trim()} was created. They can sign in with username “${form.username.trim()}”.`);
      }
    } catch (e: any) {
      setServerError(e.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const inputCls = (k: string) => `gt-input w-full ${show(k) && errors[k] ? "!border-[var(--gt-danger)]" : ""}`;
  const moduleCount = form.permissions.length;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={editing ? "Edit user" : "Create user"}>
      <div className="absolute inset-0 bg-black/40" onClick={requestClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-xl bg-[#FAF8FC] shadow-2xl flex flex-col">
        <header className="flex items-center gap-3 px-5 py-4 bg-white border-b border-[var(--gt-border)]">
          <div className="w-10 h-10 rounded-xl gt-gradient text-white flex items-center justify-center">{editing ? <UserCog size={20} /> : <UserPlus size={20} />}</div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-[var(--gt-purple-dark)] leading-tight">{editing ? "Edit user" : "Create user"}</h2>
            <p className="text-xs text-[var(--gt-text-muted)] truncate">{editing ? `@${editing.username}` : "Set up sign-in details and what this person can access."}</p>
          </div>
          <button type="button" onClick={requestClose} aria-label="Close" className="p-2 rounded-lg hover:bg-[#F1EBF7]"><X size={18} /></button>
        </header>

        <div ref={bodyRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          <Section step={1} title="Account details" hint="Who this person is and how they will sign in.">
            <FieldBox label="Full name" required error={show("full_name") ? errors.full_name : undefined}>
              <input ref={firstRef} data-invalid={!!(show("full_name") && errors.full_name)} className={inputCls("full_name")} value={form.full_name} placeholder="e.g. Ramesh Kumar"
                onChange={(e) => set("full_name", e.target.value)} onBlur={() => touch("full_name")} />
            </FieldBox>
            <div className="grid sm:grid-cols-2 gap-3">
              <FieldBox label="Username" required error={!editing && show("username") ? errors.username : undefined} hint={editing ? "Username cannot be changed." : "Used to sign in. Letters, numbers, . _ -"}>
                <input data-invalid={!!(!editing && show("username") && errors.username)} className={`${inputCls("username")} ${editing ? "bg-gray-50 text-[var(--gt-text-muted)]" : ""}`} value={form.username} disabled={!!editing} placeholder="e.g. ramesh.k"
                  autoComplete="off" onChange={(e) => set("username", e.target.value)} onBlur={() => touch("username")} />
              </FieldBox>
              <FieldBox label="Email" error={show("email") ? errors.email : undefined} hint="Optional — used for password reset emails.">
                <input data-invalid={!!(show("email") && errors.email)} className={inputCls("email")} value={form.email} placeholder="name@organisation.org" type="email"
                  onChange={(e) => set("email", e.target.value)} onBlur={() => touch("email")} />
              </FieldBox>
            </div>
          </Section>

          <Section step={2} title={editing ? "Password" : "Set a password"} hint={editing ? "Leave blank to keep the current password. Changing it signs the user out everywhere." : "The user can change it later. Share it with them securely."}>
            <FieldBox label={editing ? "New password" : "Password"} required={!editing} error={show("password") ? errors.password : undefined}>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gt-text-muted)]" />
                  <input data-invalid={!!(show("password") && errors.password)} className={`${inputCls("password")} !pl-9 !pr-10`} type={showPw ? "text" : "password"} value={form.password} autoComplete="new-password"
                    placeholder={editing ? "Leave blank to keep unchanged" : "Create a strong password"} onChange={(e) => set("password", e.target.value)} onBlur={() => touch("password")} />
                  <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--gt-text-muted)]">
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <button type="button" className="gt-btn-secondary !px-3 flex items-center gap-1.5 text-xs whitespace-nowrap" onClick={() => { set("password", generatePassword()); setShowPw(true); touch("password"); }}>
                  <RefreshCw size={14} /> Generate
                </button>
                <button type="button" aria-label="Copy password" disabled={!form.password} className="gt-btn-secondary !px-3 disabled:opacity-40"
                  onClick={() => { navigator.clipboard?.writeText(form.password).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </FieldBox>
            {form.password && (
              <div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${pw.pct}%`, background: pw.color }} /></div>
                  <span className="text-xs font-semibold w-12 text-right" style={{ color: pw.color }}>{pw.label}</span>
                </div>
                <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1 mt-2">
                  {passwordRules(form.password).map((r) => (
                    <li key={r.label} className={`flex items-center gap-1.5 text-xs ${r.ok ? "text-green-700" : r.required ? "text-[var(--gt-text-muted)]" : "text-gray-400"}`}>
                      {r.ok ? <CheckCircle2 size={13} /> : <span className="w-[13px] h-[13px] rounded-full border border-current inline-block" />} {r.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          <Section step={3} title="Role & access" hint="Pick the role, then the modules this person can open. Lists grow automatically as roles and modules are added.">
            <FieldBox label="Role" required hint={roles.length > 1 ? undefined : undefined}>
              <MultiSelect
                mode="single"
                ariaLabel="Role"
                options={roleOptions}
                value={form.role ? [form.role] : []}
                onChange={(v) => set("role", v[0] || "")}
                placeholder="Select a role"
              />
            </FieldBox>

            {usesModules ? (
              <FieldBox label="Modules" hint="This user can open only the modules selected here.">
                <MultiSelect
                  ariaLabel="Modules"
                  options={moduleOptions}
                  value={form.permissions}
                  onChange={(v) => set("permissions", v)}
                  placeholder="Select one or more modules"
                  searchPlaceholder="Search modules…"
                />
              </FieldBox>
            ) : usesClient ? (
              <div className="rounded-xl border border-[var(--gt-border)] bg-[#FBF9FE] p-3 flex flex-col gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--gt-purple-dark)]">Client access</div>
                  <p className="text-xs text-[var(--gt-text-muted)]">Read-only access to the Dashboard and Farmer Records, limited to the client organisation's data scope. Mobile number and audit fields are never shown to client users.</p>
                </div>
                <div data-invalid={!!(show("client") && errors.client)}>
                  <FieldBox label="Client organisation" required error={show("client") ? errors.client : undefined} hint="Create or edit organisations (modules and data scope) with “Client organisations” at the top of this page.">
                    <MultiSelect
                      mode="single"
                      ariaLabel="Client organisation"
                      options={orgs.filter((o) => o.is_active || String(o.id) === form.client_id).map((o) => ({ value: String(o.id), label: o.name, description: `${o.modules.length} module(s)` }))}
                      value={form.client_id ? [form.client_id] : []}
                      onChange={(v) => {
                        const org = orgs.find((o) => String(o.id) === v[0]);
                        setForm((f) => ({ ...f, client_id: v[0] || "", client_module_codes: org ? [...org.modules] : [] }));
                      }}
                      invalid={!!(show("client") && errors.client)}
                      placeholder="Select a client organisation"
                      searchPlaceholder="Search clients…"
                      emptyText="No client organisations yet — create one first."
                    />
                  </FieldBox>
                </div>
                {selectedOrg && (
                  <>
                    <div data-invalid={!!(show("client_modules") && errors.client_modules)}>
                      <FieldBox label="Modules for this user" error={show("client_modules") ? errors.client_modules : undefined} hint="Starts from the organisation's modules; add or remove to override for this user only.">
                        <MultiSelect
                          ariaLabel="Client modules"
                          options={clientModules.map((m) => ({ value: m.code, label: m.label, description: m.description }))}
                          value={form.client_module_codes}
                          onChange={(v) => set("client_module_codes", v)}
                          invalid={!!(show("client_modules") && errors.client_modules)}
                          placeholder="Select modules"
                        />
                      </FieldBox>
                    </div>
                    <div className="text-xs text-[var(--gt-text-muted)] bg-white border border-[var(--gt-border)] rounded-lg px-3 py-2">
                      <b>Data scope:</b> {[
                        selectedOrg.scope.district.length ? `Districts: ${selectedOrg.scope.district.join(", ")}` : "",
                        selectedOrg.scope.taluka.length ? `Taluks: ${selectedOrg.scope.taluka.join(", ")}` : "",
                        selectedOrg.scope.survey_year.length ? `Survey years: ${selectedOrg.scope.survey_year.join(", ")}` : "",
                      ].filter(Boolean).join(" · ") || "all data (no restriction)"}
                    </div>
                  </>
                )}
              </div>
            ) : usesCatalog ? (
              <div className="rounded-xl border border-[var(--gt-border)] bg-[#FBF9FE] p-3 flex flex-col gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--gt-purple-dark)]">Reports &amp; Dashboards Access</div>
                  <p className="text-xs text-[var(--gt-text-muted)]">This user can open only the reports and dashboards selected here. They cannot reach data entry, workflows, users or configuration.</p>
                </div>

                <label className="flex items-start gap-2.5 rounded-lg border border-[var(--gt-border)] bg-white p-2.5 cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={form.mis_access_all} onChange={(e) => set("mis_access_all", e.target.checked)} />
                  <span>
                    <span className="block text-sm font-medium">Grant access to all current and future reports and dashboards</span>
                    <span className="block text-xs text-[var(--gt-text-muted)]">When off, newly added reports/dashboards stay hidden from this user until you assign them.</span>
                  </span>
                </label>

                {misUsers.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-[var(--gt-text-muted)]">Copy access from</span>
                    <select className="gt-input !w-auto !py-1 !px-2 text-xs" defaultValue="" aria-label="Copy access from another MIS user"
                      onChange={(e) => {
                        const src = misUsers.find((u) => String(u.id) === e.target.value);
                        if (src) setForm((f) => ({ ...f, mis_access_all: !!src.mis_access_all, catalog_item_ids: [...(src.catalog_item_ids || [])], data_scope_districts: [...(src.data_scope_districts || [])] }));
                        e.target.value = "";
                      }}>
                      <option value="">Choose a user…</option>
                      {misUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name} (@{u.username})</option>)}
                    </select>
                    <span className="text-[var(--gt-text-muted)]">— fills the selection below; you can still adjust it.</span>
                  </div>
                )}

                <CatalogPicker items={catalog} value={form.catalog_item_ids} onChange={(ids) => set("catalog_item_ids", ids)} disabled={form.mis_access_all} />
                {form.mis_access_all && <p className="text-xs text-[var(--gt-text-muted)] -mt-1">Individual selection is not needed while “all current and future” is on.</p>}

                <FieldBox label="Data scope (optional)" hint="Limit every report and dashboard this user opens to these districts. Leave empty for all districts.">
                  <MultiSelect
                    ariaLabel="Data scope districts"
                    options={districts.map((d) => ({ value: d, label: d }))}
                    value={form.data_scope_districts}
                    onChange={(v) => set("data_scope_districts", v)}
                    placeholder="All districts"
                    searchPlaceholder="Search districts…"
                  />
                </FieldBox>
              </div>
            ) : (
              <div className="text-xs text-[var(--gt-text-muted)] bg-[#F6F0FB] border border-[#E9DFF3] rounded-lg px-3 py-2">
                {roleDef?.label || "This role"} has access to every module — nothing to select.
              </div>
            )}

            {wantsVerifier && (
              <div data-invalid={!!(show("mapped") && errors.mapped)}>
                <FieldBox label="Users this verifier reviews" required error={show("mapped") ? errors.mapped : undefined}
                  hint="They will see, edit and freeze the records of the people selected here (plus their own).">
                  <MultiSelect
                    ariaLabel="Users this verifier reviews"
                    options={userOptions}
                    value={form.mapped_user_ids.map(String)}
                    onChange={(v) => set("mapped_user_ids", v.map(Number))}
                    invalid={!!(show("mapped") && errors.mapped)}
                    placeholder="Select one or more users"
                    searchPlaceholder="Search users by name or username…"
                    emptyText="No other active field users to map yet."
                    maxChips={4}
                  />
                </FieldBox>
              </div>
            )}
          </Section>
        </div>

        <footer className="bg-white border-t border-[var(--gt-border)] px-5 py-3">
          {serverError && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2"><AlertCircle size={16} className="mt-0.5 shrink-0" /> {serverError}</div>
          )}
          {submitted && errorKeys.length > 0 && !serverError && (
            <div className="text-xs text-red-700 mb-2">Please fix {errorKeys.length} highlighted field{errorKeys.length === 1 ? "" : "s"} to continue.</div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-[var(--gt-text-muted)] hidden sm:block">
              {usesClient
                ? `${roleDef?.label} · ${selectedOrg ? selectedOrg.name : "no organisation yet"} · ${form.client_module_codes.length} module(s)`
                : usesCatalog
                ? `${roleDef?.label} · ${form.mis_access_all ? "all reports & dashboards" : `${form.catalog_item_ids.length} report/dashboard item(s)`}`
                : usesModules ? `${roleDef?.label || form.role} · ${moduleCount} module${moduleCount === 1 ? "" : "s"}` : `${roleDef?.label || form.role} · all modules`}{wantsVerifier ? ` · ${form.mapped_user_ids.length} reviewed user(s)` : ""}
            </div>
            <div className="flex gap-2 ml-auto">
              <button type="button" className="gt-btn-secondary" onClick={requestClose} disabled={busy}>Cancel</button>
              <button type="button" className="gt-btn-primary !py-2.5 flex items-center gap-1.5 disabled:opacity-60" onClick={submit} disabled={busy || (editing !== null && !dirty)}>
                {busy ? "Saving…" : editing ? "Save changes" : <><UserPlus size={16} /> Create user</>}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function BulkAssignModal({ users, catalog, onClose, onDone }: { users: UserRow[]; catalog: CatalogItem[]; onClose: () => void; onDone: (message: string) => void }) {
  const [userIds, setUserIds] = useState<string[]>([]);
  const [itemIds, setItemIds] = useState<number[]>([]);
  const [mode, setMode] = useState<"add" | "remove" | "replace">("add");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const modes = [
    { key: "add", label: "Add these", hint: "Keep what each user already has and add the selected items." },
    { key: "remove", label: "Remove these", hint: "Take the selected items away from each user." },
    { key: "replace", label: "Replace with these", hint: "Each user ends up with exactly the selected items." },
  ] as const;
  const apply = async () => {
    setError("");
    if (userIds.length === 0 || itemIds.length === 0) { setError("Choose at least one user and one report or dashboard."); return; }
    if (mode === "replace" && !confirm("Replace the access of every selected user with exactly this selection?")) return;
    setBusy(true);
    try {
      await api.bulkMisAccess({ user_ids: userIds.map(Number), item_ids: itemIds, mode });
      onDone(`Access updated for ${userIds.length} user(s).`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Bulk assign reports">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-[#FAF8FC] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <header className="flex items-center justify-between px-5 py-4 bg-white rounded-t-2xl border-b border-[var(--gt-border)]">
          <div>
            <h2 className="font-semibold text-[var(--gt-purple-dark)]">Bulk assign reports &amp; dashboards</h2>
            <p className="text-xs text-[var(--gt-text-muted)]">Apply the same access to many MIS users at once.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 rounded-lg hover:bg-[#F1EBF7]"><X size={18} /></button>
        </header>
        <div className="p-5 overflow-y-auto flex flex-col gap-4">
          <FieldBox label="MIS users" required>
            <MultiSelect ariaLabel="MIS users" options={users.map((u) => ({ value: String(u.id), label: u.full_name, description: `@${u.username}` }))}
              value={userIds} onChange={setUserIds} placeholder="Select one or more users" searchPlaceholder="Search users…" />
          </FieldBox>
          <FieldBox label="Reports & dashboards" required>
            <CatalogPicker items={catalog} value={itemIds} onChange={setItemIds} />
          </FieldBox>
          <div className="grid sm:grid-cols-3 gap-2">
            {modes.map((m) => (
              <button key={m.key} type="button" onClick={() => setMode(m.key)} aria-pressed={mode === m.key}
                className={`text-left rounded-xl border p-2.5 ${mode === m.key ? "border-[var(--gt-purple)] bg-[#F6F0FB]" : "border-[var(--gt-border)] bg-white"}`}>
                <div className="text-sm font-medium">{m.label}</div>
                <div className="text-[11px] text-[var(--gt-text-muted)]">{m.hint}</div>
              </button>
            ))}
          </div>
          {error && <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle size={15} /> {error}</div>}
        </div>
        <footer className="flex justify-end gap-2 px-5 py-3 bg-white rounded-b-2xl border-t border-[var(--gt-border)]">
          <button type="button" className="gt-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="gt-btn-primary !py-2.5" onClick={apply} disabled={busy}>{busy ? "Applying…" : "Apply to selected users"}</button>
        </footer>
      </div>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="gt-card p-3.5 flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-[var(--gt-text-muted)] font-medium">{label}</span>
      <span className="text-2xl font-bold" style={{ color: tone }}>{value}</span>
    </div>
  );
}

type RoleFilter = string; // "all" | "verifier" | a role key
type StatusFilter = "all" | "active" | "disabled";

export default function UserManagement() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>(FALLBACK_ROLES);
  const [orgsOpen, setOrgsOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [modules, setModules] = useState<ModuleDef[]>(FALLBACK_MODULES);
  const [optionsNote, setOptionsNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [drawer, setDrawer] = useState<{ editing: UserRow | null } | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const roleLabel = (key: string) => roles.find((r) => r.key === key)?.label || key;
  const moduleLabel = (key: string) => modules.find((m) => m.key === key)?.label || key;
  const roleUsesCatalog = (key: string) => !!roles.find((r) => r.key === key)?.uses_catalog;
  const rolesUseModules = (key: string) => roles.find((r) => r.key === key)?.uses_modules ?? true;

  const reload = () => {
    api.listUsers().then((u: UserRow[]) => { setUsers(u); setLoading(false); }).catch((e) => { setError(e.message); setLoading(false); });
  };
  useEffect(() => {
    reload();
    // Roles/modules come from the server; if that endpoint is unavailable (older backend still running) fall back to the
    // module keys from the older endpoint, or to the built-in list, so the dropdowns are never empty.
    api.accessOptions()
      .then((o) => { if (o.roles?.length) setRoles(o.roles); if (o.modules?.length) setModules(o.modules); })
      .catch(() => {
        api.permissionModules()
          .then((keys) => setModules(keys.map((k) => FALLBACK_MODULES.find((m) => m.key === k) || { key: k, label: k.replace(/_/g, " "), description: "" })))
          .catch(() => setOptionsNote("Could not load the latest roles and modules from the server — showing the built-in list. Restart or update the backend."));
      });
  }, []);
  const needsCatalog = roles.some((r) => r.uses_catalog);
  useEffect(() => {
    if (!needsCatalog) return;
    api.misCatalog({ status: "active" }).then(setCatalog).catch(() => {});
    api.districts().then(setDistricts).catch(() => {});
  }, [needsCatalog]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const isVerifier = (u: UserRow) => u.permissions.includes("data_verifier");
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((u) => {
      if (term && !`${u.full_name} ${u.username} ${u.email || ""}`.toLowerCase().includes(term)) return false;
      if (roleFilter === "verifier") { if (!isVerifier(u)) return false; }
      else if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter === "active" && !u.is_active) return false;
      if (statusFilter === "disabled" && u.is_active) return false;
      return true;
    });
  }, [users, search, roleFilter, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = paginate(filtered, safePage, pageSize);

  const toggleActive = async (u: UserRow) => {
    if (u.is_active && !confirm(`Disable ${u.full_name}? They will no longer be able to sign in.`)) return;
    setError("");
    try {
      await api.updateUser(u.id, { is_active: !u.is_active });
      setNotice(`${u.full_name} was ${u.is_active ? "disabled" : "enabled"}.`);
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const chip = (active: boolean) => `text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${active ? "gt-gradient text-white border-transparent shadow-sm" : "bg-white text-[var(--gt-text-muted)] border-[var(--gt-border)] hover:border-[var(--gt-purple-light)]"}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[var(--gt-purple-dark)] flex items-center gap-2"><ShieldCheck size={20} /> User Management</h1>
          <p className="text-sm text-[var(--gt-text-muted)]">Create accounts, assign roles and control which modules each person can use.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {needsCatalog && users.some((u) => roleUsesCatalog(u.role)) && (
            <button type="button" onClick={() => setBulkOpen(true)} className="gt-btn-secondary !py-2.5 flex items-center gap-1.5">
              <ShieldCheck size={16} /> Bulk assign reports
            </button>
          )}
          {roles.some((r) => r.uses_client) && (
            <button type="button" onClick={() => setOrgsOpen(true)} className="gt-btn-secondary !py-2.5 flex items-center gap-1.5">
              <Building2 size={16} /> Client organisations
            </button>
          )}
          <button type="button" onClick={() => setDrawer({ editing: null })} className="gt-btn-primary !py-2.5 flex items-center gap-1.5">
            <UserPlus size={16} /> New user
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Total users" value={users.length} tone="var(--gt-purple-dark)" />
        <StatTile label="Active" value={users.filter((u) => u.is_active).length} tone="#15803D" />
        {roles.map((r, i) => <StatTile key={r.key} label={r.label} value={users.filter((u) => u.role === r.key).length} tone={["#2563EB", "#7C3AED", "#0F766E", "#B45309"][i % 4]} />)}
        <StatTile label="Data verifiers" value={users.filter(isVerifier).length} tone="#A6266E" />
        <StatTile label="Disabled" value={users.filter((u) => !u.is_active).length} tone="#6B7280" />
      </div>

      {notice && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-3 py-2.5">
          <CheckCircle2 size={16} /> {notice}
          <button type="button" className="ml-auto" aria-label="Dismiss" onClick={() => setNotice("")}><X size={14} /></button>
        </div>
      )}
      {optionsNote && <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"><AlertCircle size={14} /> {optionsNote}</div>}
      {error && !drawer && <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle size={15} /> {error}</div>}

      <div className="gt-card p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-3 border-b border-[var(--gt-border)]">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gt-text-muted)]" />
            <input className="gt-input !pl-9" placeholder="Search by name, username or email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([["all", "All roles"], ...roles.map((r) => [r.key, r.label]), ["verifier", "Verifiers"]] as [RoleFilter, string][]).map(([k, l]) => (
              <button key={k} type="button" className={chip(roleFilter === k)} onClick={() => { setRoleFilter(k); setPage(1); }}>{l}</button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {([["all", "Any status"], ["active", "Active"], ["disabled", "Disabled"]] as [StatusFilter, string][]).map(([k, l]) => (
              <button key={k} type="button" className={chip(statusFilter === k)} onClick={() => { setStatusFilter(k); setPage(1); }}>{l}</button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--gt-text-muted)] bg-[#FAF8FC] border-b border-[var(--gt-border)]">
                <th className="px-4 py-2.5 font-semibold">User</th>
                <th className="px-4 py-2.5 font-semibold">Role</th>
                <th className="px-4 py-2.5 font-semibold">Access</th>
                <th className="px-4 py-2.5 font-semibold hidden lg:table-cell">Created</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((u) => (
                <tr key={u.id} className={`border-b border-[var(--gt-border)] last:border-0 hover:bg-[#FBF9FD] ${u.is_active ? "" : "opacity-60"}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.full_name} />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{u.full_name}</div>
                        <div className="text-xs text-[var(--gt-text-muted)] truncate">@{u.username}{u.email ? ` · ${u.email}` : ""}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${roleUsesCatalog(u.role) ? "bg-sky-50 text-sky-700" : rolesUseModules(u.role) ? "bg-emerald-50 text-emerald-700" : "bg-purple-100 text-purple-700"}`}>
                      {roleLabel(u.role)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.role === "client" ? (
                      <div className="text-xs">
                        <span className="font-medium text-[var(--gt-purple-dark)]">{u.client_name || "No organisation"}</span>
                        <div className="text-[11px] text-[var(--gt-text-muted)]">{(u.client_module_codes || []).map((c) => c.replace(/^client_/, "").replace(/_/g, " ")).join(", ") || "No modules"}</div>
                      </div>
                    ) : roleUsesCatalog(u.role) ? (
                      <div className="text-xs">
                        <span className="text-sky-700 font-medium">{u.mis_access_all ? "All reports & dashboards" : `${u.catalog_item_ids?.length || 0} report/dashboard item(s)`}</span>
                        {u.mis_access_all && <div className="text-[11px] text-[var(--gt-text-muted)]">current and future</div>}
                        {(u.data_scope_districts?.length || 0) > 0 && <div className="text-[11px] text-[var(--gt-text-muted)]">Scope: {u.data_scope_districts!.join(", ")}</div>}
                      </div>
                    ) : !rolesUseModules(u.role) ? (
                      <span className="text-xs text-[var(--gt-text-muted)]">All modules</span>
                    ) : (
                      <div className="flex flex-wrap gap-1 min-w-[190px] max-w-[300px]">
                        {u.permissions.slice(0, 3).map((p) => <span key={p} className="text-[11px] whitespace-nowrap bg-[#F1EBF7] text-[var(--gt-purple-dark)] rounded px-1.5 py-0.5">{moduleLabel(p)}</span>)}
                        {u.permissions.length > 3 && <span className="text-[11px] text-[var(--gt-text-muted)] px-1 py-0.5" title={u.permissions.slice(3).map(moduleLabel).join(", ")}>+{u.permissions.length - 3} more</span>}
                        {u.permissions.length === 0 && <span className="text-xs text-[var(--gt-text-muted)]">No modules</span>}
                        {isVerifier(u) && <span className="text-[11px] text-sky-700 w-full">Reviews {u.mapped_user_ids?.length || 0} user(s)</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--gt-text-muted)] hidden lg:table-cell whitespace-nowrap">{u.created_at ? new Date(u.created_at + "Z").toLocaleDateString(undefined, { dateStyle: "medium" }) : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${u.is_active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${u.is_active ? "bg-green-600" : "bg-gray-400"}`} /> {u.is_active ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button type="button" onClick={() => setDrawer({ editing: u })} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--gt-purple)] hover:underline mr-3"><Pencil size={13} /> Edit</button>
                    {!(roles.find((r) => r.key === u.role)?.single_instance) && (
                      <button type="button" onClick={() => toggleActive(u)} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--gt-text-muted)] hover:text-[var(--gt-text)]">
                        <Power size={13} /> {u.is_active ? "Disable" : "Enable"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && visible.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-[var(--gt-text-muted)]">{users.length === 0 ? "No users yet." : "No users match your filters."}</td></tr>
              )}
              {loading && <tr><td colSpan={6} className="px-4 py-10 text-center text-[var(--gt-text-muted)]">Loading users…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-[var(--gt-border)]">
          <Pagination page={safePage} pageSize={pageSize} total={filtered.length} noun="users" onPage={setPage} onPageSize={(sz) => { setPageSize(sz); setPage(1); }} />
          {filtered.length <= 20 && <div className="text-xs text-[var(--gt-text-muted)]">{filtered.length} user{filtered.length === 1 ? "" : "s"}{filtered.length !== users.length ? ` (of ${users.length})` : ""}</div>}
        </div>
      </div>

      {orgsOpen && <SideDrawer title="Client organisations" wide onClose={() => setOrgsOpen(false)}><ClientOrgsPanel onChanged={reload} /></SideDrawer>}

      {bulkOpen && (
        <BulkAssignModal
          users={users.filter((u) => roleUsesCatalog(u.role) && u.is_active)}
          catalog={catalog}
          onClose={() => setBulkOpen(false)}
          onDone={(message) => { setBulkOpen(false); setNotice(message); reload(); }}
        />
      )}

      {drawer && (
        <UserDrawer
          key={drawer.editing?.id ?? "new"}
          editing={drawer.editing}
          users={users}
          roles={roles}
          modules={modules}
          catalog={catalog}
          districts={districts}
          onClose={() => setDrawer(null)}
          onSaved={(message) => { setDrawer(null); setNotice(message); reload(); }}
        />
      )}
    </div>
  );
}
