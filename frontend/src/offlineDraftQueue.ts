import { get, set, del, keys } from "idb-keyval";
import { api, isPermanentError } from "./api";

// Mirrors offlineQueue.ts's shape, but for Save-as-Draft. Kept as a
// separate module rather than generalizing the two into one, because the
// two have a real behavioral difference: a submitted survey's create is
// deduped server-side by client_uuid (see FarmerSurvey.client_uuid), but
// SurveyDraftIn has no such field — createSurveyDraft() has NO dedup
// protection at all. Calling it twice for "the same" offline-created draft
// (once from the wizard's own save, once from a background sync pass)
// would silently create two separate draft rows.
//
// The queue is therefore write-through and single-flight by construction:
// saveDraft() in the wizard never calls the create/update API directly —
// it only ever writes to this local queue, then asks syncManager to flush
// it through the one shared single-flight gate also used by the periodic/
// online/visibility triggers. That guarantees at most one in-flight sync
// pass for a given user's draft queue at any time, so a given entry's first
// successful `create` is always the only one that happens — every
// subsequent save for that same entry, however it was triggered, is
// necessarily an `update` once the entry carries a `surveyId`.

const PREFIX = "pending-draft:";

export type QueueStatus = "pending" | "failed";

export type QueuedDraft = {
  clientUuid: string;
  payload: any;
  queuedAt: string;
  updatedAt: string;
  // Set once this draft has a real server id — either it already had one
  // (an existing server draft being edited offline) or a previous sync
  // created it and was assigned one. Present => the next sync is an update,
  // never a create.
  surveyId?: number;
  status: QueueStatus;
  attempts: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  lastError?: string;
};

export type DraftSyncResult = { synced: number; failed: number; permanentlyFailed: number };

function keyFor(username: string, clientUuid: string) {
  return `${PREFIX}${username}:${clientUuid}`;
}

function isUserKey(key: string, username: string): boolean {
  return key.startsWith(`${PREFIX}${username}:`);
}

async function listByPredicate(predicate: (key: string) => boolean): Promise<{ key: string; entry: QueuedDraft }[]> {
  const allKeys = await keys();
  const matching = allKeys.filter((k) => typeof k === "string" && predicate(k)) as string[];
  const rows = await Promise.all(matching.map(async (key) => ({ key, entry: await get(key) })));
  return rows.filter((r) => r.entry) as { key: string; entry: QueuedDraft }[];
}

/** Writes (or overwrites) a draft into the local queue. `clientUuid` must be
 * stable across repeated saves of the *same* in-progress draft — the caller
 * (the wizard) generates one once per brand-new draft and reuses it for
 * every subsequent save in that session, so re-saving updates this same
 * entry instead of creating a duplicate local queue row. Resets `status`
 * back to "pending" and clears backoff/attempts, since new content is worth
 * a fresh attempt even if the previous save had failed. */
export async function queueDraft(username: string, payload: any, clientUuid: string, surveyId?: number): Promise<void> {
  const key = keyFor(username, clientUuid);
  const existing: QueuedDraft | undefined = await get(key);
  const entry: QueuedDraft = {
    clientUuid,
    payload,
    queuedAt: existing?.queuedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    surveyId: surveyId ?? existing?.surveyId,
    status: "pending",
    attempts: 0,
  };
  await set(key, entry);
}

export async function getQueuedDraft(username: string, clientUuid: string): Promise<QueuedDraft | undefined> {
  return get(keyFor(username, clientUuid));
}

/** Finds a locally-queued draft by the server id it's an offline edit of —
 * used when opening an existing draft (`?id=123`) to check whether a newer,
 * not-yet-synced local version should be shown instead of fetching the
 * (stale) server copy. */
export async function findQueuedDraftBySurveyId(username: string, surveyId: number): Promise<QueuedDraft | undefined> {
  const rows = await listByPredicate((k) => isUserKey(k, username));
  return rows.map((r) => r.entry).find((e) => e.surveyId === surveyId);
}

