import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, type VerifyResult } from '../src/chatgpt/api.ts';
import type { ConversationAdapter } from '../src/types/conversation.ts';
import { OperationQueue, type Operation } from '../src/queue/operationQueue.ts';
import { chatId } from './fixtures.ts';

const items = Array.from({ length: 5 }, (_, i) => ({ id: chatId(i), title: `Chat ${i}` }));
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function harness() {
  const writes: string[] = [];
  const reads: string[] = [];
  const actions = items.map(() => deferred<void>());
  const checks = items.map(() => deferred<VerifyResult>());
  const index = (id: string) => items.findIndex((item) => item.id === id);
  const adapter: ConversationAdapter = {
    name: 'fake', listVisibleConversations: async () => [],
    archive: async (id) => { writes.push(id); await actions[index(id)].promise; },
    remove: async (id) => { writes.push(id); await actions[index(id)].promise; },
  };
  const verify = async (id: string) => { reads.push(id); return checks[index(id)].promise; };
  return { adapter, verify, writes, reads, actions, checks };
}

test('two slots overlap writes and verification, each target runs once, and both drain', async () => {
  const h = harness();
  const q = new OperationQueue(items, 'remove', { ...h, concurrency: 2 });
  let finished = false;
  const running = q.run().then(() => { finished = true; });
  await q.run(); // a second caller must not create more workers
  await turn();
  assert.deepEqual(h.writes, items.slice(0, 2).map((i) => i.id));
  h.actions[1].resolve();
  await turn();
  assert.deepEqual(h.reads, [items[1].id]);
  assert.equal(h.writes.length, 2, 'read-back still occupies its slot');
  assert.equal(q.done, 0, 'PATCH success alone is not completion');
  h.checks[1].resolve({ state: 'deleted' });
  await turn();
  assert.equal(h.writes.length, 3, 'the free slot advances without waiting for the slow first chat');
  for (const n of [2, 3, 4]) {
    h.actions[n].resolve();
    h.checks[n].resolve({ state: 'deleted' });
    await turn();
    assert.ok(h.writes.length - q.done <= 2, 'at most two unverified writes');
  }
  assert.equal(finished, false, 'run waits for every worker, including the slow one');
  h.actions[0].resolve();
  h.checks[0].resolve({ state: 'deleted' });
  await running;
  assert.equal(q.done, 5);
  assert.deepEqual(h.writes, items.map((i) => i.id));
});

test('sequential mode keeps the next archive waiting for verification', async () => {
  const h = harness();
  const q = new OperationQueue(items, 'archive', h);
  const running = q.run();
  await turn();
  h.actions[0].resolve();
  await turn();
  assert.equal(h.writes.length, 1);
  q.stop();
  h.checks[0].resolve({ state: 'present', archived: true });
  await running;
  assert.equal(q.done, 1);
  assert.equal(q.pending, 4);
});

test('stop drains two in-flight chats and resume sends only the untouched remainder', async () => {
  const h = harness();
  const q = new OperationQueue(items, 'remove', { ...h, concurrency: 2 });
  const running = q.run();
  await turn();
  q.stop();
  h.actions.forEach((action) => action.resolve());
  h.checks.forEach((check) => check.resolve({ state: 'deleted' }));
  await running;
  assert.equal(h.writes.length, 2);
  assert.equal(q.done, 2);
  assert.equal(q.pending, 3);
  q.resume();
  await q.run();
  assert.deepEqual(h.writes, items.map((i) => i.id));
  assert.equal(q.done, 5);
});

test('storage writes are serialized, dispatch waits for its snapshot, and completion is durable', async () => {
  const h = harness();
  const gates = [deferred<boolean>(), deferred<boolean>()];
  const snapshots: Operation[][] = [];
  const saved: Operation[][] = [];
  let activeSaves = 0;
  let peakSaves = 0;
  const q = new OperationQueue(items.slice(0, 2), 'remove', {
    ...h, concurrency: 2,
    persist: async (ops) => {
      const n = snapshots.length;
      snapshots.push(ops.map((op) => ({ ...op })));
      peakSaves = Math.max(peakSaves, ++activeSaves);
      if (gates[n]) await gates[n].promise;
      saved.push(ops.map((op) => ({ ...op })));
      activeSaves--;
      return true;
    },
  });
  const running = q.run();
  await turn();
  assert.equal(snapshots.length, 1);
  assert.equal(h.writes.length, 0);
  gates[0].resolve(true);
  await turn();
  assert.equal(snapshots.length, 2);
  assert.deepEqual(h.writes, [items[0].id]);
  assert.deepEqual(saved[0].map((op) => op.state), ['dispatched', 'queued']);
  gates[1].resolve(true);
  await turn();
  assert.equal(h.writes.length, 2);
  h.actions.forEach((action) => action.resolve());
  h.checks.forEach((check) => check.resolve({ state: 'deleted' }));
  await running;
  assert.equal(peakSaves, 1);
  assert.deepEqual(saved.at(-1)!.map((op) => op.state), ['done', 'done']);
  assert.equal(activeSaves, 0);
});

