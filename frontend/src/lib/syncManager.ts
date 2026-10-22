import {
  syncQueue,
  pendingCount as queuePendingCount,
  failedCount as queueFailedCount,
  listLegacyQueued,
  adoptLegacyQueue as adoptLegacyQueueInStore,
  type SyncResult,
} from "../offlineQueue";
import { syncDraftQueue, pendingDraftCount, type DraftSyncResult } from "../offlineDraftQueue";

// Single owner of every "try to sync the offline queue now" trigger, and of
// which device user the queues are currently scoped to. Previously sync
// only ran on the `online` *event* (never on cold start while already
// online — the most common real field pattern: collect offline all day,
// close the app, open it again on wifi that night) or a manual tap, and the
// queue wasn't scoped to a user at all — surveys queued by one enumerator
// could get synced under whichever account happened to be logged in when
// the queue was flushed.
//
// Submitted surveys and drafts are two independent queues (offlineQueue.ts
// / offlineDraftQueue.ts — drafts have no server-side dedup, which is a
// real constraint on how they can safely be retried, see that module's
// header) but share every trigger here and are reported as one combined
// pending/failed count, since from the user's point of view they're both
// just "stuff on this device not yet on the server."

export interface SyncManagerState {
  syncing: boolean;
  pending: number;
  failed: number;
  // Entries queued before the per-user queue existed — see
  // offlineQueue.ts's listLegacyQueued/adoptLegacyQueue. Non-zero only
  // when adoption needs the user to confirm (see setCurrentUser).
  // (Submitted-survey queue only — the draft queue didn't exist in the
  // un-namespaced form, so it has nothing to migrate.)
  legacyCount: number;
  // How many legacy entries were adopted automatically, for an
  // after-the-fact notice rather than a blocking prompt.
  autoAdopted: number;
}

type Listener = (state: SyncManagerState) => void;

let state: SyncManagerState = { syncing: false, pending: 0, failed: 0, legacyCount: 0, autoAdopted: 0 };
const listeners = new Set<Listener>();
let currentUsername: string | null = null;

