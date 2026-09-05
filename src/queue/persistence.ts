import { readKey, removeKey, writeKey } from '../storage/local.ts';
import type { OpKind, Operation } from './operationQueue.ts';
import { MAX_ATTEMPTS, validOperations } from './operationQueue.ts';

const KEY = 'activeBatch';

export interface PersistedBatch {
  kind: OpKind;
  startedAt: number;
  ops: Operation[];
}

/**
 * Version 2 records carry a `dispatched` state, which version 1 could not express: it recorded
 * `running` both for "write sent" and for "write failed, waiting to retry". No destructive
 * migration — a v1 record is read, but every ambiguous operation in it is treated as dispatched
 * and reconciled by reading.
 */
export const CURRENT_VERSION = 2;

export const saveBatch = (b: PersistedBatch): Promise<boolean> => {
  if (!validOperations(b.ops, b.kind) || !Number.isSafeInteger(b.startedAt) || b.startedAt <= 0) {
    return Promise.resolve(false);
  }
  return writeKey(KEY, { ...b, version: CURRENT_VERSION });
};

export const clearBatch = (): Promise<boolean> => removeKey(KEY);

/**
 * Reads back an interrupted batch, or null if there is nothing usable to resume.
 *
 * Nothing here is promoted to "safe to send again". An operation that may already have been
 * written is returned as `dispatched`, which the queue resolves by reading the conversation
 * rather than writing to it. `done` and `failed` are left untouched.
 */
export async function loadBatch(): Promise<PersistedBatch | null> {
  const value = await readKey<unknown>(KEY);
  if (value === undefined) return null;
  if (!value || typeof value !== 'object') throw new Error('Invalid saved batch; cleanup stopped');
  const raw = value as Record<string, unknown>;
  if ((raw.version !== 1 && raw.version !== CURRENT_VERSION) || !validOperations(raw.ops, raw.kind) ||
    !Number.isSafeInteger(raw.startedAt) || (raw.startedAt as number) <= 0) {
    throw new Error('Invalid or unsupported saved batch; cleanup stopped. Do not resume this record.');
  }
  const ops = raw.ops.map((op) => ({ ...op }));
  if (!ops.length) return null;
  for (const op of ops) {
    if (op.state === 'done' || op.state === 'failed') continue;
    if (op.state === 'queued') continue; // never sent; safe to send now
    // Anything caught mid-flight may already have been applied. In a v1 record `retry_wait` is
    // ambiguous too — it was set after a failed write AND after a failed read-back — so both
    // resolve by reading, which is always safe, rather than by writing, which may repeat.
    op.state = 'dispatched';
    op.attempts = Math.max(1, Math.min(op.attempts, MAX_ATTEMPTS - 1));
  }
  return { kind: raw.kind as OpKind, startedAt: raw.startedAt as number, ops };
}

export interface RestorePoint {
  /** A batch that validated and may be offered for resume. */
  batch: PersistedBatch | null;
  /** Why a stored record was refused, when one was. */
  invalid: string | null;
}

/**
 * Never rejects. A stored batch we refuse to trust must not take down the caller's whole
 * startup: the record is unusable, but listing and cleaning are not, and a user cannot reach
 * chrome.storage to clear it. Refusing the record and refusing to work are different answers.
 */
export async function loadRestorePoint(): Promise<RestorePoint> {
  try {
    return { batch: await loadBatch(), invalid: null };
  } catch (err) {
    return { batch: null, invalid: String((err as Error)?.message ?? err) };
  }
}
