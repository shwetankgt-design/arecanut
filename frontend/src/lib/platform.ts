import { Capacitor } from "@capacitor/core";

// The Android app is the same React build running in a Capacitor WebView. Some functionality is web-only until
// the owner asks for it on mobile. To ship one of these features in the APK, add its name to MOBILE_ENABLED
// (nothing else changes), then rebuild.
//   dashboard : Programme Dashboard (home page)
//   admin     : User Management, Master Data, Catalog, and admin-only record actions (assign, delete, user filter)
//   mis       : MIS reports & dashboards (MIS User role)
//   client    : Client Dashboard and Farmer Records (Client User role)
// (Freeze / unfreeze is already web-only — see FarmerList / SurveyView.)
export type Feature = "dashboard" | "admin" | "mis" | "client";
export const MOBILE_ENABLED: Feature[] = [];

export const IS_MOBILE_APP = Capacitor.isNativePlatform();

/** True when `feature` should be available on this platform (always on the web; opt-in on the mobile app). */
export const featureOn = (feature: Feature): boolean => !IS_MOBILE_APP || MOBILE_ENABLED.includes(feature);
