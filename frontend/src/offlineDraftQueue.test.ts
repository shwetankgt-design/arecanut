import { describe, it, expect, vi, beforeEach } from "vitest";
import { clear } from "idb-keyval";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, api: { createSurveyDraft: vi.fn(), updateSurveyDraft: vi.fn() } };
});

import { api, ApiError } from "./api";
import { queueDraft, getQueuedDraft, listQueuedDrafts, syncDraftQueue, findQueuedDraftBySurveyId, clearIfUnchanged } from "./offlineDraftQueue";

const USER = "enumerator1";

beforeEach(async () => {
  await clear();
  vi.clearAllMocks();
});

describe("queueDraft", () => {
  it("reuses the same local entry across repeated saves of the same clientUuid, rather than creating duplicates", async () => {
    await queueDraft(USER, { farmer_name: "v1" }, "draft-1");
    await queueDraft(USER, { farmer_name: "v2" }, "draft-1");
    const all = await listQueuedDrafts(USER);
    expect(all).toHaveLength(1);
    expect(all[0].payload.farmer_name).toBe("v2");
  });

  it("preserves queuedAt but bumps updatedAt on a re-save", async () => {
    await queueDraft(USER, { farmer_name: "v1" }, "draft-1");
    const first = await getQueuedDraft(USER, "draft-1");
    await new Promise((r) => setTimeout(r, 2));
    await queueDraft(USER, { farmer_name: "v2" }, "draft-1");
    const second = await getQueuedDraft(USER, "draft-1");
    expect(second!.queuedAt).toBe(first!.queuedAt);
    expect(second!.updatedAt).not.toBe(first!.updatedAt);
  });
});

describe("syncDraftQueue — the no-double-create invariant", () => {
  // SurveyDraftIn has no client_uuid / server-side dedup at all (unlike a
  // submitted survey), so calling createSurveyDraft twice for the same
  // offline-created draft would silently produce two separate rows. This
  // is the single most important guarantee this module makes.
  it("creates once, assigns the server id back onto the entry, and every subsequent sync updates instead", async () => {
    await queueDraft(USER, { farmer_name: "A" }, "draft-1");
    (api.createSurveyDraft as any).mockResolvedValue({ id: 99 });

    await syncDraftQueue(USER, { force: true });
    expect(api.createSurveyDraft).toHaveBeenCalledTimes(1);
    const entry = await getQueuedDraft(USER, "draft-1");
    expect(entry!.surveyId).toBe(99);

    // A second pass for the same entry (e.g. the background sync manager
    // firing again before the wizard has cleared it) must update, never
    // create a second time.
    (api.updateSurveyDraft as any).mockResolvedValue({ id: 99 });
    await syncDraftQueue(USER, { force: true });
    expect(api.createSurveyDraft).toHaveBeenCalledTimes(1); // still exactly once, ever
    expect(api.updateSurveyDraft).toHaveBeenCalledWith(99, expect.anything());
  });

  it("goes straight to update when the entry already carries a surveyId (an offline edit of an existing draft)", async () => {
    await queueDraft(USER, { farmer_name: "A" }, "draft-1", 55);
    (api.updateSurveyDraft as any).mockResolvedValue({ id: 55 });
    await syncDraftQueue(USER, { force: true });
    expect(api.createSurveyDraft).not.toHaveBeenCalled();
    expect(api.updateSurveyDraft).toHaveBeenCalledWith(55, expect.anything());
  });

  it("marks permanent rejections failed and skips them on automatic (non-forced) passes", async () => {
    await queueDraft(USER, { farmer_name: "A" }, "draft-1");
    (api.createSurveyDraft as any).mockRejectedValue(new ApiError("bad data", 422));
    const result = await syncDraftQueue(USER);
    expect(result.permanentlyFailed).toBe(1);
    (api.createSurveyDraft as any).mockClear();
    await syncDraftQueue(USER);
    expect(api.createSurveyDraft).not.toHaveBeenCalled();
  });

  it("respects backoff on a transient failure", async () => {
    await queueDraft(USER, { farmer_name: "A" }, "draft-1");
    (api.createSurveyDraft as any).mockRejectedValue(new ApiError("Network error", 0));
    await syncDraftQueue(USER);
    (api.createSurveyDraft as any).mockClear();
    const second = await syncDraftQueue(USER);
    expect(api.createSurveyDraft).not.toHaveBeenCalled();
    expect(second).toEqual({ synced: 0, failed: 0, permanentlyFailed: 0 });
  });

  it("ignoreBackoff retries immediately on reconnect — caught live: saveDraft() attempts a sync even while offline, which sets a backoff; the online event must not then wait it out", async () => {
    await queueDraft(USER, { farmer_name: "A" }, "draft-1");
    (api.createSurveyDraft as any).mockRejectedValue(new ApiError("Network error", 0));
    await syncDraftQueue(USER); // sets backoff, simulating saveDraft()'s own offline attempt
    (api.createSurveyDraft as any).mockClear();

    (api.createSurveyDraft as any).mockResolvedValue({ id: 1 });
    const result = await syncDraftQueue(USER, { ignoreBackoff: true });
    expect(api.createSurveyDraft).toHaveBeenCalledTimes(1);
    expect(result.synced).toBe(1);
  });

  it("ignoreBackoff does not resurrect an already-failed entry", async () => {
    await queueDraft(USER, { farmer_name: "A" }, "draft-1");
    (api.createSurveyDraft as any).mockRejectedValue(new ApiError("bad data", 422));
    await syncDraftQueue(USER);
    (api.createSurveyDraft as any).mockClear();
    const result = await syncDraftQueue(USER, { ignoreBackoff: true });
    expect(api.createSurveyDraft).not.toHaveBeenCalled();
    expect(result.permanentlyFailed).toBe(1);
  });
});

describe("findQueuedDraftBySurveyId", () => {
  it("finds a locally-queued offline edit by the server id it belongs to", async () => {
    await queueDraft(USER, { farmer_name: "A" }, "draft-1", 123);
    const found = await findQueuedDraftBySurveyId(USER, 123);
    expect(found?.clientUuid).toBe("draft-1");
    expect(await findQueuedDraftBySurveyId(USER, 999)).toBeUndefined();
  });
});

describe("clearIfUnchanged", () => {
  it("removes the entry once it's synced and nothing's changed since", async () => {
    await queueDraft(USER, { farmer_name: "A" }, "draft-1");
    await clearIfUnchanged(USER, "draft-1", { farmer_name: "A" });
    expect(await getQueuedDraft(USER, "draft-1")).toBeUndefined();
  });

  it("keeps the entry queued when the payload has changed since (the user kept typing)", async () => {
    await queueDraft(USER, { farmer_name: "A" }, "draft-1");
    await clearIfUnchanged(USER, "draft-1", { farmer_name: "B, typed after the sync kicked off" });
    expect(await getQueuedDraft(USER, "draft-1")).toBeDefined();
  });

  it("keeps a failed entry queued even if the payload matches — it needs the user's attention, not silent removal", async () => {
    await queueDraft(USER, { farmer_name: "A" }, "draft-1");
    (api.createSurveyDraft as any).mockRejectedValue(new ApiError("bad data", 422));
    await syncDraftQueue(USER);
    await clearIfUnchanged(USER, "draft-1", { farmer_name: "A" });
    expect(await getQueuedDraft(USER, "draft-1")).toBeDefined();
  });
});
