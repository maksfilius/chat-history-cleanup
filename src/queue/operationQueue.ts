import { asApiError, type VerifyResult } from '../chatgpt/api.ts';
import type { ConversationAdapter } from '../types/conversation.ts';

export type OpKind = 'archive' | 'remove';
export type OpState = 'queued' | 'running' | 'retry_wait' | 'done' | 'failed';

export interface Operation {
  id: string;
  title: string;
  kind: OpKind;
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

/** Exponential backoff with jitter, so a rate limit does not resync every retry. */
export const backoffMs = (attempt: number, rand = Math.random) =>
  Math.round(BASE_BACKOFF_MS * 2 ** (attempt - 1) * (0.75 + rand() * 0.5));

/**
 * Sequential (concurrency 1) queue for destructive work.
 *
 * Two rules it exists to enforce:
 *  - every action is confirmed against the detail endpoint, never against the listing, which
 *    lags writes badly (see docs/chatgpt-integration.md);
 *  - an action the server reports as already applied counts as SUCCESS, never as a retry.
 *    That is what makes a resumed batch safe to re-run.
 */
export class OperationQueue {
  readonly ops: Operation[];
  readonly kind: OpKind;
  /** Set when the batch halted itself rather than being stopped by the user. */
  haltedBy: 'rate-limit' | 'signed-out' | null = null;
  private deps: QueueDeps;
  private stopped = false;
  private running = false;

  constructor(items: { id: string; title: string }[], kind: OpKind, deps: QueueDeps) {
    this.kind = kind;
    this.deps = deps;
    this.ops = items.map((i) => ({ ...i, kind, state: 'queued', attempts: 0 }));
  }

  /** Rebuilds a queue from a persisted batch, keeping what already settled. */
  static restore(kind: OpKind, ops: Operation[], deps: QueueDeps): OperationQueue {
    const q = new OperationQueue([], kind, deps);
    q.ops.push(...ops);
    return q;
  }

  /** Clears the stop flag so a paused batch can continue where it left off. */
  resume() {
    this.stopped = false;
    this.haltedBy = null;
  }

  get pending() {
    return this.ops.filter((o) => o.state !== 'done' && o.state !== 'failed').length;
  }
  get done() {
    return this.ops.filter((o) => o.state === 'done').length;
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
      for (const op of this.ops) {
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
        // The conversation is already gone. For a delete that is the outcome we wanted; for an
        // archive it is no longer in the way either. Either way: done, never a retry. This is
        // what makes a resumed batch safe to re-run.
        if (e.code === 'conversation_deleted') {
          return this.settle(op, 'done');
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
      // resumable, and on resume the action is re-issued safely because both actions are
      // idempotent.
      if (v.state === 'error' && (v.code === 429 || v.code === 401 || v.code === 403)) {
        return this.halt(op, v.code === 429 ? 'rate-limit' : 'signed-out');
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
  // Archive: a conversation deleted from another tab meanwhile is also "no longer in the way".
  return (v.state === 'present' && v.archived === true) || v.state === 'deleted';
}

function unconfirmed(kind: OpKind, v: VerifyResult): string {
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
