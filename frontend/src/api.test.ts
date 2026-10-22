import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError, isPermanentError, api } from "./api";

describe("isPermanentError", () => {
  it("treats a non-ApiError as not permanent — safest default for an error shape we don't recognize", () => {
    expect(isPermanentError(new Error("boom"))).toBe(false);
    expect(isPermanentError("not an error")).toBe(false);
    expect(isPermanentError(undefined)).toBe(false);
  });

  it.each([400, 403, 404, 409, 422])("treats a %i rejection as permanent (retrying the same request won't help)", (status) => {
    expect(isPermanentError(new ApiError("x", status))).toBe(true);
  });

  it.each([0, 401, 408, 429, 500, 502, 503])("treats status %i as transient (worth retrying)", (status) => {
    expect(isPermanentError(new ApiError("x", status))).toBe(false);
  });
});

describe("error message formatting", () => {
  const originalFetch = globalThis.fetch;
  // These tests run without a DOM environment (vitest.config.ts keeps it to
  // pure logic), so stub the storage api.ts reads the bearer token from.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
  });
  afterEach(() => { globalThis.fetch = originalFetch; vi.unstubAllGlobals(); });

  function mockJsonResponse(status: number, body: unknown) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: async () => body,
    }) as any;
  }

  it("renders a FastAPI 422 validation array as readable field errors, not [object Object]", async () => {
    // Caught on-device: this exact shape produced
    // "[object Object],[object Object],…" in the sync queue's error column.
    mockJsonResponse(422, {
      detail: [
        { type: "missing", loc: ["body", "age"], msg: "Field required" },
        { type: "missing", loc: ["body", "mobile_no"], msg: "Field required" },
      ],
    });
    const err = await api.createSurvey({}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("age: Field required; mobile_no: Field required");
    expect(err.message).not.toContain("[object Object]");
  });

  it("truncates a long validation list with a count rather than dumping all of it", async () => {
    mockJsonResponse(422, {
      detail: Array.from({ length: 20 }, (_, i) => ({ loc: ["body", `field${i}`], msg: "Field required" })),
    });
    const err = await api.createSurvey({}).catch((e) => e);
    expect(err.message).toContain("field0: Field required");
    expect(err.message).toContain("(and 17 more)");
  });

  it("passes a plain string detail through unchanged", async () => {
    mockJsonResponse(403, { detail: "Missing permission: farmer_records" });
    const err = await api.createSurvey({}).catch((e) => e);
    expect(err.message).toBe("Missing permission: farmer_records");
  });

  it("falls back to the status code when there's no usable detail", async () => {
    mockJsonResponse(500, {});
    const err = await api.createSurvey({}).catch((e) => e);
    expect(err.message).toBe("Request failed: 500");
  });
});
