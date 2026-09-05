import assert from 'node:assert/strict';
import test from 'node:test';
import { parseConversationHref } from '../src/chatgpt/selectors.ts';
import { listAll, mapApiItem } from '../src/chatgpt/api.ts';
import { daysSince, formatAge } from '../src/cleanup/age.ts';
import { chatId } from './fixtures.ts';

const UUID = '0f9a1b2c-3d4e-5f60-7182-93a4b5c6d7e8';

test('conversation id parsing', () => {
  const id = (h: string | null) => parseConversationHref(h)?.id ?? null;
  assert.equal(id(`/c/${UUID}`), UUID);
  assert.equal(id(`https://chatgpt.com/c/${UUID}?model=x`), UUID);
  assert.equal(id(`/c/${UUID.toUpperCase()}`), UUID);
  assert.equal(id('/g/g-123/project'), null);
  assert.equal(id('/c/not-a-uuid'), null);
  // A just-created chat briefly gets an optimistic client-side id. Rejecting it is required:
  // it is not a server id and PATCHing it would 404. Verified live 2026-09-03.
  assert.equal(id('/c/WEB:bbb3aca1-75a1-4028-bee1-099c19440275'), null);
  assert.equal(id(null), null);
});

test('a project conversation link yields both ids', () => {
  // Verified live 2026-09-03: chats inside a project use /g/g-p-<project>/c/<uuid>. Parsing
  // only /c/<uuid> made every project conversation invisible to the DOM adapter.
  const pid = 'g-p-0123456789abcdef0123456789abcdef';
  assert.deepEqual(parseConversationHref(`/g/${pid}/c/${UUID}`), { id: UUID, projectId: pid });
  assert.deepEqual(parseConversationHref(`/c/${UUID}`), { id: UUID, projectId: null });
  assert.equal(parseConversationHref(`/g/${pid}/project`), null);
});

test('api item mapping keeps timestamps and fails safe on missing metadata', () => {
  const c = mapApiItem({
    id: UUID,
    title: ' hi ',
    create_time: '2025-01-01T00:00:00.000000',
    update_time: '2025-02-01T00:00:00.000000Z',
    is_archived: false,
  } as never);
  assert.equal(c.title, 'hi');
  assert.equal(c.createdAt, Date.parse('2025-01-01T00:00:00.000Z'));
  assert.equal(c.updatedAt, Date.parse('2025-02-01T00:00:00.000Z'));
  assert.equal(c.isPinned, undefined); // unknown stays unknown, never false
  assert.equal(c.source, 'api');
});

test('project chats are distinguished from custom-GPT chats', () => {
  const base = { id: UUID, title: 't', create_time: null, update_time: null };
  assert.equal(mapApiItem({ ...base, gizmo_id: 'g-p-abc123def456' } as never).projectId, 'g-p-abc123def456');
  assert.equal(mapApiItem({ ...base, gizmo_id: 'g-abc123' } as never).projectId, null);
  assert.equal(mapApiItem({ ...base, gizmo_id: null } as never).projectId, null);
});

test('a present pin field is an answer; only a missing one is unknown', () => {
  const base = { id: UUID, title: 't', create_time: null, update_time: null };
  // VERIFIED against the live API: an unpinned conversation comes back with BOTH fields
  // present and null. Reading null as "unknown" would protect every ordinary conversation
  // and leave the product unable to select anything at all.
  assert.equal(mapApiItem({ ...base, pinned_time: null, is_starred: null } as never).isPinned, false);
  assert.equal(mapApiItem({ ...base, pinned_time: null, is_starred: false }).isPinned, false);
  assert.equal(mapApiItem({ ...base, pinned_time: '2026-01-01T00:00:00Z' } as never).isPinned, true);
  assert.equal(mapApiItem({ ...base, is_starred: true } as never).isPinned, true);
  // The genuine unknown: the server did not send the fields at all.
  assert.equal(mapApiItem({ ...base } as never).isPinned, undefined);
});

