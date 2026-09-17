/**
 * `chrome.storage.local` access that cannot throw.
 *
 * When the extension is reloaded or auto-updates, the content script already running in an
 * open tab is orphaned. Every `chrome.*` call then fails with "Extension context invalidated"
 * — and it fails **synchronously**, so a `.catch()` on the returned promise never runs and the
 * error escapes as an unhandled rejection. This happens to real users on auto-update, not only
 * during development, so storage has to degrade quietly instead of exploding.
 *
 * Reads return undefined, writes return false. Callers decide what to tell the user.
 */
export function extensionAlive(): boolean {
  try {
    // chrome.runtime.id is undefined the moment the context is invalidated.
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

export async function readKey<T>(key: string): Promise<T | undefined> {
  const result = await readKeyState<T>(key);
  return result.value;
}

/** Distinguishes a missing key from an unavailable storage backend. */
export async function readKeyState<T>(key: string): Promise<{
  ok: boolean;
  value?: T;
}> {
  if (!extensionAlive()) return { ok: false };
  try {
    return { ok: true, value: (await chrome.storage.local.get(key))[key] as T | undefined };
  } catch {
    return { ok: false };
  }
}

export async function writeKey(key: string, value: unknown): Promise<boolean> {
  if (!extensionAlive()) return false;
  try {
    await chrome.storage.local.set({ [key]: value });
    return true;
  } catch {
    return false;
  }
}

export async function removeKey(key: string): Promise<boolean> {
  if (!extensionAlive()) return false;
  try {
    await chrome.storage.local.remove(key);
    return true;
  } catch {
    return false;
  }
}

/** Observe one local key across extension contexts. Returns a safe unsubscribe function. */
export function onKeyChange<T>(key: string, listener: (value: T | undefined) => void): () => void {
  if (!extensionAlive()) return () => {};
  const handler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName === 'local' && key in changes) listener(changes[key].newValue as T | undefined);
  };
  try {
    chrome.storage.onChanged.addListener(handler);
    return () => {
      try { chrome.storage.onChanged.removeListener(handler); } catch { /* orphaned context */ }
    };
  } catch {
    return () => {};
  }
}
