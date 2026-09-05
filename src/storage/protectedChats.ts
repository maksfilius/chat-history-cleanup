import { readKey, writeKey } from './local.ts';

/** Manually protected conversation ids, persisted locally. Nothing leaves the browser. */
const KEY = 'protectedChats';

export async function loadProtected(): Promise<Set<string>> {
  const stored = await readKey<unknown>(KEY);
  return new Set(Array.isArray(stored) ? (stored as string[]) : []);
}

/** Returns the new set plus whether it actually reached storage. */
export async function setProtected(
  id: string,
  on: boolean,
): Promise<{ ids: Set<string>; saved: boolean }> {
  const ids = await loadProtected();
  on ? ids.add(id) : ids.delete(id);
  return { ids, saved: await writeKey(KEY, [...ids]) };
}