export async function listQueuedDrafts(username: string): Promise<QueuedDraft[]> {
  const rows = await listByPredicate((k) => isUserKey(k, username));
  return rows.map((r) => r.entry).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function pendingDraftCount(username: string): Promise<number> {
  return (await listQueuedDrafts(username)).length;
}

export async function failedDraftCount(username: string): Promise<number> {
  return (await listQueuedDrafts(username)).filter((e) => e.status === "failed").length;
}

export async function deleteQueuedDraft(username: string, clientUuid: string): Promise<void> {
  await del(keyFor(username, clientUuid));
}

const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const MAX_BACKOFF_EXPONENT = 6;

function nextBackoffDelayMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.min(attempts, MAX_BACKOFF_EXPONENT), MAX_BACKOFF_MS);
}

/** Pushes every locally-queued draft for this user to the server, oldest
 * first. A brand-new draft (no `surveyId` yet) is created and the entry is
 * updated in place with the id the server assigned — not deleted — because
 * the wizard may still be open on this exact draft and needs to pick up
 * the real id (see DataEntryWizard's periodic getQueuedDraft poll) so its
 * *next* save is an update rather than risking a second create. An entry
 * is only ever deleted here once there's nothing further to send for it,
 * which for a draft (unlike a finished survey) is really "the wizard moved
 * on" — practically, entries are cleaned up by the wizard itself once it
 * confirms a save matches what's on screen (see clearIfUnchanged below). */
// See offlineQueue.ts's syncQueue() for why `force` and `ignoreBackoff` are
// two separate flags, not one.
export async function syncDraftQueue(username: string, options: { force?: boolean; ignoreBackoff?: boolean } = {}): Promise<DraftSyncResult> {
  const queued = await listQueuedDrafts(username);
  const now = Date.now();
  let synced = 0;
  let failed = 0;
  let permanentlyFailed = 0;

  for (const entry of queued) {
    if (!options.force) {
      if (entry.status === "failed") {
        permanentlyFailed++;
        continue;
      }
      if (!options.ignoreBackoff && entry.nextAttemptAt && new Date(entry.nextAttemptAt).getTime() > now) continue;
    }
    try {
      const saved = entry.surveyId
        ? await api.updateSurveyDraft(entry.surveyId, entry.payload)
        : await api.createSurveyDraft(entry.payload);
      await set(keyFor(username, entry.clientUuid), { ...entry, surveyId: saved.id, status: "pending", attempts: 0, lastError: undefined, nextAttemptAt: undefined });
      synced++;
    } catch (e: any) {
      const lastAttemptAt = new Date().toISOString();
      if (isPermanentError(e)) {
        await set(keyFor(username, entry.clientUuid), { ...entry, status: "failed", lastAttemptAt, lastError: e?.message });
        permanentlyFailed++;
      } else {
        const attempts = entry.attempts + 1;
        const nextAttemptAt = new Date(now + nextBackoffDelayMs(attempts)).toISOString();
        await set(keyFor(username, entry.clientUuid), { ...entry, attempts, lastAttemptAt, nextAttemptAt, lastError: e?.message });
        failed++;
      }
    }
  }
  return { synced, failed, permanentlyFailed };
}

/** Called by the wizard after a successful sync pass: if the on-screen
 * draft's queue entry now matches what's already been sent to the server
 * (same payload, i.e. nothing's been typed since), it's safe to drop from
 * the local queue — it's fully represented server-side and will load
 * normally via `?id=` from then on. If the payload has since changed
 * (synced from a previous save, but the user kept typing), it's left
 * queued so the newer content still gets synced. */
export async function clearIfUnchanged(username: string, clientUuid: string, currentPayload: any): Promise<void> {
  const entry = await getQueuedDraft(username, clientUuid);
  if (entry && entry.status === "pending" && !entry.lastError && JSON.stringify(entry.payload) === JSON.stringify(currentPayload)) {
    await deleteQueuedDraft(username, clientUuid);
  }
}
