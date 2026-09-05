import { readKey, removeKey, writeKey } from '../storage/local.ts';
import type { OpKind, Operation } from './operationQueue.ts';

const KEY = 'activeBatch';

export interface PersistedBatch {
  kind: OpKind;
  startedAt: number;
  ops: Operation[];
}

/** Returns false when storage is unavailable, so the caller can say so instead of crashing. */
export const saveBatch = (b: PersistedBatch): Promise<boolean> => writeKey(KEY, b);

export const clearBatch = (): Promise<boolean> => removeKey(KEY);

/**
 * Reads back an interrupted batch, or null if there is nothing usable to resume.
 *
 * Any operation caught mid-flight is reset to `queued`: when the tab died we could not know
 * whether the write landed. Re-issuing it is safe precisely because both actions are
 * idempotent — a second archive is a no-op, and deleting an already-deleted conversation comes
 * back as `conversation_deleted`, which the queue counts as success. `done` and `failed` are
 * left alone, so a completed destructive action is never replayed.
 */
export async function loadBatch(): Promise<PersistedBatch | null> {
  const raw = await readKey<PersistedBatch>(KEY);
  if (!raw || (raw.kind !== 'archive' && raw.kind !== 'remove') || !Array.isArray(raw.ops)) {
    return null;
  }
  const ops = raw.ops.filter(
    (o): o is Operation => typeof o?.id === 'string' && typeof o?.attempts === 'number',
  );
  if (!ops.length) return null;
  for (const op of ops) {
    if (op.state !== 'done' && op.state !== 'failed') {
      op.state = 'queued';
      op.attempts = 0; // a fresh budget of retries for the interrupted attempt
    }
  }
  return { kind: raw.kind, startedAt: raw.startedAt ?? 0, ops };
}
