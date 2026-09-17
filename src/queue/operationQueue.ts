import { asApiError, type VerifyResult } from '../chatgpt/api.ts';
import type { ConversationAdapter } from '../types/conversation.ts';
import { isConversationId } from '../types/identifiers.ts';

export type OpKind = 'archive' | 'remove';
/**
 * `dispatched` is the durable record that a destructive write LEFT THIS MACHINE and its outcome
 * is not yet known. It is what makes recovery safe: a dispatched operation is reconciled by
 * reading, never by writing again.
 */
export type OpState = 'queued' | 'dispatched' | 'running' | 'retry_wait' | 'done' | 'failed';

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
  /** Includes both the write and its read-back. Never allow an unbounded request burst. */
  concurrency?: 1 | 2;
  /**
   * Must durably record the current operations before the queue sends a destructive write.
   * Returning false stops the batch: work whose intent cannot be recorded cannot be recovered,
   * and continuing would risk repeating it.
   */
  persist?: (ops: readonly Operation[]) => Promise<boolean>;
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
      typeof o.state !== 'string' ||
      !['queued', 'dispatched', 'running', 'retry_wait', 'done', 'failed'].includes(o.state) ||
      !Number.isSafeInteger(o.attempts) || (o.attempts as number) < 0 || (o.attempts as number) > MAX_ATTEMPTS ||
      (o.error !== undefined && typeof o.error !== 'string')) return false;
    if ((o.state === 'running' || o.state === 'retry_wait' || o.state === 'dispatched') &&
      o.attempts === 0) return false;
    if (o.state === 'retry_wait' && o.attempts === MAX_ATTEMPTS) return false;
    seen.add(o.id);
    return true;
  });
}

/** Exponential backoff with jitter, so a rate limit does not resync every retry. */
export const backoffMs = (attempt: number, rand = Math.random) =>
  Math.round(BASE_BACKOFF_MS * 2 ** (attempt - 1) * (0.75 + rand() * 0.5));

/**
 * Bounded queue for destructive work (sequential unless explicitly set to two).
 *
 * Two rules it exists to enforce:
 *  - every action is confirmed against the detail endpoint, never against the listing, which
 *    lags writes badly (see docs/chatgpt-integration.md);
 *  - a confirmed already-deleted result satisfies a delete, but never an archive.
 *
 * Dispatch intents and settled results are saved in order. Recovery reads ambiguous outcomes
 * before considering another write.
 */
export class OperationQueue {
  private operations: Operation[];
  /** Detached snapshots prevent UI/persistence callbacks from changing live target identities. */
  get ops(): Operation[] {
    return this.operations.map((op) => Object.freeze({ ...op }));
  }
  readonly kind: OpKind;
  /** Set when the batch halted itself rather than being stopped by the user. */
  haltedBy: 'rate-limit' | 'signed-out' | 'account-changed' | 'no-durable-state' | null = null;
  private deps: QueueDeps;
  private stopped = false;
  private running = false;
  private readonly concurrency: 1 | 2;
  private saving: Promise<boolean> = Promise.resolve(true);

  constructor(items: { id: string; title: string }[], kind: OpKind, deps: QueueDeps) {
    this.kind = kind;
    this.deps = deps;
    this.concurrency = deps.concurrency ?? 1;
    if (this.concurrency !== 1 && this.concurrency !== 2) throw new Error('Invalid queue concurrency');
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

  /** Finishes already-sent operations, then stops. Unsent work stays resumable. */
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
  private halt(op: Operation, reason: NonNullable<OperationQueue['haltedBy']>, dispatched = false) {
    op.state = dispatched ? 'dispatched' : 'queued';
    if (!dispatched) op.attempts = 0;
    this.pause(reason);
    this.emit();
  }

  private pause(reason: NonNullable<OperationQueue['haltedBy']>) {
    this.haltedBy ??= reason;
    this.stopped = true;
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Claim each item synchronously before awaiting: no two workers can pick the same ID.
      const pending = this.operations.filter((op) => op.state !== 'done' && op.state !== 'failed');
      let next = 0;
      const worker = async () => {
        try {
          while (!this.stopped && next < pending.length) {
            const op = pending[next++];
            await this.runOne(op);
            if (!(await this.persist())) this.pause('no-durable-state');
          }
        } catch (err) {
          this.stopped = true;
          throw err;
        }
      };
      // Even an unexpected error must not release ownership while another worker is active.
      const results = await Promise.allSettled(
        Array.from({ length: Math.min(this.concurrency, pending.length) }, worker),
      );
      const failed = results.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    } finally {
      this.running = false;
    }
  }

  private emit() {
    this.deps.onChange?.(this.ops);
  }

  private persist(): Promise<boolean> {
    if (!this.deps.persist) return Promise.resolve(true);
    const snapshot = this.snapshot();
    // Snapshot order must equal storage order, even when two requests complete together.
    this.saving = this.saving.then(() => this.deps.persist!(snapshot)).catch(() => false);
    return this.saving;
  }

