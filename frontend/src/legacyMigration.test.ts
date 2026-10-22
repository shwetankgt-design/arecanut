import { describe, it, expect, vi, beforeEach } from "vitest";
import { clear, set, get, keys } from "idb-keyval";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, api: { createSurvey: vi.fn(), updateSurvey: vi.fn() } };
});
vi.mock("./lib/analytics", () => ({ analytics: { track: vi.fn() } }));

import { api, ApiError } from "./api";
import { listQueued, syncQueue, listLegacyQueued, adoptLegacyQueue } from "./offlineQueue";

const USER = "enumerator1";

// Exactly what the CURRENTLY DEPLOYED app writes to IndexedDB — note there
// is no `status` and no `attempts` field, because those were introduced by
// the new queue. Any device in the field right now holds entries in this
// shape, so the new code has to handle them without choking.
function legacyEntry(clientUuid: string, overrides: Record<string, unknown> = {}) {
  return {
    clientUuid,
    payload: { farmer_name: "Field Collected", client_uuid: clientUuid },
    queuedAt: new Date("2026-10-01T09:00:00Z").toISOString(),
    isUpdate: false,
    ...overrides,
  };
}

beforeEach(async () => {
  await clear();
  vi.clearAllMocks();
});

describe("real field data collected by the OLD app", () => {
  it("is detected as legacy and adopted under the logged-in user", async () => {
    await set("pending-survey:abc-123", legacyEntry("abc-123"));
    expect(await listLegacyQueued()).toHaveLength(1);
    await adoptLegacyQueue(USER);
    const adopted = await listQueued(USER);
    expect(adopted).toHaveLength(1);
    expect(adopted[0].payload.farmer_name).toBe("Field Collected");
  });

  it("syncs successfully when the server accepts it", async () => {
    await set("pending-survey:abc-123", legacyEntry("abc-123"));
    await adoptLegacyQueue(USER);
    (api.createSurvey as any).mockResolvedValue({ id: 500 });
    const result = await syncQueue(USER);
    expect(result.synced).toBe(1);
    expect(await listQueued(USER)).toHaveLength(0);
  });

  it("survives a TRANSIENT failure without corrupting the entry or throwing", async () => {
    // The realistic field case: flaky connection on the first retry after
    // upgrading. A legacy entry has `attempts: undefined`, so any arithmetic
    // on it produces NaN — and `new Date(now + NaN).toISOString()` throws
    // RangeError, which would abort the whole sync pass and leave every
    // remaining queued survey unprocessed.
    await set("pending-survey:abc-123", legacyEntry("abc-123"));
    await adoptLegacyQueue(USER);
    (api.createSurvey as any).mockRejectedValue(new ApiError("Network error", 0));

    const result = await syncQueue(USER);
    expect(result.failed).toBe(1);

    const [entry] = await listQueued(USER);
    expect(entry).toBeDefined();
    expect(Number.isFinite(entry.attempts)).toBe(true); // must not be NaN
    expect(entry.nextAttemptAt).toBeTruthy();
    expect(new Date(entry.nextAttemptAt!).getTime()).not.toBeNaN();
  });

  it("does not let one bad legacy entry block the rest of the queue", async () => {
    await set("pending-survey:aaa-111", legacyEntry("aaa-111"));
    await adoptLegacyQueue(USER);
    await set(`pending-survey:${USER}:bbb-222`, {
      clientUuid: "bbb-222",
      payload: { farmer_name: "Newer entry", client_uuid: "bbb-222" },
      queuedAt: new Date("2026-10-02T09:00:00Z").toISOString(),
      isUpdate: false,
      status: "pending",
      attempts: 0,
    });

    // First (legacy, oldest) fails transiently; the second must still be attempted.
    (api.createSurvey as any)
      .mockRejectedValueOnce(new ApiError("Network error", 0))
      .mockResolvedValueOnce({ id: 501 });

    const result = await syncQueue(USER);
    expect(api.createSurvey).toHaveBeenCalledTimes(2);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("keeps the client_uuid intact so the server dedups a survey that partially synced before the upgrade", async () => {
    await set("pending-survey:abc-123", legacyEntry("abc-123"));
    await adoptLegacyQueue(USER);
    (api.createSurvey as any).mockResolvedValue({ id: 500 });
    await syncQueue(USER);
    expect(api.createSurvey).toHaveBeenCalledWith(expect.objectContaining({ client_uuid: "abc-123" }));
  });
});

describe("legacy key detection", () => {
  it("does not mistake a new per-user key for a legacy one", async () => {
    await set(`pending-survey:${USER}:xyz`, legacyEntry("xyz", { status: "pending", attempts: 0 }));
    expect(await listLegacyQueued()).toHaveLength(0);
  });

  it("leaves another user's entries alone when adopting", async () => {
    await set("pending-survey:legacy-1", legacyEntry("legacy-1"));
    await set("pending-survey:other_user:their-entry", legacyEntry("their-entry", { status: "pending", attempts: 0 }));
    await adoptLegacyQueue(USER);
    expect(await listQueued(USER)).toHaveLength(1);
    expect(await listQueued("other_user")).toHaveLength(1);
    const remaining = (await keys()).filter((k) => typeof k === "string" && k.includes("other_user"));
    expect(remaining).toHaveLength(1);
    expect(await get(remaining[0] as string)).toBeTruthy();
  });
});
