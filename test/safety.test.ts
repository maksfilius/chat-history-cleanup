import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { apiAdapter, endpoints, forgetToken, mapApiItem, verify, ApiError } from '../src/chatgpt/api.ts';
import { parseConversationHref } from '../src/chatgpt/selectors.ts';
import { domAdapter } from '../src/chatgpt/dom.ts';
import { protectionMap } from '../src/cleanup/protections.ts';
import { projectGroups, selectAll } from '../src/cleanup/selection.ts';
import { OperationQueue, type Operation } from '../src/queue/operationQueue.ts';
import { loadBatch } from '../src/queue/persistence.ts';
import type { ConversationAdapter } from '../src/types/conversation.ts';
import { chatId } from './fixtures.ts';

const a = chatId('A');
const b = chatId('B');
const item = (id = a) => ({ id, title: '<img src=x onerror=alert(1)>' });
const operation = (id = a): Operation => ({ ...item(id), kind: 'remove', state: 'queued', attempts: 0 });
const adapter: ConversationAdapter = {
  name: 'synthetic', listVisibleConversations: async () => [], archive: async () => {}, remove: async () => {},
};
const deps = { adapter, verify: async () => ({ state: 'deleted' as const }), sleep: async () => {} };

test('malformed identities cannot reach a destructive request or alter its URL', async () => {
  let requests = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { requests++; throw new Error('Unexpected request'); };
  try {
    for (const id of ['', 'WEB:' + a, '../conversation/' + b, a + '?x', a + '#x', '-'.repeat(36), 'g-p-project', a.toUpperCase()]) {
      await assert.rejects(apiAdapter.remove(id), /Invalid conversation identifier/);
      await assert.rejects(apiAdapter.archive(id), /Invalid conversation identifier/);
      assert.throws(() => new OperationQueue([item(id)], 'remove', deps), /Invalid/);
      assert.throws(() => mapApiItem({ ...item(id), create_time: null, update_time: null }), /Invalid/);
    }
    assert.equal(requests, 0);
    assert.equal(endpoints.conversation(a), `/backend-api/conversation/${a}`);
    assert.throws(() => endpoints.projectConversations('../conversation/' + b, 0, 28), /Invalid project/);
    assert.match(endpoints.projectConversations('g-p-synthetic', 'next&limit=999#x', 28), /cursor=next%26limit%3D999%23x&limit=28$/);
  } finally { globalThis.fetch = original; }
});

test('DOM parser rejects wrong origins, malformed IDs and nonconversation paths', () => {
  for (const href of [`https://evil.example/c/${a}`, `//evil.example/c/${a}`, '/c/' + '-'.repeat(36), `/c/${a}/extra`, '/g/g-p-example/project']) {
    assert.equal(parseConversationHref(href), null);
  }
  assert.equal(parseConversationHref(`/g/g-p-synthetic/c/${a}?model=x`)?.id, a);
});

test('unknown protection fields stay out of Select All; individual inclusion is still possible', () => {
  const raw = { id: a, title: 'synthetic', create_time: null, update_time: null };
  for (const flags of [{}, { is_starred: null, pinned_time: null }, { is_starred: false, pinned_time: null }]) {
    const c = mapApiItem({ ...raw, ...flags });
    const protections = protectionMap([c], new Set());
    assert.deepEqual(selectAll([c], protections), { ids: [], skipped: 1 });
    const manualSelection = new Set(selectAll([c], protections).ids);
    manualSelection.add(c.id);
    assert.deepEqual([...manualSelection], [a]);
  }
  const c = mapApiItem({ ...raw, is_starred: false, pinned_time: null, gizmo_id: null });
  assert.deepEqual(selectAll([c], protectionMap([c], new Set())).ids, [a]);
});

test('project grouping emits conversation UUIDs only, never the project ID', () => {
  const pid = 'g-p-synthetic';
  const c = mapApiItem({ ...item(), gizmo_id: pid, create_time: null, update_time: null });
  assert.deepEqual(projectGroups([c], [{ id: pid, name: 'Project' }])[0].ids, [a]);
});

test('duplicate fresh or restored jobs and mixed operation kinds are rejected', () => {
  assert.throws(() => new OperationQueue([item(), item()], 'remove', deps), /Invalid or duplicate/);
  assert.throws(() => OperationQueue.restore('remove', [operation(), operation()], deps), /Invalid/);
  assert.throws(() => OperationQueue.restore('archive', [operation()], deps), /Invalid/);
  assert.throws(() => new OperationQueue([item()], 'unknown' as never, deps), /Invalid/);
});

test('malformed or legacy persistence fails closed as a whole', async () => {
  const valid = { version: 1, kind: 'remove', startedAt: 1, ops: [operation()] };
  for (const bad of [
    { ...valid, version: undefined }, { ...valid, version: 99 }, { ...valid, kind: 'archive' },
    { ...valid, startedAt: NaN }, { ...valid, ops: [operation(), operation()] },
    { ...valid, ops: [operation(), null] },
    ...[
      { id: '../conversation/' + b }, { kind: undefined }, { kind: 'archive' },
      { state: 'dnoe' }, { state: ['queued'] }, { attempts: NaN }, { attempts: -1 },
      { attempts: 1.5 }, { attempts: 5 }, { state: 'running', attempts: 0 },
      { title: null },
    ].map(overrides => ({ ...valid, ops: [{ ...operation(), ...overrides }] })),
  ]) {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { id: 'test' }, storage: { local: { get: async () => ({ activeBatch: structuredClone(bad) }) } },
    };
    await assert.rejects(loadBatch(), /Invalid or unsupported/);
  }
});

