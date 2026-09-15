// Loads the Google Maps JavaScript API script once, on demand. Works the
// same whether the page is a plain browser tab or the WebView inside the
// Capacitor Android app — no platform split needed for a <script> loader.

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

export function isGoogleMapsConfigured(): boolean {
  return !!API_KEY;
}

let loadPromise: Promise<void> | null = null;

export function loadGoogleMaps(): Promise<void> {
  if (!API_KEY) {
    return Promise.reject(new Error("Google Maps API key is not configured (VITE_GOOGLE_MAPS_API_KEY)."));
  }
  if ((window as any).google?.maps) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const callbackName = "__gtArecanutGoogleMapsReady";
    (window as any)[callbackName] = () => {
      delete (window as any)[callbackName];
      resolve();
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(API_KEY)}&libraries=geometry&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Failed to load Google Maps — check the API key, billing status, and that the Maps JavaScript API is enabled for this key's project."));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}
