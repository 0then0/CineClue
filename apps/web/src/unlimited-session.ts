export type UnlimitedSession = { id: string; pack: string };
const key = "cineclue:unlimited:v1";

export function readUnlimitedSession(): UnlimitedSession | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (
      value &&
      typeof value === "object" &&
      "id" in value &&
      typeof value.id === "string" &&
      value.id.length > 0 &&
      "pack" in value &&
      typeof value.pack === "string"
    )
      return { id: value.id, pack: value.pack };
  } catch {
    // Games still work in memory when browser storage is unavailable.
  }
  return null;
}
export function saveUnlimitedSession(value: UnlimitedSession | null) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {
    // The App keeps an in-memory copy for navigation in this tab.
  }
}
