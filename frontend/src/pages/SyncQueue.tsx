import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle, Clock, RefreshCw, Trash2, ArrowLeft } from "lucide-react";
import { useAuth } from "../AuthContext";
import { listQueued, deleteQueued, type QueuedSurvey } from "../offlineQueue";
import { listQueuedDrafts, deleteQueuedDraft, type QueuedDraft } from "../offlineDraftQueue";
import { runSync, subscribe } from "../lib/syncManager";
import Pagination from "../components/Pagination";
import { paginate, DEFAULT_PAGE_SIZE } from "../lib/paging";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Unifies the two independent queues (offlineQueue.ts for submitted
// surveys, offlineDraftQueue.ts for Save-as-Draft — see that module's
// header for why they can't be merged into one) into a single list for
// display. Without this, a draft-queue entry that already has a surveyId
// (an offline edit of an existing draft, not a brand-new one) was
// invisible everywhere once it failed: FarmerList's Drafts tab only shows
// local entries with no surveyId, and this page previously only read the
// survey queue. The header badge counted it, but nowhere let the user see
// or clear it.
type QueueRow = {
  kind: "survey" | "draft";
  clientUuid: string;
  farmerName: string;
  queuedAt: string;
  isUpdate: boolean;
  status: "pending" | "failed";
  attempts: number;
  lastError?: string;
};

function toRow(kind: "survey" | "draft", e: QueuedSurvey | QueuedDraft): QueueRow {
  return {
    kind,
    clientUuid: e.clientUuid,
    farmerName: e.payload?.farmer_name || "Untitled",
    queuedAt: e.queuedAt,
    isUpdate: kind === "survey" ? (e as QueuedSurvey).isUpdate : !!(e as QueuedDraft).surveyId,
    status: e.status,
    attempts: e.attempts,
    lastError: e.lastError,
  };
}

export default function SyncQueue() {
  const { user } = useAuth();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [discarding, setDiscarding] = useState<string | null>(null);

  // The queue lives on the device (small, already fully in memory), so it pages client-side.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const refresh = async () => {
    if (!user) return;
    const [surveys, drafts] = await Promise.all([listQueued(user.username), listQueuedDrafts(user.username)]);
    const merged = [...surveys.map((e) => toRow("survey", e)), ...drafts.map((e) => toRow("draft", e))];
    merged.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    setRows(merged);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    // Picks up both the periodic/automatic sync manager's passes and this
    // page's own "Retry All" below, so the list stays live without a
    // separate polling loop.
    const unsubscribe = subscribe(() => refresh());
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const retryAll = async () => {
    setSyncing(true);
    await runSync({ force: true });
    await refresh();
    setSyncing(false);
  };

  const discard = async (row: QueueRow) => {
    if (!user) return;
    const label = row.farmerName || `this queued ${row.kind}`;
    const extra = row.kind === "draft" && row.isUpdate
      ? " Discarding only removes the unsynced local edit — the draft itself stays on the server as it was last synced."
      : "";
    if (!window.confirm(`Discard ${label}? This permanently deletes the unsynced ${row.kind} from this device — it cannot be recovered.${extra}`)) return;
    setDiscarding(row.clientUuid);
    if (row.kind === "survey") await deleteQueued(user.username, row.clientUuid);
    else await deleteQueuedDraft(user.username, row.clientUuid);
    await refresh();
    setDiscarding(null);
  };

  const failedCount = rows.filter((r) => r.status === "failed").length;

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-2">
        <Link to="/" className="text-[var(--gt-text-muted)]"><ArrowLeft size={20} /></Link>
        <div>
          <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">Sync Queue</h1>
          <p className="text-sm text-[var(--gt-text-muted)]">Surveys and drafts saved on this device that haven't been confirmed synced to the server yet.</p>
        </div>
      </div>

      {rows.length > 0 && (
        <button
          type="button"
          onClick={retryAll}
          disabled={syncing}
          className="gt-btn-primary self-start flex items-center gap-2"
        >
          <RefreshCw size={16} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing…" : "Retry All Now"}
        </button>
      )}

      {loading ? (
        <div className="text-sm text-[var(--gt-text-muted)]">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="gt-card p-6 flex flex-col items-center gap-2 text-center">
          <CheckCircle2 size={28} className="text-[var(--gt-success)]" />
          <div className="font-medium">Nothing queued</div>
          <p className="text-sm text-[var(--gt-text-muted)]">Everything entered on this device has synced to the server.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {failedCount > 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-[var(--gt-danger)] text-sm rounded-lg px-3 py-2">
              <AlertTriangle size={16} />
              {failedCount} {failedCount === 1 ? "entry needs" : "entries need"} attention — automatic sync won't retry these on its own; review the error below or discard them.
            </div>
          )}

          {paginate(rows, Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize))), pageSize).map((row) => (
            <div key={`${row.kind}:${row.clientUuid}`} className="gt-card p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{row.farmerName}</div>
                  <div className="text-xs text-[var(--gt-text-muted)] flex items-center gap-1">
                    <Clock size={12} /> Queued {formatWhen(row.queuedAt)} · {row.kind === "draft" ? "draft" : "survey"} {row.isUpdate ? "edit" : "new"}
                  </div>
                </div>
                {row.status === "failed" ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-[var(--gt-danger)] bg-red-50 border border-red-200 rounded-full px-2 py-0.5 shrink-0">
                    <AlertTriangle size={11} /> Needs attention
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
                    <Clock size={11} /> Pending
                  </span>
                )}
              </div>

              {row.lastError && (
                <div className="text-xs text-[var(--gt-text-muted)] bg-[#F6F4F9] rounded-lg px-2.5 py-1.5">
                  {row.attempts > 0 && <span className="font-medium">{row.attempts} attempt{row.attempts === 1 ? "" : "s"} · </span>}
                  {row.lastError}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => discard(row)}
                  disabled={discarding === row.clientUuid}
                  className="text-xs font-medium text-[var(--gt-danger)] underline flex items-center gap-1"
                >
                  <Trash2 size={12} /> {discarding === row.clientUuid ? "Discarding…" : "Discard"}
                </button>
              </div>
            </div>
          ))}
          <Pagination
            page={Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)))}
            pageSize={pageSize}
            total={rows.length}
            noun="queued items"
            onPage={setPage}
            onPageSize={(sz) => { setPageSize(sz); setPage(1); }}
          />
        </div>
      )}
    </div>
  );
}
