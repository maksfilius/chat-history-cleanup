import { asApiError, type VerifyResult } from '../chatgpt/api.ts';
import type { ConversationAdapter } from '../types/conversation.ts';
import { isConversationId } from '../types/identifiers.ts';

export type OpKind = 'archive' | 'remove';
export type OpState = 'queued' | 'running' | 'retry_wait' | 'done' | 'failed';

export interface Operation {
  readonly id: string;
  readonly title: string;
  readonly kind: OpKind;
  state: OpState;
  attempts: number;
  /** Why it failed, in words a user can act on. */
  error?: string;
}

export interface QueueDeps {
  adapter: ConversationAdapter;
  verify: (id: string) => Promise<VerifyResult>;
  /** Injected so tests do not actually wait out the backoff. */
  sleep?: (ms: number) => Promise<void>;
  onChange?: (ops: readonly Operation[]) => void;
  /** Called once per conversation that is confirmed gone/archived, to update the sidebar. */
  onSettled?: (id: string, kind: OpKind) => void;
}

export const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 1000;

/** Validate the whole batch; never salvage selected jobs from an ambiguous record. */
export function validOperations(value: unknown, kind: unknown): value is Operation[] {
  if ((kind !== 'archive' && kind !== 'remove') || !Array.isArray(value)) return false;
  const seen = new Set<string>();
  return value.every((op: unknown) => {
    if (!op || typeof op !== 'object') return false;
    const o = op as Record<string, unknown>;
    if (!isConversationId(o.id) || seen.has(o.id) || o.kind !== kind || typeof o.title !== 'string' ||
      typeof o.state !== 'string' || !['queued', 'running', 'retry_wait', 'done', 'failed'].includes(o.state) ||
      !Number.isSafeInteger(o.attempts) || (o.attempts as number) < 0 || (o.attempts as number) > MAX_ATTEMPTS ||
      (o.error !== undefined && typeof o.error !== 'string')) return false;
    if ((o.state === 'running' || o.state === 'retry_wait') && o.attempts === 0) return false;
    if (o.state === 'retry_wait' && o.attempts === MAX_ATTEMPTS) return false;
    seen.add(o.id);
    return true;
  });
}

/** Exponential backoff with jitter, so a rate limit does not resync every retry. */
export const backoffMs = (attempt: number, rand = Math.random) =>
  Math.round(BASE_BACKOFF_MS * 2 ** (attempt - 1) * (0.75 + rand() * 0.5));

/**
 * Sequential (concurrency 1) queue for destructive work.
 *
 * Two rules it exists to enforce:
 *  - every action is confirmed against the detail endpoint, never against the listing, which
 *    lags writes badly (see docs/chatgpt-integration.md);
 *  - a confirmed already-deleted result satisfies a delete, but never an archive.
 *
 * RELEASE BLOCKER: write/verify retry and reload recovery can still resend completed writes.
 * The bounded audit fixes validate identities, not durable exactly-once execution (audit F04).
 */
export class OperationQueue {
  private operations: Operation[];
  /** Detached snapshots prevent UI/persistence callbacks from changing live target identities. */
  get ops(): Operation[] {
    return this.operations.map((op) => Object.freeze({ ...op }));
  }
  readonly kind: OpKind;
  /** Set when the batch halted itself rather than being stopped by the user. */
  haltedBy: 'rate-limit' | 'signed-out' | null = null;
  private deps: QueueDeps;
  private stopped = false;
  private running = false;

  constructor(items: { id: string; title: string }[], kind: OpKind, deps: QueueDeps) {
    this.kind = kind;
    this.deps = deps;
    this.operations = items.map((i) => ({ id: i.id, title: i.title, kind, state: 'queued', attempts: 0 }));
    if (!validOperations(this.operations, kind)) throw new Error('Invalid or duplicate queue targets');
  }

  /** Rebuilds a queue from a persisted batch, keeping what already settled. */
  static restore(kind: OpKind, ops: Operation[], deps: QueueDeps): OperationQueue {
    const q = new OperationQueue([], kind, deps);
    if (!validOperations(ops, kind)) throw new Error('Invalid saved queue');
    q.operations.push(...ops.map((op) => ({ ...op })));
    return q;
  }

  /** Clears the stop flag so a paused batch can continue where it left off. */
  resume() {
    this.stopped = false;
    this.haltedBy = null;
  }

  get pending() {
    return this.operations.filter((o) => o.state !== 'done' && o.state !== 'failed').length;
  }
  get done() {
    return this.operations.filter((o) => o.state === 'done').length;
  }
  get failed() {
    return this.ops.filter((o) => o.state === 'failed');
  }

  /** Finishes the in-flight operation, then stops. Never leaves an op half-applied. */
  stop() {
    this.stopped = true;
  }

