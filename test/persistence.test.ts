import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/chatgpt/api.ts';
import { OperationQueue, type Operation } from '../src/queue/operationQueue.ts';
import { clearBatch, loadBatch, saveBatch } from '../src/queue/persistence.ts';
import { extensionAlive } from '../src/storage/local.ts';
import { loadProtected, setProtected } from '../src/storage/protectedChats.ts';
import type { ConversationAdapter } from '../src/types/conversation.ts';
import { chatId } from './fixtures.ts';

/** Minimal chrome.storage.local stand-in for a live extension context. */
function stubStorage(initial: Record<string, unknown> = {}) {
  const mem: Record<string, unknown> = { ...initial };
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: { id: 'test-extension' },
    storage: {
      local: {
        get: async (k: string) => structuredClone(k in mem ? { [k]: mem[k] } : {}),
        set: async (o: Record<string, unknown>) => void Object.assign(mem, structuredClone(o)),
        remove: async (k: string) => void delete mem[k],
      },
    },
  };
  return mem;
}

/**
 * An orphaned content script: the extension was reloaded or auto-updated while this tab
 * stayed open. `chrome.runtime.id` is gone and touching chrome.storage throws SYNCHRONOUSLY,
 * which is why a plain `.catch()` on the returned promise never fired.
 */
function stubInvalidatedContext() {
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {},
    get storage(): never {
      throw new Error('Extension context invalidated.');
    },
  };
}

const op = (id: string, state: Operation['state'], attempts = 1): Operation => ({
  id: chatId(id),
  title: id,
  kind: 'remove',
  state,
  attempts,
});

test('an interrupted operation comes back queued, with its retries reset', async () => {
  // Documents the current unsafe recovery behavior (audit F04), not an exactly-once guarantee.
  stubStorage();
  await saveBatch({
    kind: 'remove',
    startedAt: 1,
    ops: [op('a', 'done'), op('b', 'running', 2), op('c', 'retry_wait', 3), op('d', 'queued', 0)],
  });
  const b = await loadBatch();
  assert.deepEqual(
    b!.ops.map((o) => [o.id, o.state, o.attempts]),
    [
      [chatId('a'), 'done', 1],
      [chatId('b'), 'queued', 0],
      [chatId('c'), 'queued', 0],
      [chatId('d'), 'queued', 0],
    ],
  );
});

test('a failed operation stays failed and is not retried by the resume', async () => {
  stubStorage();
  await saveBatch({ kind: 'remove', startedAt: 1, ops: [op('a', 'failed')] });
  assert.equal((await loadBatch())!.ops[0].state, 'failed');
});

test('malformed saved batches stop loading; absent storage is empty', async () => {
  stubStorage({ activeBatch: { kind: 'nonsense', ops: [op('a', 'queued')] } });
  await assert.rejects(loadBatch(), /Invalid or unsupported/);
  stubStorage({ activeBatch: { kind: 'remove', ops: 'not-an-array' } });
  await assert.rejects(loadBatch(), /Invalid or unsupported/);
  stubStorage({ activeBatch: { kind: 'remove', ops: [{ junk: true }] } });
  await assert.rejects(loadBatch(), /Invalid or unsupported/);
  stubStorage();
  assert.equal(await loadBatch(), null);
});

test('clearBatch removes the record', async () => {
  const mem = stubStorage();
  await saveBatch({ kind: 'remove', startedAt: 1, ops: [op('a', 'queued')] });
  await clearBatch();
  assert.equal('activeBatch' in mem, false);
  assert.equal(await loadBatch(), null);
});

test('resume skips durably recorded done states; ambiguous running work still replays (F04)', async () => {
  stubStorage();
  const calls: string[] = [];
  const adapter: ConversationAdapter = {
    name: 'fake',
    listVisibleConversations: async () => [],
    archive: async () => {},
    remove: async (id) => void calls.push(id),
  };
  // Simulates: 2 deleted, 1 killed mid-flight, 1 never started.
  await saveBatch({
    kind: 'remove',
    startedAt: 1,
    ops: [op('a', 'done'), op('b', 'done'), op('c', 'running'), op('d', 'queued')],
  });
  const b = await loadBatch();
  const q = OperationQueue.restore(b!.kind, b!.ops, {
    adapter,
    verify: async () => ({ state: 'deleted' }),
    sleep: async () => {},
  });
  await q.run();

  assert.deepEqual(calls, ['c', 'd'].map(chatId), 'a and b must not be deleted a second time');
  assert.equal(q.done, 4);
});

test('already deleted satisfies delete, but must never be reported as archived', async () => {
  // Deleting an already-deleted chat, and archiving one that someone deleted elsewhere.
  for (const kind of ['remove', 'archive'] as const) {
    const adapter: ConversationAdapter = {
      name: 'fake',
      listVisibleConversations: async () => [],
      archive: async () => {
        throw new ApiError(404, 'conversation_deleted');
      },
      remove: async () => {
        throw new ApiError(404, 'conversation_deleted');
      },
    };
    const q = new OperationQueue([{ id: chatId('gone'), title: 'gone' }], kind, {
      adapter,
      verify: async () => ({ state: 'deleted' }),
      sleep: async () => {},
    });
    await q.run();
    assert.equal(q.done, kind === 'remove' ? 1 : 0);
    assert.equal(q.failed.length, kind === 'archive' ? 1 : 0);
  }
});

test('storage degrades quietly when the extension context is invalidated', async () => {
  stubInvalidatedContext();
  // None of these may throw: the queue calls saveBatch on every state transition, and a
  // synchronous throw there escaped as an unhandled rejection and could break a live batch.
  assert.equal(await saveBatch({ kind: 'remove', startedAt: 1, ops: [op('a', 'queued')] }), false);
  assert.equal(await clearBatch(), false);
  assert.equal(await loadBatch(), null);
  assert.deepEqual(await loadProtected(), new Set());
  assert.deepEqual(await setProtected('a', true), { ids: new Set(['a']), saved: false });
  assert.equal(extensionAlive(), false);
});

test('storage works normally while the extension context is alive', async () => {
  stubStorage();
  assert.equal(extensionAlive(), true);
  assert.equal(await setProtected('x', true).then((r) => r.saved), true);
  assert.deepEqual(await loadProtected(), new Set(['x']));
  assert.equal(await setProtected('x', false).then((r) => r.saved), true);
  assert.deepEqual(await loadProtected(), new Set());
});
