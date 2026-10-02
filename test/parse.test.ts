import assert from 'node:assert/strict';
import test from 'node:test';
import { parseConversationHref } from '../src/chatgpt/selectors.ts';
import { ApiError, archiveViaPage, forgetToken, listAll, listProjects, mapApiItem } from '../src/chatgpt/api.ts';
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

test('malformed project metadata fails safe instead of looking unprotected', () => {
  const base = { id: UUID, title: 't', create_time: null, update_time: null };
  assert.equal(mapApiItem({ ...base, gizmo_id: 'g-p-!' } as never).projectId, undefined);
  assert.equal(mapApiItem({ ...base, gizmo_id: { unexpected: true } } as never).projectId, undefined);
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

test('listAll pages, dedupes, excludes gaps, and explains an incomplete inventory', async () => {
  const items = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: chatId(from + i), title: 't', create_time: null, update_time: null,
    }));
  const pages: Record<number, unknown[]> = { 0: items(0, 28), 28: items(28, 28), 56: items(50, 6) };
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/api/auth/session')) {
      return json({ accessToken: 'x'.repeat(30), account: { id: 'account-1' } });
    }
    if (u.includes('/gizmos/snorlax/sidebar')) return json({ items: [] });
    const offset = Number(new URL(u, 'https://chatgpt.com').searchParams.get('offset'));
    return json({ items: pages[offset] ?? [], total: 62, limit: 28, offset });
  }) as never;

  const inv = await listAll();
  // 6 of the third page's ids overlap page 2 (an item shifting pages mid-run), so 56 unique.
  assert.equal(inv.conversations.length, 56);
  assert.equal(inv.complete, false);
  assert.deepEqual(inv.issues, [
    'ChatGPT did not return every conversation reported by the history list.',
  ]);
});

test('a moving total is accepted when pagination reaches the current complete list', async () => {
  const items = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: chatId(from + i), title: 't', create_time: null, update_time: null,
    }));
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/api/auth/session')) {
      return json({ accessToken: 'x'.repeat(30), account: { id: 'account-1' } });
    }
    if (u.includes('/gizmos/snorlax/sidebar')) return json({ items: [] });
    const offset = Number(new URL(u, 'https://chatgpt.com').searchParams.get('offset'));
    return offset === 0
      ? json({ items: items(0, 28), total: 33, limit: 28, offset })
      : json({ items: items(28, 6), total: 34, limit: 28, offset });
  }) as never;

  const inv = await listAll();
  assert.equal(inv.total, 34);
  assert.equal(inv.complete, true);
  assert.deepEqual(inv.issues, []);
});

test('listProjects follows the current cursor pagination and ignores non-project gizmos', async () => {
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/api/auth/session')) {
      return json({ accessToken: 'x'.repeat(30), account: { id: 'account-1' } });
    }
    const cursor = new URL(u, 'https://chatgpt.com').searchParams.get('cursor');
    return cursor === null
      ? json({
          items: [
            { gizmo: { gizmo: { id: 'g-p-1', display: { name: 'Project One' } } } },
            { gizmo: { gizmo: { id: 'g-custom-1', display: { name: 'Custom GPT' } } } },
          ],
          cursor: 'next page',
        })
      : json({
          items: [{ gizmo: { gizmo: { id: 'g-p-2', display: { name: 'Project Two' } } } }],
          cursor: null,
        });
  }) as never;

  assert.deepEqual(await listProjects(), [
    { id: 'g-p-1', name: 'Project One' },
    { id: 'g-p-2', name: 'Project Two' },
  ]);
});

test('listAll includes project conversations the flat listing omits', async () => {
  // The flat endpoint returns 1 conversation; the project holds 2 more that it never lists.
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/api/auth/session')) {
      return json({ accessToken: 'x'.repeat(30), account: { id: 'account-1' } });
    }
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
    return json({
      items: offset === 0 ? [{ id: chatId('flat'), title: 'f', create_time: null, update_time: null }] : [],
      total: 1,
      limit: 28,
      offset,
    });
  }) as never;

  const inv = await listAll();
  assert.deepEqual(inv.conversations.map((c) => c.id).sort(), ['flat', 'p1', 'p2'].map(chatId).sort());
  assert.equal(inv.total, 3);
  assert.equal(inv.complete, true);
  // Project conversations carry their project id, which makes them protected downstream.
  assert.equal(inv.conversations.find((c) => c.id === chatId('p1'))!.projectId, 'g-p-1');
});

test('a project that cannot be read makes the inventory incomplete and is named', async () => {
  // The gap must be explicit, while the safely loaded flat chat remains available for review.
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/api/auth/session')) {
      return json({ accessToken: 'x'.repeat(30), account: { id: 'account-1' } });
    }
    if (u.includes('/gizmos/snorlax/sidebar')) {
      return json({ items: [{ gizmo: { gizmo: { id: 'g-p-1', display: { name: 'Project Two' } } } }] });
    }
    if (u.includes('/gizmos/g-p-1/conversations')) return new Response('nope', { status: 500 });
    const offset = Number(new URL(u, 'https://chatgpt.com').searchParams.get('offset'));
    return json({
      items: offset === 0 ? [{ id: chatId('flat'), title: 'f', create_time: null, update_time: null }] : [],
      total: 1,
      limit: 28,
      offset,
    });
  }) as never;

  const inv = await listAll();
  assert.equal(inv.complete, false);
  assert.deepEqual(inv.unreadProjects, ['Project Two']);
  assert.deepEqual(inv.issues, ['Some Project conversations could not be read and were excluded.']);
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

