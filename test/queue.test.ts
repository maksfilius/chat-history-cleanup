import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/chatgpt/api.ts';
import { MAX_ATTEMPTS, OperationQueue, backoffMs, settledOk } from '../src/queue/operationQueue.ts';
import type { ConversationAdapter } from '../src/types/conversation.ts';

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, title: `t${i}` }));
const noSleep = async () => {};

/** Adapter whose behavior per id is scripted by the test. */
function fakeAdapter(script: Record<string, () => Promise<void>> = {}): ConversationAdapter & { calls: string[] } {
  const calls: string[] = [];
  const act = async (id: string) => {
    calls.push(id);
    await (script[id] ?? (async () => {}))();
  };
  return { name: 'fake', calls, listVisibleConversations: async () => [], archive: act, remove: act };
}

test('happy path: every op runs once and is confirmed', async () => {
  const adapter = fakeAdapter();
  const q = new OperationQueue(items(3), 'archive', {
    adapter,
    verify: async () => ({ state: 'present', archived: true }),
    sleep: noSleep,
  });
  await q.run();
  assert.equal(q.done, 3);
  assert.equal(q.failed.length, 0);
  assert.deepEqual(adapter.calls, ['c0', 'c1', 'c2']); // sequential, concurrency 1
});

test('a 2xx write that the detail endpoint does not confirm is NOT counted as success', async () => {
  // The whole point of verifying: the write said 200 but nothing changed.
  const adapter = fakeAdapter();
  const q = new OperationQueue(items(1), 'archive', {
    adapter,
    verify: async () => ({ state: 'present', archived: false }),
    sleep: noSleep,
  });
  await q.run();
  assert.equal(q.done, 0);
  assert.equal(q.failed.length, 1);
  assert.equal(adapter.calls.length, MAX_ATTEMPTS);
  assert.match(q.failed[0].error!, /did not take effect/);
});

test('rate limit is retried with backoff, then succeeds', async () => {
  let n = 0;
  const adapter = fakeAdapter({
    c0: async () => {
      if (++n < 3) throw new ApiError(429);
    },
  });
  const waits: number[] = [];
  const q = new OperationQueue(items(1), 'archive', {
    adapter,
    verify: async () => ({ state: 'present', archived: true }),
    sleep: async (ms) => void waits.push(ms),
  });
  await q.run();
  assert.equal(q.done, 1);
  assert.equal(n, 3);
  assert.equal(waits.length, 2);
  assert.ok(waits[1] > waits[0], 'backoff must grow');
});

test('a permanent error fails immediately without burning retries', async () => {
  const adapter = fakeAdapter({ c0: async () => { throw new ApiError(404, 'conversation_not_found'); } });
  const q = new OperationQueue(items(1), 'remove', { adapter, verify: async () => ({ state: 'missing' }), sleep: noSleep });
  await q.run();
  assert.equal(q.failed.length, 1);
  assert.equal(adapter.calls.length, 1); // no retry storm on a hopeless op
  assert.match(q.failed[0].error!, /no longer exists/);
});

test('deleting an already-deleted conversation counts as done, never as a retry', async () => {
  // This is what makes a resumed batch safe: the destructive action is idempotent.
  const adapter = fakeAdapter({ c0: async () => { throw new ApiError(404, 'conversation_deleted'); } });
  const settled: string[] = [];
  const q = new OperationQueue(items(1), 'remove', {
    adapter,
    verify: async () => ({ state: 'deleted' }),
    sleep: noSleep,
    onSettled: (id) => settled.push(id),
  });
  await q.run();
  assert.equal(q.done, 1);
  assert.equal(q.failed.length, 0);
  assert.equal(adapter.calls.length, 1);
  assert.deepEqual(settled, ['c0']);
});

test('stop() halts the batch and leaves the rest untouched', async () => {
  const adapter = fakeAdapter();
  const q: OperationQueue = new OperationQueue(items(5), 'remove', {
    adapter,
    verify: async () => ({ state: 'deleted' }),
    sleep: noSleep,
    onChange: () => { if (q.done >= 2) q.stop(); },
  });
  await q.run();
  assert.equal(q.done, 2);
  assert.equal(adapter.calls.length, 2, 'no further destructive calls after stop');
  assert.equal(q.pending, 3);
});

test('re-running a stopped queue resumes without repeating completed work', async () => {
  const adapter = fakeAdapter();
  let stopAt2 = true;
  const q: OperationQueue = new OperationQueue(items(4), 'remove', {
    adapter,
    verify: async () => ({ state: 'deleted' }),
    sleep: noSleep,
    onChange: () => { if (stopAt2 && q.done >= 2) q.stop(); },
  });
  await q.run();
  stopAt2 = false;
  q.resume();
  await q.run();
  assert.equal(q.done, 4);
  assert.deepEqual(adapter.calls, ['c0', 'c1', 'c2', 'c3'], 'c0/c1 must not be deleted twice');
});

