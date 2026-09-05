import { readKey, removeKey, writeKey } from '../storage/local.ts';
import type { OpKind, Operation } from './operationQueue.ts';
import { validOperations } from './operationQueue.ts';

const KEY = 'activeBatch';

export interface PersistedBatch {
  kind: OpKind;
  startedAt: number;
  ops: Operation[];
}

/** Version 1 rejects legacy ambiguous records. No automatic destructive migration. */
export const saveBatch = (b: PersistedBatch): Promise<boolean> => {
  if (!validOperations(b.ops, b.kind) || !Number.isSafeInteger(b.startedAt) || b.startedAt <= 0) {
    return Promise.resolve(false);
  }
  return writeKey(KEY, { ...b, version: 1 });
};

export const clearBatch = (): Promise<boolean> => removeKey(KEY);

/**
 * Reads back an interrupted batch, or null if there is nothing usable to resume.
 *
 * KNOWN RELEASE BLOCKER (audit F04): interrupted work is still reset to queued and replayed.
 * A server-completed write may not yet have a persisted done state. Server idempotence is
 * not proof of no replay. Recovery needs durable dispatch intent and read reconciliation.
 * Only operations already persisted as done/failed are skipped reliably in this function.
 */
export async function loadBatch(): Promise<PersistedBatch | null> {
  const value = await readKey<unknown>(KEY);
  if (value === undefined) return null;
  if (!value || typeof value !== 'object') throw new Error('Invalid saved batch; cleanup stopped');
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || !validOperations(raw.ops, raw.kind) ||
    !Number.isSafeInteger(raw.startedAt) || (raw.startedAt as number) <= 0) {
    throw new Error('Invalid or unsupported saved batch; cleanup stopped. Do not resume this record.');
  }
  const ops = raw.ops.map((op) => ({ ...op }));
  if (!ops.length) return null;
  for (const op of ops) {
    if (op.state !== 'done' && op.state !== 'failed') {
      op.state = 'queued';
      op.attempts = 0; // a fresh budget of retries for the interrupted attempt
    }
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
