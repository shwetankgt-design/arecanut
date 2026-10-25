import { Capacitor } from "@capacitor/core";
import { Device } from "@capacitor/device";

const KEY = "gt_device_id";
let cached: string | null = null;

// Native app: the real device id ("android:<id>"). Browser: a random id kept
// in localStorage; the server appends the caller's IP ("web:<id>|<ip>").
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    if (Capacitor.isNativePlatform()) {
      const { identifier } = await Device.getId();
      cached = `android:${identifier}`;
      return cached;
    }
  } catch {
    // fall through to the browser-style id
  }
  let id: string | null = null;
  try { id = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  if (!id) {
    id = crypto.randomUUID();
    try { localStorage.setItem(KEY, id); } catch { /* storage blocked */ }
  }
  cached = `web:${id}`;
  return cached;
}
