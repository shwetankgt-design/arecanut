import { get, set, del, keys } from "idb-keyval";
import { api, isPermanentError } from "./api";
import { analytics } from "./lib/analytics";

const PREFIX = "pending-survey:";

export type QueueStatus = "pending" | "failed";

export type QueuedSurvey = {
  clientUuid: string;
  payload: any;
  queuedAt: string;
  isUpdate: boolean;
  surveyId?: number;
  // "failed": a sync attempt came back with a rejection that retrying won't
  // fix (bad data, no permission, etc — see api.ts's isPermanentError), or
  // a queued edit missing its target id (see syncQueue below). Kept (not
  // deleted) so the entry stays visible rather than silently vanishing, but
  // excluded from automatic retry passes — see syncQueue()'s `force`.
  status: QueueStatus;
  attempts: number;
  lastAttemptAt?: string;
  // Exponential backoff — set after a transient failure so a flaky-signal
  // entry doesn't get re-hammered on every single sync trigger.
  nextAttemptAt?: string;
  lastError?: string;
};

export type SyncResult = { synced: number; failed: number; permanentlyFailed: number };

export function newUuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function keyFor(username: string, clientUuid: string) {
  return `${PREFIX}${username}:${clientUuid}`;
}

// A key from before the queue was scoped per device user: `pending-survey:<uuid>`,
// no username segment. Detected by the absence of a second colon after the
// prefix (usernames and UUIDs never contain ":").
function isLegacyKey(key: string): boolean {
  return key.startsWith(PREFIX) && !key.slice(PREFIX.length).includes(":");
}

function isUserKey(key: string, username: string): boolean {
  return key.startsWith(`${PREFIX}${username}:`);
}

async function listByPredicate(predicate: (key: string) => boolean): Promise<{ key: string; entry: QueuedSurvey }[]> {
  const allKeys = await keys();
  const matching = allKeys.filter((k) => typeof k === "string" && predicate(k)) as string[];
  const rows = await Promise.all(matching.map(async (key) => ({ key, entry: await get(key) })));
  return rows.filter((r) => r.entry) as { key: string; entry: QueuedSurvey }[];
}

export async function queueSurvey(username: string, payload: any, isUpdate = false, surveyId?: number) {
  const clientUuid = payload.client_uuid || newUuid();
  const entry: QueuedSurvey = {
    clientUuid,
    payload: { ...payload, client_uuid: clientUuid },
    queuedAt: new Date().toISOString(),
    isUpdate,
    surveyId,
    status: "pending",
    attempts: 0,
  };
  await set(keyFor(username, clientUuid), entry);
  return clientUuid;
}

export async function listQueued(username: string): Promise<QueuedSurvey[]> {
  const rows = await listByPredicate((k) => isUserKey(k, username));
  // Oldest first — `queuedAt` was recorded on every entry but never actually
  // used to order the retry pass (idb-keyval's `keys()` has no guaranteed
  // order, effectively random for UUID-suffixed keys).
  return rows.map((r) => r.entry).sort((a, b) => (a.queuedAt || "").localeCompare(b.queuedAt || ""));
}

/** Entries queued before the queue was scoped per device user. Surfaced so
 * the person currently logged in can explicitly confirm they're the one who
 * collected them (see adoptLegacyQueue) rather than the app silently
 * guessing — on a shared device, guessing wrong means a survey gets synced
 * under the wrong enumerator's name. */
export async function listLegacyQueued(): Promise<QueuedSurvey[]> {
  return (await listByPredicate(isLegacyKey)).map((r) => r.entry);
}

/** Re-keys every legacy (un-namespaced) entry under the given username and
 * removes the old key. Idempotent — safe to call even if some entries were
 * already migrated by an earlier call. Returns how many were adopted.
 *
 * Also normalizes the entry to the current shape: an entry written by the
 * previously-shipped app has no `status` and no `attempts` at all, and
 * `undefined + 1` is NaN — which then produced `new Date(NaN).toISOString()`
 * and threw, aborting the whole sync pass (not just that entry) the first
 * time a real survey collected in the field hit a flaky connection. */
export async function adoptLegacyQueue(username: string): Promise<number> {
  const rows = await listByPredicate(isLegacyKey);
  for (const { key, entry } of rows) {
    await set(keyFor(username, entry.clientUuid), normalizeEntry(entry));
    await del(key);
  }
  return rows.length;
}

