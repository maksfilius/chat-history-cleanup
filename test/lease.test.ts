import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acquireLease, currentHolder, LEASE_TTL_MS, newOwnerId, releaseLease, renewLease,
} from '../src/queue/lease.ts';
import { OperationQueue, type Operation } from '../src/queue/operationQueue.ts';
import type { ConversationAdapter } from '../src/types/conversation.ts';
import { chatId } from './fixtures.ts';

function storage(initial: Record<string, unknown> = {}) {
  const mem: Record<string, unknown> = { ...initial };
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: { id: 'test-extension' },
    storage: {
      local: {
        get: async (k: string) => (k in mem ? { [k]: mem[k] } : {}),
        set: async (o: Record<string, unknown>) => void Object.assign(mem, o),
        remove: async (k: string) => void delete mem[k],
      },
    },
  };
  return mem;
}

test('a second tab cannot take a lease held by a live owner', async () => {
  storage();
  const a = newOwnerId();
  const b = newOwnerId();
  assert.equal(await acquireLease(a), true);
  assert.equal(await acquireLease(b), false, 'the second panel must stand down');
  assert.equal(await currentHolder(), a);
});

test('the same owner can re-take its own lease', async () => {
  storage();
  const a = newOwnerId();
  await acquireLease(a);
  assert.equal(await acquireLease(a), true);
});

test('an abandoned lease expires so a crashed tab cannot block cleanup forever', async () => {
  const now = Date.now();
  storage({ batchLease: { owner: 'dead-tab', renewedAt: now - LEASE_TTL_MS - 1 } });
  assert.equal(await currentHolder(now), null);
  assert.equal(await acquireLease(newOwnerId(), now), true);
});

test('a malformed lease record does not block work', async () => {
  storage({ batchLease: { nonsense: true } });
  assert.equal(await currentHolder(), null);
  assert.equal(await acquireLease(newOwnerId()), true);
});

test('renew fails once another owner has taken over, so the loser stops', async () => {
  storage();
  const a = newOwnerId();
  const b = 'other-tab';
  await acquireLease(a);
  storage({ batchLease: { owner: b, renewedAt: Date.now() } }); // the other tab took it
  assert.equal(await renewLease(a), false);
});

test('release only removes our own lease', async () => {
  const mem = storage();
  const a = newOwnerId();
  await acquireLease(a);
  await releaseLease('someone-else');
  assert.equal('batchLease' in mem, true, 'we must not release a lease we do not hold');
  await releaseLease(a);
  assert.equal('batchLease' in mem, false);
});

test('a write is never sent before the intent is durably recorded', async () => {
  const order: string[] = [];
  const adapter: ConversationAdapter = {
    name: 'fake',
    listVisibleConversations: async () => [],
    archive: async () => {},
    remove: async () => void order.push('write'),
  };
  const q = new OperationQueue([{ id: chatId(1), title: 't' }], 'remove', {
    adapter,
    verify: async () => ({ state: 'deleted' }),
    sleep: async () => {},
    persist: async (ops: readonly Operation[]) => {
      order.push(`persist:${ops[0].state}`);
      return true;
    },
  });
  await q.run();
  assert.deepEqual(order, ['persist:dispatched', 'write'],
    'the dispatched state must reach storage before the destructive call');
});

test('work stops when the intent cannot be recorded, instead of writing blindly', async () => {
  const calls: string[] = [];
  const adapter: ConversationAdapter = {
    name: 'fake',
    listVisibleConversations: async () => [],
    archive: async () => {},
    remove: async (id) => void calls.push(id),
  };
  const q = new OperationQueue(
    [{ id: chatId(1), title: 'a' }, { id: chatId(2), title: 'b' }],
    'remove',
    {
      adapter,
      verify: async () => ({ state: 'deleted' }),
      sleep: async () => {},
      persist: async () => false, // storage is gone
    },
  );
  await q.run();
  assert.deepEqual(calls, [], 'nothing may be deleted while progress cannot be saved');
  assert.equal(q.haltedBy, 'no-durable-state');
  assert.equal(q.pending, 2, 'and everything stays recoverable');
});
