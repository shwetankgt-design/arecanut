import { OpenPanel } from "@openpanel/web";

// Product/usage analytics only — never pass farmer names, phone numbers,
// survey answers, or GPS coordinates as event properties. This tracks how
// staff use the app (screens, feature choices, sync outcomes), not the
// sensitive agricultural data the app collects.
const clientId = import.meta.env.VITE_OPENPANEL_CLIENT_ID;

export const analytics = new OpenPanel({
  clientId: clientId || "disabled",
  disabled: !clientId,
  trackScreenViews: true,
  trackOutgoingLinks: true,
});

export function identifyUser(username: string, role: string) {
  analytics.identify({ profileId: username, properties: { role } });
}

export function resetIdentity() {
  analytics.clear();
}