  /**
   * Halts the whole batch and puts the current operation back in the queue.
   *
   * A rate limit is a property of the account, not of one conversation: retrying the next
   * conversation would hit the same wall. Without this, one rate-limit episode marches through
   * the batch failing every remaining item. Instead we stop, keep everything resumable, and
   * let the user come back in a few minutes.
   */
  private halt(op: Operation, reason: 'rate-limit' | 'signed-out') {
    op.state = 'queued';
    op.attempts = 0;
    this.haltedBy = reason;
    this.stopped = true;
    this.emit();
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const op of this.operations) {
        if (this.stopped) return;
        if (op.state === 'done' || op.state === 'failed') continue; // resume-safe
        await this.runOne(op);
      }
    } finally {
      this.running = false;
    }
  }

  private emit() {
    this.deps.onChange?.(this.ops);
  }

  private async runOne(op: Operation): Promise<void> {
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

    while (op.attempts < MAX_ATTEMPTS) {
      op.attempts++;
      op.state = 'running';
      this.emit();

      try {
        const act = op.kind === 'archive' ? this.deps.adapter.archive : this.deps.adapter.remove;
        await act.call(this.deps.adapter, op.id);
      } catch (err) {
        const e = asApiError(err);
        // Only the exact deleted error satisfies deletion. It cannot prove an archive.
        if (e.status === 404 && e.code === 'conversation_deleted') {
          return op.kind === 'remove' ? this.settle(op, 'done')
            : this.settle(op, 'failed', 'conversation was deleted; it was not archived');
        }
        // Signed out: every following operation would fail the same way.
        if (e.status === 401 || e.status === 403) return this.halt(op, 'signed-out');
        if (!e.transient) {
          return this.settle(op, 'failed', describe(e.status, e.code));
        }
        if (op.attempts >= MAX_ATTEMPTS) {
          // Still limited after the full backoff ladder — this is not a blip.
          if (e.status === 429) return this.halt(op, 'rate-limit');
          return this.settle(op, 'failed', describe(e.status, e.code));
        }
        op.state = 'retry_wait';
        this.emit();
        await sleep(backoffMs(op.attempts));
        continue;
      }

      // The write returned 2xx. Trust nothing until the detail endpoint agrees.
      // Typed as VerifyResult rather than inferred: `as const` here pinned `code` to the
      // literal 0, which makes `v.code === 429` look like a comparison that can never be true.
      const fallback: VerifyResult = { state: 'error', code: 0 };
      const v: VerifyResult = await this.deps.verify(op.id).catch(() => fallback);
      if (settledOk(op.kind, v)) return this.settle(op, 'done');

      // The read-back failed for an account-level reason, not a per-conversation one. Retrying
      // here would re-issue a destructive action we already sent, four times over, and then
      // fail every remaining conversation against the same wall. Halt instead: the batch stays
      // resumable, but the current resume path still reissues the action (audit F04).
      if (v.state === 'error' && (v.code === 429 || v.code === 401 || v.code === 403)) {
        return this.halt(op, v.code === 429 ? 'rate-limit' : 'signed-out');
      }

      if ((v.state === 'error' && v.code >= 400 && v.code < 500) ||
        v.state === 'missing' || (op.kind === 'archive' && v.state === 'deleted')) {
        return this.settle(op, 'failed', unconfirmed(op.kind, v));
      }

      if (op.attempts >= MAX_ATTEMPTS) {
        return this.settle(op, 'failed', unconfirmed(op.kind, v));
      }
      op.state = 'retry_wait';
      this.emit();
      await sleep(backoffMs(op.attempts));
    }
  }

  private settle(op: Operation, state: 'done' | 'failed', error?: string) {
    op.state = state;
    op.error = error;
    if (state === 'done') this.deps.onSettled?.(op.id, op.kind);
    this.emit();
  }
}

/** Did the read-back actually confirm what we asked for? */
export function settledOk(kind: OpKind, v: VerifyResult): boolean {
  if (kind === 'remove') return v.state === 'deleted';
  return v.state === 'present' && v.archived === true;
}

function unconfirmed(kind: OpKind, v: VerifyResult): string {
  if (kind === 'archive' && v.state === 'deleted') return 'conversation was deleted; it was not archived';
  if (v.state === 'missing') return 'conversation not found';
  if (v.state === 'error') return `could not confirm (${v.code})`;
  return `${kind} did not take effect`;
}

function describe(status: number, code?: string): string {
  if (code === 'conversation_not_found') return 'conversation no longer exists';
  if (status === 401 || status === 403) return 'signed out — reload ChatGPT';
  if (status === 429) return 'rate limited, gave up after retries';
  if (status === 0) return 'network error';
  return `HTTP ${status}`;
}
