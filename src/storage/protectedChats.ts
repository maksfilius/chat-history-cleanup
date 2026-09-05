import { readKey, writeKey } from './local.ts';

/** Manually protected conversation ids, persisted locally. Nothing leaves the browser. */
const KEY = 'protectedChats';

export async function loadProtected(): Promise<Set<string>> {
  const stored = await readKey<unknown>(KEY);
  return new Set(Array.isArray(stored) ? (stored as string[]) : []);
}

/**
 * Toggles are serialized: each is a read-modify-write, and two overlapping ones would each read
 * the pre-change set and the later write would silently drop the earlier id. Losing a
 * protection the user deliberately set is exactly the kind of silent failure this product
 * cannot afford, so the writes queue behind one another.
 */
let writes: Promise<unknown> = Promise.resolve();

/** Returns the new set plus whether it actually reached storage. */
export function setProtected(
  id: string,
  on: boolean,
): Promise<{ ids: Set<string>; saved: boolean }> {
  const next = writes.then(async () => {
    const ids = await loadProtected();
    on ? ids.add(id) : ids.delete(id);
    return { ids, saved: await writeKey(KEY, [...ids]) };
  });
  writes = next.catch(() => {});
  return next;
}