/** Fills in fields that entries from an older build of the app don't carry. */
function normalizeEntry(entry: QueuedSurvey): QueuedSurvey {
  return {
    ...entry,
    queuedAt: entry.queuedAt || new Date().toISOString(),
    status: entry.status ?? "pending",
    attempts: Number.isFinite(entry.attempts) ? entry.attempts : 0,
  };
}

export async function pendingCount(username: string): Promise<number> {
  return (await listQueued(username)).length;
}

export async function failedCount(username: string): Promise<number> {
  return (await listQueued(username)).filter((e) => e.status === "failed").length;
}

export async function deleteQueued(username: string, clientUuid: string): Promise<void> {
  await del(keyFor(username, clientUuid));
}

const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const MAX_BACKOFF_EXPONENT = 6; // 30s, 1m, 2m, 4m, 8m, 16m, then capped at 30m

function nextBackoffDelayMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.min(attempts, MAX_BACKOFF_EXPONENT), MAX_BACKOFF_MS);
}

/** Push every queued survey for this user to the server, oldest first.
 * Safe to call repeatedly — already-synced entries (matched by client_uuid)
 * are deduped server-side, so retries are harmless.
 *
 * By default, entries already marked "failed" or still cooling down under
 * backoff are skipped, so one bad or recently-retried record doesn't get
 * hammered on every automatic sync trigger. Two independent escape
 * hatches, deliberately not the same flag:
 *  - `force: true` — the user-initiated "Sync"/"Retry" action — retries
 *    everything, including entries already marked "failed", since whatever
 *    caused a rejection may have been fixed since.
 *  - `ignoreBackoff: true` — a *meaningful reconnect signal* (the browser's
 *    `online` event, the app coming back to the foreground, or a fresh
 *    login) — skips the backoff wait but still leaves "failed" entries
 *    alone. Without this, an entry whose backoff was set moments earlier
 *    (e.g. by a save that attempted an immediate sync while still offline)
 *    would sit there for up to its full backoff window even after
 *    reconnecting, which fails the "comes back online, syncs with no user
 *    interaction" requirement this whole queue exists to satisfy. */
export async function syncQueue(username: string, options: { force?: boolean; ignoreBackoff?: boolean } = {}): Promise<SyncResult> {
  const queued = await listQueued(username);
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
      if (!options.ignoreBackoff && entry.nextAttemptAt && new Date(entry.nextAttemptAt).getTime() > now) continue; // still cooling down
    }
    try {
      if (entry.isUpdate && entry.surveyId) {
        await api.updateSurvey(entry.surveyId, entry.payload);
      } else if (entry.isUpdate && !entry.surveyId) {
        // A queued edit with no target id would otherwise silently fall
        // through to createSurvey — the server's client_uuid dedup then
        // either creates a stray duplicate or (if some earlier attempt
        // already got through) just returns the existing row unchanged,
        // discarding this edit while reporting it as "synced". Treat the
        // missing id as the data-integrity problem it is instead.
        throw Object.assign(new Error("This queued edit is missing its target record and can't be synced automatically — discard it and re-enter the change."), { dataIntegrity: true });
      } else {
        await api.createSurvey(entry.payload);
      }
      await deleteQueued(username, entry.clientUuid);
      synced++;
    } catch (e: any) {
      const lastAttemptAt = new Date().toISOString();
      if (e?.dataIntegrity || isPermanentError(e)) {
        await set(keyFor(username, entry.clientUuid), { ...entry, status: "failed", lastAttemptAt, lastError: e?.message });
        permanentlyFailed++;
      } else {
        // `?? 0` guard, not just cosmetic: an entry written by an older
        // build of the app has no `attempts` field at all, and NaN here
        // used to throw out of the whole loop via `new Date(NaN)`,
        // abandoning every remaining queued survey in the pass.
        const attempts = (Number.isFinite(entry.attempts) ? entry.attempts : 0) + 1;
        const nextAttemptAt = new Date(now + nextBackoffDelayMs(attempts)).toISOString();
        await set(keyFor(username, entry.clientUuid), { ...entry, attempts, lastAttemptAt, nextAttemptAt, lastError: e?.message });
        failed++;
      }
    }
  }
  if (synced > 0 || failed > 0 || permanentlyFailed > 0) analytics.track("survey_synced", { synced, failed, permanentlyFailed });
  return { synced, failed, permanentlyFailed };
}