test('input arrays, restore records and progress snapshots cannot change live targets', async () => {
  const calls: string[] = [];
  const localDeps = { ...deps, adapter: { ...adapter, remove: async (id: string) => { calls.push(id); } } };
  const picked = [item()];
  const q = new OperationQueue(picked, 'remove', {
    ...localDeps,
    onChange: ops => { assert.throws(() => Object.assign(ops[0], { id: b }), TypeError); },
  });
  picked[0].id = b;
  q.ops.push(operation(b));
  await q.run();
  const saved = [operation()];
  const restored = OperationQueue.restore('remove', saved, localDeps);
  Object.assign(saved[0], { id: b });
  await restored.run();
  assert.deepEqual(calls, [a, a]);
});

test('retry and middle failure preserve the exact next target under reordered input', async () => {
  const c = chatId('C');
  const picked = [item(a), item(b), item(c)];
  const calls: string[] = [];
  let attempts = 0;
  const q = new OperationQueue(picked, 'remove', {
    ...deps, adapter: { ...adapter, remove: async id => {
      calls.push(id);
      if (id === a && attempts++ === 0) { picked.reverse(); throw new ApiError(429); }
      if (id === b) throw new ApiError(404, 'conversation_not_found');
    } },
  });
  await Promise.all([q.run(), q.run()]);
  assert.deepEqual(calls, [a, a, b, c]);
  assert.equal(q.done, 2);
  assert.equal(q.failed[0].id, b);
});

test('malformed write response and mismatched read-back identity are not success', async () => {
  const original = globalThis.fetch;
  const requests: { url: string; init?: RequestInit }[] = [];
  let response: unknown = { success: false };
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify(String(url).includes('/api/auth/session') ? { accessToken: 'synthetic-token' } : response));
  };
  forgetToken();
  try {
    await assert.rejects(apiAdapter.remove(a), /unconfirmed_write_response/);
    response = { success: true };
    await apiAdapter.archive(a);
    response = { conversation_id: b, is_archived: true };
    assert.deepEqual(await verify(a), { state: 'error', code: 422 });
    response = { is_archived: true };
    assert.deepEqual(await verify(a), { state: 'error', code: 422 });
    response = { conversation_id: a, is_archived: true };
    assert.deepEqual(await verify(a), { state: 'present', archived: true });
    for (const request of requests) {
      assert.equal(new URL(request.url).origin, 'https://chatgpt.com');
      assert.equal(request.init?.redirect, 'error');
      assert.equal(request.init?.cache, 'no-store');
      assert.equal(request.init?.referrerPolicy, 'no-referrer');
    }
  } finally { globalThis.fetch = original; forgetToken(); }
});

test('invalid verification schema fails without replaying the write', async () => {
  let calls = 0;
  const q = new OperationQueue([item()], 'remove', {
    ...deps, adapter: { ...adapter, remove: async () => { calls++; } },
    verify: async () => ({ state: 'error', code: 422 }),
  });
  await q.run();
  assert.equal(calls, 1);
  assert.equal(q.failed.length, 1);
});

test('a deleted code on an unrelated HTTP error cannot mark success', async () => {
  const q = new OperationQueue([item()], 'remove', {
    ...deps, adapter: { ...adapter, remove: async () => { throw new ApiError(400, 'conversation_deleted'); } },
  });
  await q.run();
  assert.equal(q.done, 0);
  assert.equal(q.failed.length, 1);
});

test('unverified DOM mutations are disabled', async () => {
  await assert.rejects(domAdapter.remove(a), /target cannot be verified/);
  await assert.rejects(domAdapter.archive(a), /target cannot be verified/);
});

test('an unverifiable saved batch does not brick the panel', async () => {
  // The audit fix made loadBatch throw. If that rejection reaches the panel's Promise.all,
  // `ready` never becomes true and the panel is unusable for good, because a user cannot
  // reach chrome.storage to clear the record. The loader must isolate the failure.
  const source = await readFile(new URL('../src/content/panel.ts', import.meta.url), 'utf8');

  assert.match(
    source,
    /loadBatch\(\)\.then\(/,
    'loadBatch must be settled independently, not passed bare into Promise.all',
  );
  assert.match(source, /showRejectedBatch/, 'a rejected batch needs a visible, dismissible path');
  // `ready` has to be set on the success path regardless of the batch outcome.
  const loader = source.slice(source.indexOf('void Promise.all'));
  assert.ok(
    loader.indexOf('ready = true') < loader.indexOf('showRejectedBatch(restored.invalid)'),
    'the panel becomes usable before the rejected-batch notice is shown',
  );
});
