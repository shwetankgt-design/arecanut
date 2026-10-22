import { describe, it, expect, vi, beforeEach } from "vitest";
import { clear, set } from "idb-keyval";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, api: { createSurvey: vi.fn(), updateSurvey: vi.fn() } };
});
vi.mock("./lib/analytics", () => ({ analytics: { track: vi.fn() } }));

import { api, ApiError } from "./api";
import { queueSurvey, listQueued, syncQueue, pendingCount, listLegacyQueued, adoptLegacyQueue } from "./offlineQueue";

const USER = "enumerator1";

beforeEach(async () => {
  await clear();
  vi.clearAllMocks();
});

describe("queueSurvey / listQueued", () => {
  it("queues a survey scoped to the given user", async () => {
    await queueSurvey(USER, { farmer_name: "A" });
    const queued = await listQueued(USER);
    expect(queued).toHaveLength(1);
    expect(queued[0].payload.farmer_name).toBe("A");
    expect(queued[0].status).toBe("pending");
  });

  it("does not leak entries between users on the same device", async () => {
    await queueSurvey(USER, { farmer_name: "A" });
    await queueSurvey("other_user", { farmer_name: "B" });
    expect(await listQueued(USER)).toHaveLength(1);
    expect(await pendingCount("other_user")).toBe(1);
  });

  it("orders entries oldest first — queuedAt was recorded but previously never actually used", async () => {
    await queueSurvey(USER, { farmer_name: "first", client_uuid: "c1" });
    await new Promise((r) => setTimeout(r, 2));
    await queueSurvey(USER, { farmer_name: "second", client_uuid: "c2" });
    const queued = await listQueued(USER);
    expect(queued.map((q) => q.payload.farmer_name)).toEqual(["first", "second"]);
  });
});

