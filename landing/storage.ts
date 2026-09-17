/** Demo-only replacement for chrome.storage.local. Never touches extension storage. */
const PREFIX = 'chat-cleanup-demo-v2:';
const memory = new Map<string, unknown>();

export const extensionAlive = (): boolean => true;

export async function readKey<T>(key: string): Promise<T | undefined> {
  try {
    const value = sessionStorage.getItem(PREFIX + key);
    if (value !== null) return JSON.parse(value) as T;
  } catch { /* Private/file browsing can refuse storage; the in-memory demo still works. */ }
  return structuredClone(memory.get(key)) as T | undefined;
}

export async function readKeyState<T>(key: string): Promise<{ ok: boolean; value?: T }> {
  return { ok: true, value: await readKey<T>(key) };
}

export async function writeKey(key: string, value: unknown): Promise<boolean> {
  memory.set(key, structuredClone(value));
  try { sessionStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* In-memory fallback. */ }
  window.dispatchEvent(new CustomEvent('demo:storage', { detail: { key, value } }));
  return true;
}

export async function removeKey(key: string): Promise<boolean> {
  memory.delete(key);
  try { sessionStorage.removeItem(PREFIX + key); } catch { /* In-memory fallback. */ }
  window.dispatchEvent(new CustomEvent('demo:storage', { detail: { key } }));
  return true;
}

export function onKeyChange<T>(key: string, listener: (value: T | undefined) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ key: string; value?: unknown }>).detail;
    if (detail?.key === key) listener(detail.value as T | undefined);
  };
  window.addEventListener('demo:storage', handler);
  return () => window.removeEventListener('demo:storage', handler);
}

export function resetStorage() {
  memory.clear();
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX)) sessionStorage.removeItem(key);
  } catch { /* In-memory fallback. */ }
}
