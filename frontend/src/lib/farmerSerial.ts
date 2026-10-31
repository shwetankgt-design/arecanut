// On screen a farmer is shown as DSA/KA/<serial no.>, e.g. stored "NCCF/KA/0067" -> "DSA/KA/0067".
// The stored id (and every lookup / link) is unchanged; only the display is derived from its serial number.
export const DISPLAY_PREFIX = "DSA/KA/";

export function serialNo(farmerId: string | null | undefined): string {
  if (!farmerId) return "";
  const m = /(\d+)\s*$/.exec(farmerId);
  return m && farmerId.includes("/") ? DISPLAY_PREFIX + m[1] : farmerId;
}
