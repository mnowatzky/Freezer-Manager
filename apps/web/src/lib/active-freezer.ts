import { useCallback, useState } from "react";

const KEY = "activeFreezerId";
const LAST_DRAWER_KEY = "lastDrawer";
const LAST_DRAWER_TTL_MS = 60_000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode) – preference just isn't remembered.
  }
}

/** Remembers which freezer the user last looked at; falls back to the first one. */
export function useActiveFreezer(freezerIds: readonly string[]) {
  const [stored, setStored] = useState(() => read(KEY));
  const active = stored && freezerIds.includes(stored) ? stored : (freezerIds[0] ?? null);
  const setActive = useCallback((id: string) => {
    write(KEY, id);
    setStored(id);
  }, []);
  return [active, setActive] as const;
}

/** The drawer of the last "Einfrieren" is pre-selected only if that was under a minute ago. */
export function rememberDrawer(drawerId: string) {
  write(LAST_DRAWER_KEY, JSON.stringify({ drawerId, at: Date.now() }));
}

export function recentDrawer(): string | null {
  try {
    const { drawerId, at } = JSON.parse(read(LAST_DRAWER_KEY) ?? "null") ?? {};
    return typeof drawerId === "string" && Date.now() - at < LAST_DRAWER_TTL_MS ? drawerId : null;
  } catch {
    return null;
  }
}
