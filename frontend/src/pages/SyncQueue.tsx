import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle, Clock, RefreshCw, Trash2, ArrowLeft } from "lucide-react";
import { useAuth } from "../AuthContext";
import { listQueued, deleteQueued, type QueuedSurvey } from "../offlineQueue";
import { runSync, subscribe } from "../lib/syncManager";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function SyncQueue() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<QueuedSurvey[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [discarding, setDiscarding] = useState<string | null>(null);

  const refresh = async () => {
    if (!user) return;
    setEntries(await listQueued(user.username));
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

  const discard = async (entry: QueuedSurvey) => {
    if (!user) return;
    const label = entry.payload?.farmer_name || "this queued survey";
    if (!window.confirm(`Discard ${label}? This permanently deletes the unsynced submission from this device — it cannot be recovered.`)) return;
    setDiscarding(entry.clientUuid);
    await deleteQueued(user.username, entry.clientUuid);
    await refresh();
    setDiscarding(null);
  };

  const failedCount = entries.filter((e) => e.status === "failed").length;

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-2">
        <Link to="/" className="text-[var(--gt-text-muted)]"><ArrowLeft size={20} /></Link>
        <div>
          <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">Sync Queue</h1>
          <p className="text-sm text-[var(--gt-text-muted)]">Surveys saved on this device that haven't been confirmed synced to the server yet.</p>
        </div>
      </div>

      {entries.length > 0 && (
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
      ) : entries.length === 0 ? (
        <div className="gt-card p-6 flex flex-col items-center gap-2 text-center">
          <CheckCircle2 size={28} className="text-[var(--gt-success)]" />
          <div className="font-medium">Nothing queued</div>
          <p className="text-sm text-[var(--gt-text-muted)]">Every survey entered on this device has synced to the server.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {failedCount > 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-[var(--gt-danger)] text-sm rounded-lg px-3 py-2">
              <AlertTriangle size={16} />
              {failedCount} {failedCount === 1 ? "entry needs" : "entries need"} attention — automatic sync won't retry these on its own; review the error below or discard them.
            </div>
          )}

          {entries.map((entry) => (
            <div key={entry.clientUuid} className="gt-card p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{entry.payload?.farmer_name || "Untitled survey"}</div>
                  <div className="text-xs text-[var(--gt-text-muted)] flex items-center gap-1">
                    <Clock size={12} /> Queued {formatWhen(entry.queuedAt)} {entry.isUpdate ? "· edit" : "· new survey"}
                  </div>
                </div>
                {entry.status === "failed" ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-[var(--gt-danger)] bg-red-50 border border-red-200 rounded-full px-2 py-0.5 shrink-0">
                    <AlertTriangle size={11} /> Needs attention
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
                    <Clock size={11} /> Pending
                  </span>
                )}
              </div>

              {entry.lastError && (
                <div className="text-xs text-[var(--gt-text-muted)] bg-[#F6F4F9] rounded-lg px-2.5 py-1.5">
                  {entry.attempts > 0 && <span className="font-medium">{entry.attempts} attempt{entry.attempts === 1 ? "" : "s"} · </span>}
                  {entry.lastError}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => discard(entry)}
                  disabled={discarding === entry.clientUuid}
                  className="text-xs font-medium text-[var(--gt-danger)] underline flex items-center gap-1"
                >
                  <Trash2 size={12} /> {discarding === entry.clientUuid ? "Discarding…" : "Discard"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