describe("syncQueue", () => {
  it("removes an entry from the queue on success", async () => {
    await queueSurvey(USER, { farmer_name: "A" });
    (api.createSurvey as any).mockResolvedValue({ id: 1 });
    const result = await syncQueue(USER);
    expect(result).toEqual({ synced: 1, failed: 0, permanentlyFailed: 0 });
    expect(await pendingCount(USER)).toBe(0);
  });

  it("keeps a transiently-failed entry queued with backoff set, not deleted and not marked failed", async () => {
    await queueSurvey(USER, { farmer_name: "A" });
    (api.createSurvey as any).mockRejectedValue(new ApiError("Network error", 0));
    const result = await syncQueue(USER);
    expect(result).toEqual({ synced: 0, failed: 1, permanentlyFailed: 0 });
    const [entry] = await listQueued(USER);
    expect(entry.status).toBe("pending");
    expect(entry.attempts).toBe(1);
    expect(entry.nextAttemptAt).toBeTruthy();
  });

  it("marks a permanently-rejected entry failed, then stops auto-retrying it — until an explicit force", async () => {
    await queueSurvey(USER, { farmer_name: "A" });
    (api.createSurvey as any).mockRejectedValue(new ApiError("Validation error", 422));
    const first = await syncQueue(USER);
    expect(first.permanentlyFailed).toBe(1);
    const [entry] = await listQueued(USER);
    expect(entry.status).toBe("failed");

    (api.createSurvey as any).mockClear();
    const second = await syncQueue(USER); // automatic pass — must not hammer a known-bad entry
    expect(api.createSurvey).not.toHaveBeenCalled();
    expect(second.permanentlyFailed).toBe(1);

    (api.createSurvey as any).mockResolvedValue({ id: 1 });
    const forced = await syncQueue(USER, { force: true }); // user-initiated retry — may have been fixed since
    expect(forced.synced).toBe(1);
  });

  it("does not retry a transiently-failed entry again before its backoff window elapses", async () => {
    await queueSurvey(USER, { farmer_name: "A" });
    (api.createSurvey as any).mockRejectedValue(new ApiError("Network error", 0));
    await syncQueue(USER);
    (api.createSurvey as any).mockClear();
    const second = await syncQueue(USER); // immediately after — still cooling down
    expect(api.createSurvey).not.toHaveBeenCalled();
    expect(second).toEqual({ synced: 0, failed: 0, permanentlyFailed: 0 });
  });

  it("ignoreBackoff retries a cooling-down entry without resurrecting a failed one — the reconnect-signal case", async () => {
    // Caught live: saveDraft()-style flows attempt an immediate sync even
    // while offline, which sets a backoff timestamp. If the subsequent
    // `online` event then called a plain (non-ignoreBackoff) sync, the
    // entry would sit there respecting that backoff for up to a minute
    // after reconnecting — failing the "syncs with no user interaction"
    // requirement. ignoreBackoff is the reconnect-trigger's fix for that.
    await queueSurvey(USER, { farmer_name: "transient", client_uuid: "c1" });
    (api.createSurvey as any).mockRejectedValue(new ApiError("Network error", 0));
    await syncQueue(USER); // sets backoff
    (api.createSurvey as any).mockClear();

    (api.createSurvey as any).mockResolvedValue({ id: 1 });
    const result = await syncQueue(USER, { ignoreBackoff: true });
    expect(api.createSurvey).toHaveBeenCalledTimes(1);
    expect(result.synced).toBe(1);
  });

  it("ignoreBackoff does NOT retry an entry already marked failed — that still needs force/explicit user action", async () => {
    await queueSurvey(USER, { farmer_name: "A" });
    (api.createSurvey as any).mockRejectedValue(new ApiError("Validation error", 422));
    await syncQueue(USER); // marks it failed
    (api.createSurvey as any).mockClear();

    const result = await syncQueue(USER, { ignoreBackoff: true });
    expect(api.createSurvey).not.toHaveBeenCalled();
    expect(result.permanentlyFailed).toBe(1);
  });

  it("force bypasses backoff too", async () => {
    await queueSurvey(USER, { farmer_name: "A" });
    (api.createSurvey as any).mockResolvedValue({ id: 1 });
    await syncQueue(USER, { force: true });
    expect(api.createSurvey).toHaveBeenCalledTimes(1);
  });

  it("treats a queued edit with no surveyId as a data-integrity failure instead of silently falling through to create", async () => {
    await queueSurvey(USER, { farmer_name: "A" }, true, undefined);
    const result = await syncQueue(USER);
    expect(api.createSurvey).not.toHaveBeenCalled();
    expect(api.updateSurvey).not.toHaveBeenCalled();
    expect(result.permanentlyFailed).toBe(1);
    const [entry] = await listQueued(USER);
    expect(entry.status).toBe("failed");
  });

  it("calls updateSurvey, not createSurvey, for a queued edit that has a surveyId", async () => {
    await queueSurvey(USER, { farmer_name: "A" }, true, 42);
    (api.updateSurvey as any).mockResolvedValue({ id: 42 });
    await syncQueue(USER);
    expect(api.updateSurvey).toHaveBeenCalledWith(42, expect.anything());
    expect(api.createSurvey).not.toHaveBeenCalled();
  });

  it("processes entries oldest-first within a single pass", async () => {
    await queueSurvey(USER, { farmer_name: "first", client_uuid: "c1" });
    await new Promise((r) => setTimeout(r, 2));
    await queueSurvey(USER, { farmer_name: "second", client_uuid: "c2" });
    const order: string[] = [];
    (api.createSurvey as any).mockImplementation(async (payload: any) => {
      order.push(payload.farmer_name);
      return { id: order.length };
    });
    await syncQueue(USER);
    expect(order).toEqual(["first", "second"]);
  });
});

describe("legacy queue migration", () => {
  it("adopts an un-namespaced (pre-per-user-queue) entry under the given user and removes the old key", async () => {
    await set("pending-survey:legacy-uuid-123", {
      clientUuid: "legacy-uuid-123",
      payload: { farmer_name: "Legacy" },
      queuedAt: new Date().toISOString(),
      isUpdate: false,
      status: "pending",
      attempts: 0,
    });
    expect(await listLegacyQueued()).toHaveLength(1);
    const adopted = await adoptLegacyQueue(USER);
    expect(adopted).toBe(1);
    expect(await listLegacyQueued()).toHaveLength(0);
    expect(await listQueued(USER)).toHaveLength(1);
  });

  it("is idempotent — adopting twice doesn't error or duplicate", async () => {
    await set("pending-survey:legacy-uuid-123", {
      clientUuid: "legacy-uuid-123",
      payload: { farmer_name: "Legacy" },
      queuedAt: new Date().toISOString(),
      isUpdate: false,
      status: "pending",
      attempts: 0,
    });
    await adoptLegacyQueue(USER);
    const secondPass = await adoptLegacyQueue(USER);
    expect(secondPass).toBe(0);
    expect(await listQueued(USER)).toHaveLength(1);
  });
});
