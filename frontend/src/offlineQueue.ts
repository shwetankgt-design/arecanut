import { get, set, del, keys } from "idb-keyval";
import { api } from "./api";

const PREFIX = "pending-survey:";

export type QueuedSurvey = { clientUuid: string; payload: any; queuedAt: string; isUpdate: boolean; surveyId?: number };

function newUuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function queueSurvey(payload: any, isUpdate = false, surveyId?: number) {
  const clientUuid = payload.client_uuid || newUuid();
  const entry: QueuedSurvey = { clientUuid, payload: { ...payload, client_uuid: clientUuid }, queuedAt: new Date().toISOString(), isUpdate, surveyId };
  await set(PREFIX + clientUuid, entry);
  return clientUuid;
}

export async function listQueued(): Promise<QueuedSurvey[]> {
  const allKeys = await keys();
  const surveyKeys = allKeys.filter((k) => typeof k === "string" && k.startsWith(PREFIX));
  const entries = await Promise.all(surveyKeys.map((k) => get(k as string)));
  return entries.filter(Boolean) as QueuedSurvey[];
}

export async function pendingCount() {
  return (await listQueued()).length;
}

/** Push every queued survey to the server. Safe to call repeatedly — already-synced
 * entries (matched by client_uuid) are deduped server-side, so retries are harmless. */
export async function syncQueue(): Promise<{ synced: number; failed: number }> {
  const queued = await listQueued();
  let synced = 0;
  let failed = 0;
  for (const entry of queued) {
    try {
      if (entry.isUpdate && entry.surveyId) {
        await api.updateSurvey(entry.surveyId, entry.payload);
      } else {
        await api.createSurvey(entry.payload);
      }
      await del(PREFIX + entry.clientUuid);
      synced++;
    } catch (e) {
      failed++;
    }
  }
  return { synced, failed };
}

let listenerAttached = false;
export function attachAutoSync(onSync?: (result: { synced: number; failed: number }) => void) {
  if (listenerAttached) return;
  listenerAttached = true;
  window.addEventListener("online", async () => {
    const result = await syncQueue();
    if (result.synced > 0) onSync?.(result);
  });
}