test('stop while dispatch intent is saving prevents both unsent writes', async () => {
  const h = harness();
  const gate = deferred<boolean>();
  const q = new OperationQueue(items, 'remove', {
    ...h, concurrency: 2, persist: async () => gate.promise,
  });
  const running = q.run();
  await turn();
  q.stop();
  gate.resolve(true);
  await running;
  assert.deepEqual(h.writes, []);
  assert.ok(q.ops.every((op) => op.state === 'queued' && op.attempts === 0));
});

test('a failed or rejected intent save stops both workers before dispatch', async () => {
  for (const reject of [false, true]) {
    const h = harness();
    let saves = 0;
    const q = new OperationQueue(items, 'remove', {
      ...h, concurrency: 2,
      persist: async () => {
        if (saves++ > 0) return true;
        if (reject) throw new Error('storage unavailable');
        return false;
      },
    });
    await q.run();
    assert.deepEqual(h.writes, []);
    assert.equal(q.haltedBy, 'no-durable-state');
    assert.equal(q.pending, 5);
  }
});

test('a rate limit stops the entire parallel batch without retrying either worker', async () => {
  const h = harness();
  let limited = true;
  let waits = 0;
  const q = new OperationQueue(items, 'remove', {
    ...h, concurrency: 2, sleep: async () => { waits++; },
    adapter: { ...h.adapter, remove: async (id) => {
      h.writes.push(id);
      if (id === items[0].id && limited) throw new ApiError(429);
    } },
  });
  const running = q.run();
  await turn();
  assert.equal(q.haltedBy, 'rate-limit');
  assert.ok(h.writes.length <= 2);
  h.checks.forEach((check) => check.resolve({ state: 'deleted' }));
  await running;
  const sentBeforeResume = h.writes.length;
  assert.equal(waits, 0);
  assert.equal(q.failed.length, 0);
  assert.equal(q.ops[0].state, 'queued', '429 refused the write, so it may be retried later');
  limited = false;
  q.resume();
  await q.run();
  assert.equal(q.done, 5);
  assert.equal(h.writes.length, 6, 'only the refused request is sent twice');
  assert.ok(sentBeforeResume <= 2);
});

test('an account error prevents a peer dispatch still waiting for storage', async () => {
  const h = harness();
  const gate = deferred<boolean>();
  let saves = 0;
  const q = new OperationQueue(items, 'remove', {
    ...h, concurrency: 2,
    adapter: { ...h.adapter, remove: async (id) => { h.writes.push(id); throw new ApiError(429); } },
    persist: async () => ++saves === 2 ? gate.promise : true,
  });
  const running = q.run();
  await turn();
  assert.equal(q.haltedBy, 'rate-limit');
  gate.resolve(true);
  await running;
  assert.deepEqual(h.writes, [items[0].id]);
  assert.equal(q.pending, 5);
});

test('a throttled read-back stays dispatched in storage and is reconciled without replay', async () => {
  for (const code of [429, 401, 403]) {
    const h = harness();
    let stored: Operation[] = [];
    const q = new OperationQueue(items.slice(0, 2), 'remove', {
      ...h, concurrency: 2,
      persist: async (ops) => { stored = structuredClone([...ops]); return true; },
    });
    const running = q.run();
    await turn();
    h.actions[0].resolve();
    h.actions[1].resolve();
    h.checks[0].resolve({ state: 'error', code });
    h.checks[1].resolve({ state: 'deleted' });
    await running;
    assert.equal(stored[0].state, 'dispatched');
    assert.equal(stored[1].state, 'done');
    const restored = OperationQueue.restore('remove', stored, {
      ...h, concurrency: 2, verify: async () => ({ state: 'deleted' }),
    });
    await restored.run();
    assert.equal(restored.done, 2);
    assert.equal(h.writes.length, 2, 'the already-applied write is never sent again');
  }
});

test('lost write responses are reconciled before any retry in two-worker mode', async () => {
  for (const status of [0, 500]) {
    const h = harness();
    const q = new OperationQueue(items, 'remove', {
      ...h, concurrency: 2,
      adapter: { ...h.adapter, remove: async (id) => { h.writes.push(id); throw new ApiError(status); } },
      verify: async () => ({ state: 'deleted' }),
    });
    await q.run();
    assert.equal(q.done, 5);
    assert.deepEqual(h.writes, items.map((item) => item.id));
  }
});

test('failure saving completion halts new work and retains the confirmed result', async () => {
  const h = harness();
  const q = new OperationQueue(items, 'remove', {
    ...h, concurrency: 2,
    persist: async (ops) => !ops.some((op) => op.state === 'done'),
  });
  const running = q.run();
  await turn();
  h.actions.forEach((action) => action.resolve());
  h.checks.forEach((check) => check.resolve({ state: 'deleted' }));
  await running;
  assert.equal(q.haltedBy, 'no-durable-state');
  assert.equal(q.done, 2);
  assert.equal(q.pending, 3);
  assert.equal(h.writes.length, 2);
});