test('a rate-limited page is retried instead of failing the whole inventory', async () => {
  // ChatGPT's limiter rejects bursts while still serving single requests, and loading the
  // inventory is a burst. One 429 used to throw the entire load away.
  const items = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: chatId(from + i), title: 't', create_time: null, update_time: null,
    }));
  let rejections = 0;
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/api/auth/session')) {
      return json({ accessToken: 'x'.repeat(30), account: { id: 'account-1' } });
    }
    if (u.includes('/gizmos/snorlax/sidebar')) return json({ items: [] });
    if (rejections++ < 1) return new Response(JSON.stringify({}), { status: 429 });
    const offset = Number(new URL(u, 'https://chatgpt.com').searchParams.get('offset'));
    return json({ items: offset ? [] : items(0, 3), total: 3, limit: 28, offset });
  }) as never;
  forgetToken();

  const inv = await listAll();
  assert.equal(inv.conversations.length, 3);
  assert.equal(inv.complete, true);
  assert.ok(rejections > 1, 'the rejected page must have been asked for again');
});

test('a persistent rate limit is not hammered: one retry, then report', async () => {
  // Four retries against an endpoint that is out of budget is four more rejections, and the
  // account stays blocked longer. A burst collision clears on the first retry.
  let attempts = 0;
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/api/auth/session')) {
      return json({ accessToken: 'x'.repeat(30), account: { id: 'account-1' } });
    }
    if (u.includes('/gizmos/snorlax/sidebar')) return json({ items: [] });
    attempts++;
    return new Response(JSON.stringify({}), { status: 429 });
  }) as never;
  forgetToken();

  await assert.rejects(listAll(), /429/);
  assert.equal(attempts, 2);
});

// --- page bridge: archiving leaves the isolated world, so the protocol needs pinning

function fakeWindow() {
  const listeners: ((e: { source: unknown; data: unknown }) => void)[] = [];
  const posted: Record<string, unknown>[] = [];
  const win = {
    origin: 'https://chatgpt.com',
    addEventListener: (_: string, fn: (e: { source: unknown; data: unknown }) => void) => { listeners.push(fn); },
    removeEventListener: (_: string, fn: unknown) => {
      const i = listeners.indexOf(fn as never);
      if (i >= 0) listeners.splice(i, 1);
    },
    postMessage: (data: Record<string, unknown>) => { posted.push(data); },
  };
  return { win, posted, deliver: (data: unknown) => listeners.slice().forEach((fn) => fn({ source: win, data })) };
}

test('the bridge resolves on its own reply and ignores everything else', async () => {
  const { win, posted, deliver } = fakeWindow();
  (globalThis as { window?: unknown }).window = win;
  globalThis.fetch = (async () =>
    json({ accessToken: 'x'.repeat(30), account: { id: 'account-1' } })) as never;
  forgetToken();

  const pending = archiveViaPage(UUID);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, 'archive');
  assert.equal(posted[0].id, UUID);

  // Another extension's chatter, and a reply for a different request, must not settle ours.
  deliver({ channel: 'someone-else', type: 'result', requestId: posted[0].requestId, ok: true });
  deliver({ channel: 'chat-cleanup-bridge', type: 'result', requestId: 'not-ours', ok: true });
  deliver({ channel: 'chat-cleanup-bridge', type: 'result', requestId: posted[0].requestId, ok: true });
  await pending;
  delete (globalThis as { window?: unknown }).window;
});

test('a bridge failure surfaces as the status the page saw', async () => {
  const { win, posted, deliver } = fakeWindow();
  (globalThis as { window?: unknown }).window = win;
  globalThis.fetch = (async () =>
    json({ accessToken: 'x'.repeat(30), account: { id: 'account-1' } })) as never;
  forgetToken();

  const pending = archiveViaPage(UUID);
  await new Promise((r) => setTimeout(r, 0));
  deliver({ channel: 'chat-cleanup-bridge', type: 'result', requestId: posted[0].requestId,
    ok: false, status: 404, code: 'conversation_not_found' });
  await assert.rejects(pending, (e: ApiError) => e.status === 404 && e.code === 'conversation_not_found');
  delete (globalThis as { window?: unknown }).window;
});

test('a malformed id never reaches the page', async () => {
  const { win, posted } = fakeWindow();
  (globalThis as { window?: unknown }).window = win;
  await assert.rejects(archiveViaPage('../conversation/' + UUID), /Invalid conversation identifier/);
  assert.equal(posted.length, 0);
  delete (globalThis as { window?: unknown }).window;
});