  private async runOne(op: Operation): Promise<void> {
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

    // Resumed work whose write already left this machine is reconciled by reading. Re-sending
    // it would be the replay this state exists to prevent.
    if (op.state === 'dispatched' && !(await this.reconcile(op))) return;

    while (op.attempts < MAX_ATTEMPTS) {
      if (this.stopped) return; // Stop requested during backoff must not dispatch again.
      op.attempts++;

      // Record the intent BEFORE the write, and refuse to continue if it cannot be recorded:
      // an unrecorded destructive write is one we could not tell from an unsent one later.
      op.state = 'dispatched';
      this.emit();
      if (!(await this.persist())) {
        return this.halt(op, 'no-durable-state');
      }
      // Stop or another worker's account error may arrive while storage is pending.
      if (this.stopped) {
        op.state = 'queued';
        op.attempts--;
        this.emit();
        return;
      }

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
        if (e.code === 'account_changed' || e.code === 'account_context_missing') {
          return this.halt(op, 'account-changed');
        }
        if (e.status === 401 || e.status === 403) return this.halt(op, 'signed-out');
        // Two workers must not independently retry an account-wide limit.
        if (e.status === 429 && this.concurrency === 2) return this.halt(op, 'rate-limit');
        if (!e.transient) {
          return this.settle(op, 'failed', describe(e.status, e.code));
        }
        // A lost response/server error may follow a successful write. Read before any retry.
        if (e.status !== 429 && !(await this.reconcile(op))) return;
        if (op.attempts >= MAX_ATTEMPTS) {
          // Still limited after the full backoff ladder — this is not a blip.
          if (e.status === 429) return this.halt(op, 'rate-limit');
          return this.settle(op, 'failed', describe(e.status, e.code));
        }
        op.state = 'retry_wait';
        this.emit();
        await sleep(Math.max(backoffMs(op.attempts), e.retryAfterMs ?? 0));
        continue;
      }

      // The write returned 2xx. Trust nothing until the detail endpoint agrees.
      const v = await this.read(op);
      if (settledOk(op.kind, v)) return this.settle(op, 'done');

      // The read-back failed for an account-level reason, not a per-conversation one. Halting
      // keeps the operation `dispatched`, so the resume path reconciles it instead of resending.
      if (v.state === 'error' &&
        (v.reason === 'account_changed' || v.reason === 'account_context_missing')) {
        return this.halt(op, 'account-changed', true);
      }
      if (v.state === 'error' && (v.code === 429 || v.code === 401 || v.code === 403)) {
        return this.halt(op, v.code === 429 ? 'rate-limit' : 'signed-out', true);
      }

      if ((v.state === 'error' && v.code >= 400 && v.code < 500) ||
        v.state === 'missing' || (op.kind === 'archive' && v.state === 'deleted')) {
        return this.settle(op, 'failed', unconfirmed(op.kind, v));
      }

      // The write may or may not have landed and we cannot tell. Re-sending it is exactly the
      // replay we are avoiding, so ask again rather than act again.
      if (!(await this.reconcile(op))) return;

      if (op.attempts >= MAX_ATTEMPTS) {
        return this.settle(op, 'failed', unconfirmed(op.kind, v));
      }
      op.state = 'retry_wait';
      this.emit();
      await sleep(Math.max(backoffMs(op.attempts), v.state === 'error' ? v.retryAfterMs ?? 0 : 0));
    }
  }

  private read(op: Operation): Promise<VerifyResult> {
    const unknown: VerifyResult = { state: 'error', code: 0 };
    return this.deps.verify(op.id).catch(() => unknown);
  }

  /**
   * Decides an operation whose write may already have landed, using reads only.
   *
   * Returns true when the caller may safely send the write (the read proved it was NOT
   * applied). Otherwise the operation has been settled here — as done if the read proves the
   * outcome, or as failed when the outcome cannot be established. An unresolvable operation is
   * reported, never repeated.
   */
  private async reconcile(op: Operation): Promise<boolean> {
    const v = await this.read(op);
    if (settledOk(op.kind, v)) {
      this.settle(op, 'done');
      return false;
    }
    // Proven untouched: the conversation is still there, and still not in the target state.
    if (v.state === 'present' && (op.kind === 'remove' || v.archived !== true)) return true;
    if (v.state === 'error' &&
      (v.reason === 'account_changed' || v.reason === 'account_context_missing')) {
      this.halt(op, 'account-changed', true);
      return false;
    }
    if (v.state === 'error' && (v.code === 429 || v.code === 401 || v.code === 403)) {
      this.halt(op, v.code === 429 ? 'rate-limit' : 'signed-out', true);
      return false;
    }
    this.settle(op, 'failed', `outcome could not be established; not repeated (${unconfirmed(op.kind, v)})`);
    return false;
  }

  private snapshot(): readonly Operation[] {
    return this.operations.map((o) => ({ ...o }));
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
