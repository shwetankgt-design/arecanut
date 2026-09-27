import { useEffect, useState } from "react";
import { api } from "../api";
import { Plus, Pencil, Trash2, X } from "lucide-react";

interface FieldMeta {
  name: string;
  label: string;
  type: "string" | "int" | "bool" | "fk";
  required: boolean;
  fk_table: string | null;
}

interface TableMeta {
  key: string;
  label: string;
  fields: FieldMeta[];
}

type Row = Record<string, any>;

function emptyForm(fields: FieldMeta[]): Row {
  const form: Row = {};
  for (const f of fields) form[f.name] = f.type === "bool" ? false : "";
  return form;
}

export default function MasterData() {
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [active, setActive] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [fkOptions, setFkOptions] = useState<Record<string, Row[]>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Row>({});

  const activeTable = tables.find((t) => t.key === active);

  useEffect(() => {
    api.masterTables().then((t: TableMeta[]) => {
      setTables(t);
      if (t.length) setActive(t[0].key);
    });
  }, []);

  const reload = (table = active) => {
    if (!table) return;
    api.masterRows(table).then(setRows).catch((e) => setError(e.message));
  };

  useEffect(() => {
    if (!active) return;
    setError("");
    reload(active);
    // Preload options for any fk field this table has, so the create/edit form can render a dropdown.
    const meta = tables.find((t) => t.key === active);
    (meta?.fields || []).forEach((f) => {
      if (f.type === "fk" && f.fk_table && !fkOptions[f.fk_table]) {
        api.masterRows(f.fk_table).then((opts: Row[]) => setFkOptions((prev) => ({ ...prev, [f.fk_table!]: opts })));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tables]);

  const openCreate = () => {
    if (!activeTable) return;
    setEditing(null);
    setForm(emptyForm(activeTable.fields));
    setError("");
    setShowForm(true);
  };

  const openEdit = (row: Row) => {
    if (!activeTable) return;
    setEditing(row);
    const f: Row = {};
    for (const field of activeTable.fields) f[field.name] = row[field.name] ?? (field.type === "bool" ? false : "");
    setForm(f);
    setError("");
    setShowForm(true);
  };

  const submit = async () => {
    if (!activeTable) return;
    setError("");
    setBusy(true);
    try {
      const payload: Row = {};
      for (const f of activeTable.fields) {
        const v = form[f.name];
        payload[f.name] = v === "" ? null : v;
      }
      if (editing) await api.updateMasterRow(activeTable.key, editing.id, payload);
      else await api.createMasterRow(activeTable.key, payload);
      setShowForm(false);
      reload();
      // A newly added row in a table that others reference-by-fk (e.g. a new
      // District) should show up immediately in those tables' dropdowns too.
      setFkOptions((prev) => {
        const next = { ...prev };
        delete next[activeTable.key];
        return next;
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: Row) => {
    if (!activeTable) return;
    if (!confirm(`Delete "${row.name ?? row.label ?? row.id}"? This cannot be undone.`)) return;
    setError("");
    try {
      await api.deleteMasterRow(activeTable.key, row.id);
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">Master Data</h1>
        <p className="text-sm text-[var(--gt-text-muted)]">Manage the shared reference lists that drive dropdowns across the app.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tables.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={`text-sm font-medium px-3 py-1.5 rounded-full border ${
              active === t.key ? "bg-[var(--gt-purple)] text-white border-[var(--gt-purple)]" : "bg-white text-[var(--gt-text-muted)] border-[var(--gt-border)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && !showForm && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {activeTable && (
        <div className="gt-card p-0 overflow-x-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--gt-border)]">
            <div className="font-semibold text-sm text-[var(--gt-purple-dark)]">{activeTable.label} <span className="text-[var(--gt-text-muted)] font-normal">({rows.length})</span></div>
            <button type="button" onClick={openCreate} className="flex items-center gap-1.5 bg-[var(--gt-purple)] text-white px-3 py-1.5 rounded-lg text-xs font-semibold">
              <Plus size={14} /> Add
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--gt-text-muted)] border-b border-[var(--gt-border)]">
                {activeTable.fields.map((f) => (
                  <th key={f.name} className="px-4 py-2 font-medium">{f.label}</th>
                ))}
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-[var(--gt-border)] last:border-0">
                  {activeTable.fields.map((f) => (
                    <td key={f.name} className="px-4 py-2">
                      {f.type === "fk" ? row[`${f.name}_display`] ?? "—" : f.type === "bool" ? (row[f.name] ? "Yes" : "No") : (row[f.name] ?? "—")}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button type="button" onClick={() => openEdit(row)} className="text-[var(--gt-purple)] mr-3"><Pencil size={14} /></button>
                    <button type="button" onClick={() => remove(row)} className="text-red-500"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={activeTable.fields.length + 1} className="px-4 py-6 text-center text-[var(--gt-text-muted)]">No records yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && activeTable && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-[var(--gt-purple-dark)]">{editing ? `Edit ${activeTable.label}` : `Add ${activeTable.label}`}</h2>
              <button type="button" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>}

            <div className="flex flex-col gap-3">
              {activeTable.fields.map((f) => (
                <div key={f.name}>
                  <label className="text-xs font-medium text-[var(--gt-text-muted)]">
                    {f.label}{!f.required && " (optional)"}
                  </label>
                  {f.type === "fk" ? (
                    <select
                      className="gt-input w-full mt-1"
                      value={form[f.name] ?? ""}
                      onChange={(e) => setForm({ ...form, [f.name]: e.target.value ? Number(e.target.value) : "" })}
                    >
                      <option value="">{f.required ? "Select…" : "None"}</option>
                      {(fkOptions[f.fk_table!] || []).map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.name}</option>
                      ))}
                    </select>
                  ) : f.type === "bool" ? (
                    <div className="mt-1">
                      <input
                        type="checkbox"
                        checked={!!form[f.name]}
                        onChange={(e) => setForm({ ...form, [f.name]: e.target.checked })}
                      />
                    </div>
                  ) : (
                    <input
                      type={f.type === "int" ? "number" : "text"}
                      className="gt-input w-full mt-1"
                      value={form[f.name] ?? ""}
                      onChange={(e) => setForm({ ...form, [f.name]: f.type === "int" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value })}
                    />
                  )}
                </div>
              ))}

              <button
                type="button"
                disabled={busy}
                onClick={submit}
                className="bg-[var(--gt-purple)] text-white rounded-lg py-2.5 font-semibold text-sm mt-2 disabled:opacity-60"
              >
                {busy ? "Saving…" : editing ? "Save Changes" : "Add Record"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
