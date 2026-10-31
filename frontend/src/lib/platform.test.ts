import { describe, it, expect, vi, beforeEach } from "vitest";

// Web-only features must be closed on the mobile app unless explicitly listed in MOBILE_ENABLED.
describe("platform feature flags", () => {
  beforeEach(() => vi.resetModules());

  it("keeps every feature on for the web", async () => {
    vi.doMock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
    const p = await import("./platform");
    for (const f of ["dashboard", "admin", "mis", "client"] as const) expect(p.featureOn(f)).toBe(true);
  });

  it("closes dashboard, admin, MIS and client on the mobile app by default", async () => {
    vi.doMock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
    const p = await import("./platform");
    expect(p.MOBILE_ENABLED).toEqual([]);
    for (const f of ["dashboard", "admin", "mis", "client"] as const) expect(p.featureOn(f)).toBe(false);
  });
});