function setState(patch: Partial<SyncManagerState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

/** Registers for state changes and is immediately called once with the
 * current state, so a component doesn't need a separate initial fetch. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export async function refreshCounts(): Promise<void> {
  if (!currentUsername) {
    setState({ pending: 0, failed: 0, legacyCount: 0 });
    return;
  }
  const [surveyPending, surveyFailed, draftPending, legacy] = await Promise.all([
    queuePendingCount(currentUsername),
    queueFailedCount(currentUsername),
    pendingDraftCount(currentUsername),
    listLegacyQueued(),
  ]);
  // The draft queue doesn't track a separate "failed" count the way the
  // survey queue's UI does — a draft is low-stakes enough (it's explicitly
  // incomplete data) that surfacing it in the combined pending count is
  // enough; drafts needing attention are visible from the Drafts tab where
  // the user already goes to resume one.
  setState({ pending: surveyPending + draftPending, failed: surveyFailed, legacyCount: legacy.length });
}

let surveyInFlight: Promise<SyncResult> | null = null;
let draftInFlight: Promise<DraftSyncResult> | null = null;

/** Single-flight per queue: concurrent callers (the periodic timer firing
 * at the same moment as a visibility change, say) share the same
 * in-progress pass rather than each starting their own — two overlapping
 * passes would race on the same idb-keyval entries and, for the draft
 * queue specifically, risk creating the same not-yet-synced draft twice
 * server-side (see offlineDraftQueue.ts). */
export async function runSync(options: { force?: boolean; ignoreBackoff?: boolean } = {}): Promise<{ survey: SyncResult; draft: DraftSyncResult }> {
  if (!currentUsername) {
    const empty = { synced: 0, failed: 0, permanentlyFailed: 0 };
    return { survey: empty, draft: empty };
  }
  if (!surveyInFlight) {
    surveyInFlight = (async () => {
      setState({ syncing: true });
      try {
        return await syncQueue(currentUsername!, options);
      } finally {
        surveyInFlight = null;
      }
    })();
  }
  if (!draftInFlight) {
    draftInFlight = (async () => {
      setState({ syncing: true });
      try {
        return await syncDraftQueue(currentUsername!, options);
      } finally {
        draftInFlight = null;
      }
    })();
  }
  try {
    const [survey, draft] = await Promise.all([surveyInFlight, draftInFlight]);
    return { survey, draft };
  } finally {
    setState({ syncing: false });
    await refreshCounts();
  }
}

/** Adopts every pre-per-user-queue survey-submission entry under the
 * current user and immediately attempts to sync them. The caller (a UI
 * prompt) is responsible for getting the user's explicit confirmation
 * first — use the `legacyCount` in the subscribed state to decide whether
 * to ask. */
export async function adoptLegacyQueue(): Promise<number> {
  if (!currentUsername) return 0;
  const count = await adoptLegacyQueueInStore(currentUsername);
  await refreshCounts();
  if (count > 0) runSync();
  return count;
}

let initialized = false;
const PERIODIC_INTERVAL_MS = 60000;

/** Wires every trigger that should attempt a sync. Idempotent — safe to call
 * from every mount of the component that shows sync status, without needing
 * the caller to track whether it's "the first" mount. */
export function initSyncManager() {
  if (initialized) return;
  initialized = true;

  // The event only fires on a genuine offline→online *transition* — it
  // never fires on a cold start where the device was already connected,
  // which is exactly why the old implementation went silent in that case
  // (setCurrentUser below covers that case instead). ignoreBackoff: true
  // because this is exactly the signal backoff exists to wait for — an
  // entry whose backoff was set moments earlier (e.g. by an immediate sync
  // attempt made while still offline) must not sit there ignoring a
  // just-arrived reconnect; verified live, see commit history.
  window.addEventListener("online", () => {
    if (navigator.onLine) runSync({ ignoreBackoff: true });
  });

  // Covers the app/tab coming back to the foreground — important in a
  // Capacitor WebView, where enumerators switch apps constantly and the
  // `online` event won't fire if connectivity never actually dropped. Same
  // ignoreBackoff reasoning as the online listener above — the user just
  // picked the app back up, a real signal worth acting on immediately.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) runSync({ ignoreBackoff: true });
  });

  // Backstop for flaky-rather-than-fully-offline connections, where
  // individual requests fail without the device ever actually toggling its
  // online/offline state. Only fires while something is actually retryable
  // (pending > failed) — a queue that's entirely "failed" entries waiting
  // on the user doesn't need polling. This timer intentionally lives for
  // the app's lifetime — initSyncManager() is a one-time singleton setup,
  // not tied to any one component's mount/unmount.
  setInterval(() => {
    if (navigator.onLine && state.pending > state.failed) runSync();
  }, PERIODIC_INTERVAL_MS);
}

/** Called by AuthContext whenever the logged-in device user changes (login,
 * a restored session on app launch, or logout → null). Every queue
 * operation above is scoped to this user, so nothing before this is called
 * can touch the queues — and a device that was offline through an entire
 * login/token-refresh cycle syncs immediately once the user is known,
 * rather than waiting for the next periodic tick or app switch.
 *
 * `sessionRestored` distinguishes "the same session carried straight
 * through an app update" from "somebody logged in fresh". It decides how
 * pre-per-user-queue entries get adopted:
 *  - restored session → the device never changed hands since that data was
 *    collected, so adopt silently and just tell the user afterwards.
 *    Waiting on a tap here is how surveys stay stranded — the field team
 *    already went weeks without noticing the sync indicator.
 *  - fresh login → the device may have changed hands since (enumerator A
 *    logged out, B logged in), so attribution is genuinely ambiguous and
 *    the UI asks before filing someone else's surveys under this account. */
export function setCurrentUser(username: string | null, options: { sessionRestored?: boolean } = {}) {
  currentUsername = username;
  refreshCounts().then(() => {
    if (username && options.sessionRestored && state.legacyCount > 0) {
      const adopting = state.legacyCount;
      adoptLegacyQueue().then((adopted) => {
        if (adopted > 0) setState({ autoAdopted: adopting });
      });
    }
  });
  if (username && navigator.onLine) runSync({ ignoreBackoff: true });
}

/** Dismisses the "we adopted N surveys for you" notice. */
export function clearAutoAdoptedNotice() {
  setState({ autoAdopted: 0 });
}
