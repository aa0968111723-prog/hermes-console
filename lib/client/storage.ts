// Browser storage is optional, never the source of truth for conversations.
export function readPreference(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private browsing / storage policies must not prevent using the workspace.
  }
}

export function removeLegacyPreference(key: string) {
  writePreference(key, null);
  try {
    sessionStorage.removeItem(key);
  } catch {}
}