test('a present-but-null gizmo means "not in a project"; an absent one means unknown', () => {
  const base = { id: UUID, title: 't', create_time: null, update_time: null };
  assert.equal(mapApiItem({ ...base, gizmo_id: null } as never).projectId, null);
  assert.equal(mapApiItem({ ...base } as never).projectId, undefined);
});

test('age formatting and unknown-age fail-safe', () => {
  const now = Date.parse('2026-09-03T12:00:00Z');
  const ago = (d: number) => now - d * 86_400_000;
  assert.equal(formatAge(ago(0), now), 'today');
  assert.equal(formatAge(ago(6), now), '6d');
  assert.equal(formatAge(ago(95), now), '3mo');
  assert.equal(formatAge(ago(800), now), '2y');
  assert.equal(formatAge(undefined, now), '?'); // never guess an age
  assert.equal(daysSince(undefined, now), undefined);
});

test('listAll pages, dedupes, and reports an incomplete inventory', async () => {
  const items = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: chatId(from + i), title: 't', create_time: null, update_time: null,
    }));
  const pages: Record<number, unknown[]> = { 0: items(0, 28), 28: items(28, 28), 56: items(50, 6) };
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/api/auth/session')) return json({ accessToken: 'x'.repeat(30) });
    if (u.includes('/gizmos/snorlax/sidebar')) return json({ items: [] });
    const offset = Number(new URL(u, 'https://chatgpt.com').searchParams.get('offset'));
    return json({ items: pages[offset] ?? [], total: 62, limit: 28, offset });
  }) as never;

  const inv = await listAll();
  // 6 of the third page's ids overlap page 2 (an item shifting pages mid-run), so 56 unique.
  assert.equal(inv.conversations.length, 56);
  assert.equal(inv.complete, false); // must be false so bulk actions refuse to run
});

test('listAll includes project conversations the flat listing omits', async () => {
  // The flat endpoint returns 1 conversation; the project holds 2 more that it never lists.
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/api/auth/session')) return json({ accessToken: 'x'.repeat(30) });
    if (u.includes('/gizmos/snorlax/sidebar')) {
      return json({ items: [{ gizmo: { gizmo: { id: 'g-p-1', display: { name: 'Project One' } } } }] });
    }
    if (u.includes('/gizmos/g-p-1/conversations')) {
      return json({
        items: [
          { id: chatId('p1'), title: 'a', create_time: null, update_time: null, gizmo_id: 'g-p-1' },
          { id: chatId('p2'), title: 'b', create_time: null, update_time: null, gizmo_id: 'g-p-1' },
        ],
        cursor: null,
      });
    }
    const offset = Number(new URL(u, 'https://chatgpt.com').searchParams.get('offset'));
    return json({ items: offset === 0 ? [{ id: chatId('flat'), title: 'f', create_time: null, update_time: null }] : [], total: 1 });
  }) as never;

  const inv = await listAll();
  assert.deepEqual(inv.conversations.map((c) => c.id).sort(), ['flat', 'p1', 'p2'].map(chatId).sort());
  assert.equal(inv.total, 3);
  assert.equal(inv.complete, true);
  // Project conversations carry their project id, which makes them protected downstream.
  assert.equal(inv.conversations.find((c) => c.id === chatId('p1'))!.projectId, 'g-p-1');
});

test('a project that cannot be read makes the inventory incomplete and is named', async () => {
  // Silently dropping a project would let a broad rule run against a partial account.
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/api/auth/session')) return json({ accessToken: 'x'.repeat(30) });
    if (u.includes('/gizmos/snorlax/sidebar')) {
      return json({ items: [{ gizmo: { gizmo: { id: 'g-p-1', display: { name: 'Project Two' } } } }] });
    }
    if (u.includes('/gizmos/g-p-1/conversations')) return new Response('nope', { status: 500 });
    const offset = Number(new URL(u, 'https://chatgpt.com').searchParams.get('offset'));
    return json({ items: offset === 0 ? [{ id: chatId('flat'), title: 'f', create_time: null, update_time: null }] : [], total: 1 });
  }) as never;

  const inv = await listAll();
  assert.equal(inv.complete, false);
  assert.deepEqual(inv.unreadProjects, ['Project Two']);
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}
