import { readKeyState, writeKey } from './local.ts';

/** Manually protected conversation ids, persisted locally. Nothing leaves the browser. */
const KEY = 'protectedChats';

export async function loadProtected(): Promise<Set<string>> {
  const stored = await readKeyState<unknown>(KEY);
  if (!stored.ok) throw new Error('Local protection storage is unavailable');
  if (stored.value === undefined) return new Set();
  if (!Array.isArray(stored.value) || stored.value.some((id) => typeof id !== 'string')) {
    throw new Error('Local protection storage is invalid');
  }
  return new Set(stored.value);
}

/**
 * Toggles are serialized: each is a read-modify-write, and two overlapping ones would each read
 * the pre-change set and the later write would silently drop the earlier id. Losing a
 * protection the user deliberately set is exactly the kind of silent failure this product
 * cannot afford, so the writes queue behind one another.
 */
let writes: Promise<unknown> = Promise.resolve();
const LOCK = 'chat-cleanup-protected-chats-v1';

async function updateProtected(id: string, on: boolean) {
  const ids = await loadProtected();
  on ? ids.add(id) : ids.delete(id);
  return { ids, saved: await writeKey(KEY, [...ids]) };
}

/** Returns the new set plus whether it actually reached storage. */
export function setProtected(
  id: string,
  on: boolean,
): Promise<{ ids: Set<string>; saved: boolean }> {
  const next = writes.then(async () => {
    // Each content-script tab has a separate module instance. This lock makes the
    // read-modify-write atomic across tabs as well as ordered within this one.
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request(
        LOCK,
        { mode: 'exclusive' },
        () => updateProtected(id, on),
      );
    }
    return updateProtected(id, on);
  });
  writes = next.catch(() => {});
  return next;
}
