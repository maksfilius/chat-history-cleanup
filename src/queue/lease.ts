import { readKey, removeKey, writeKey } from '../storage/local.ts';

/**
 * A single-writer lease over destructive work.
 *
 * ChatGPT in two tabs is ordinary, and each tab runs its own panel over the same
 * `chrome.storage.local`. Without this, two panels can run the same restored batch, overwrite
 * each other's progress, and send the same delete twice.
 *
 * `chrome.storage.local` has no compare-and-swap, so acquisition is write-then-read-back: a
 * loser sees the winner's id and stands down. The window between the two is small and both
 * writers are the same extension, so the worst case is that both back off and the user retries.
 * A stale lease expires, so a crashed tab cannot block cleanup forever.
 */
const KEY = 'batchLease';

/** Long enough to outlive a slow request (~1.2 s each), short enough not to strand the user. */
export const LEASE_TTL_MS = 30_000;
/** Renewed well inside the TTL so an active batch never looks abandoned. */
export const HEARTBEAT_MS = 10_000;

export interface Lease {
  owner: string;
  renewedAt: number;
}

const isLease = (v: unknown): v is Lease =>
  !!v && typeof v === 'object' &&
  typeof (v as Lease).owner === 'string' && (v as Lease).owner.length > 0 &&
  Number.isSafeInteger((v as Lease).renewedAt);

export const newOwnerId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** The current holder, or null when the lease is absent, malformed or expired. */
export async function currentHolder(now = Date.now()): Promise<string | null> {
  const lease = await readKey<unknown>(KEY);
  if (!isLease(lease)) return null;
  return now - lease.renewedAt < LEASE_TTL_MS ? lease.owner : null;
}

/**
 * Takes the lease unless another live owner holds it. Reads back to catch a racing writer:
 * last write wins in storage, so the loser must notice it lost.
 */
export async function acquireLease(owner: string, now = Date.now()): Promise<boolean> {
  const holder = await currentHolder(now);
  if (holder !== null && holder !== owner) return false;
  if (!(await writeKey(KEY, { owner, renewedAt: now }))) return false;
  const readBack = await readKey<unknown>(KEY);
  return isLease(readBack) && readBack.owner === owner;
}

/** Keeps a running batch's claim alive; false means the lease was lost and work must stop. */
export async function renewLease(owner: string, now = Date.now()): Promise<boolean> {
  const holder = await currentHolder(now);
  if (holder !== null && holder !== owner) return false;
  return writeKey(KEY, { owner, renewedAt: now });
}

/** Releases only our own lease, never someone else's. */
export async function releaseLease(owner: string): Promise<void> {
  const lease = await readKey<unknown>(KEY);
  if (isLease(lease) && lease.owner === owner) await removeKey(KEY);
}