test('settledOk demands proof, not a 2xx', () => {
  assert.equal(settledOk('remove', { state: 'deleted' }), true);
  assert.equal(settledOk('remove', { state: 'present', archived: false }), false);
  assert.equal(settledOk('remove', { state: 'missing' }), false);
  assert.equal(settledOk('archive', { state: 'present', archived: true }), true);
  assert.equal(settledOk('archive', { state: 'present', archived: false }), false);
  assert.equal(settledOk('archive', { state: 'error', code: 500 }), false);
});

test('backoff grows and stays jittered', () => {
  assert.equal(backoffMs(1, () => 0.5), 1000);
  assert.equal(backoffMs(2, () => 0.5), 2000);
  assert.equal(backoffMs(3, () => 0.5), 4000);
  assert.ok(backoffMs(1, () => 0) < backoffMs(1, () => 0.99));
});

test('a persistent rate limit halts the whole batch instead of failing every item', async () => {
  // The bug this guards: one 429 episode used to march through the batch, burning the retry
  // ladder on each conversation and marking all of them failed.
  const adapter = fakeAdapter(
    Object.fromEntries(
      items(5).map((i) => [i.id, async () => { throw new ApiError(429); }]),
    ),
  );
  const q = new OperationQueue(items(5), 'remove', {
    adapter,
    verify: async () => ({ state: 'deleted' }),
    sleep: noSleep,
  });
  await q.run();

  assert.equal(q.haltedBy, 'rate-limit');
  assert.equal(q.failed.length, 0, 'nothing is marked failed — the account was busy, not the chat');
  assert.equal(q.pending, 5, 'every conversation stays resumable');
  assert.equal(adapter.calls.length, MAX_ATTEMPTS, 'only the first op burns its retries');
});

test('being signed out halts immediately without burning retries', async () => {
  const adapter = fakeAdapter({ c0: async () => { throw new ApiError(401); } });
  const q = new OperationQueue(items(3), 'archive', {
    adapter,
    verify: async () => ({ state: 'present', archived: true }),
    sleep: noSleep,
  });
  await q.run();

  assert.equal(q.haltedBy, 'signed-out');
  assert.equal(adapter.calls.length, 1);
  assert.equal(q.pending, 3);
});

test('resume() clears the halt so the batch can continue later', async () => {
  let limited = true;
  const adapter = fakeAdapter({
    c0: async () => { if (limited) throw new ApiError(429); },
  });
  const q = new OperationQueue(items(2), 'remove', {
    adapter,
    verify: async () => ({ state: 'deleted' }),
    sleep: noSleep,
  });
  await q.run();
  assert.equal(q.haltedBy, 'rate-limit');

  limited = false;
  q.resume();
  await q.run();
  assert.equal(q.done, 2);
  assert.equal(q.haltedBy, null);
});

test('a rate limit hit while VERIFYING halts the batch instead of re-issuing the action', async () => {
  // The action succeeded; only the read-back was throttled. Retrying would re-send a
  // destructive PATCH we already sent, then fail every remaining conversation the same way.
  const adapter = fakeAdapter();
  const q = new OperationQueue(items(5), 'remove', {
    adapter,
    verify: async () => ({ state: 'error', code: 429 }),
    sleep: noSleep,
  });
  await q.run();

  assert.equal(q.haltedBy, 'rate-limit');
  assert.equal(adapter.calls.length, 1, 'the destructive action is sent once, not MAX_ATTEMPTS times');
  assert.equal(q.failed.length, 0, 'a throttled account is not a per-conversation failure');
  assert.equal(q.pending, 5, 'everything stays resumable');
});

test('losing the session while verifying halts too', async () => {
  const adapter = fakeAdapter();
  const q = new OperationQueue(items(3), 'archive', {
    adapter,
    verify: async () => ({ state: 'error', code: 401 }),
    sleep: noSleep,
  });
  await q.run();
  assert.equal(q.haltedBy, 'signed-out');
  assert.equal(adapter.calls.length, 1);
});

test('an unrelated verify error still retries, then fails just that conversation', async () => {
  // A 500 or a network blip is not an account-level condition: keep the existing behaviour.
  const adapter = fakeAdapter();
  const q = new OperationQueue(items(2), 'remove', {
    adapter,
    verify: async () => ({ state: 'error', code: 500 }),
    sleep: noSleep,
  });
  await q.run();
  assert.equal(q.haltedBy, null);
  assert.equal(q.failed.length, 2);
  assert.match(q.failed[0].error!, /could not confirm \(500\)/);
});
