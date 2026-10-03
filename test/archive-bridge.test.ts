import test from 'node:test';
import assert from 'node:assert/strict';

const id = '00000000-0000-4000-8000-000000000001';
const origin = 'https://chatgpt.com';
let handler: (event: unknown) => void;
let reply: (value: any) => void;
let transport: typeof fetch;
const requests: { path: string; init: RequestInit }[] = [];
const fakeWindow = {
  location: { origin },
  fetch: ((path: string, init: RequestInit) => {
    requests.push({ path, init });
    return transport(path, init);
  }) as typeof fetch,
  addEventListener: (_type: string, listener: typeof handler) => { handler = listener; },
  postMessage: (value: any) => reply(value),
};
Object.assign(globalThis, { window: fakeWindow });
await import('../src/content/pageBridge.ts');
const json = (value: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(value), { status, headers });
const session = (account = 'reviewed-account') => json({ accessToken: 'private-token', account: { id: account } });
const request = (overrides = {}) => ({ channel: 'chat-cleanup-bridge', type: 'archive',
  requestId: 'test-request', id, accountId: 'reviewed-account', ...overrides });
const send = (data = request()) => new Promise<any>(resolve => {
  reply = resolve;
  handler({ source: fakeWindow, origin, data });
});

test('archive bridge binds the fresh session and PATCH to the reviewed account', async () => {
  requests.length = 0;
  transport = async path => String(path).includes('/session') ? session() : json({ success: true });
  const result = await send();
  assert.equal(result.ok, true);
  assert.equal(requests.length, 2);
  const write = requests[1];
  assert.equal(write.path, `/backend-api/conversation/${id}`);
  assert.equal(write.init.method, 'PATCH');
  assert.equal(new Headers(write.init.headers).get('ChatGPT-Account-ID'), 'reviewed-account');
  assert.equal(new Headers(write.init.headers).get('Authorization'), 'Bearer private-token');
  assert.deepEqual(JSON.parse(write.init.body as string), { is_archived: true });
  assert.equal(write.init.redirect, 'error');
  assert.equal(JSON.stringify(result).includes('private-token'), false);
});

test('changed or missing workspace prevents the write, even if isolated session was cached', async () => {
  for (const body of [{ accessToken: 'token', account: { id: 'other' } }, { accessToken: 'token' }]) {
    requests.length = 0;
    transport = async () => json(body);
    const result = await send();
    assert.equal(result.ok, false);
    assert.match(result.code, /account_changed|account_context_missing/);
    assert.equal(requests.length, 1);
  }
});

test('HTTP 200 with false, missing or malformed success is not accepted', async () => {
  for (const response of [json({ success: false }), json({}), new Response('not json'), json({ success: 'true' })]) {
    transport = async path => String(path).includes('/session') ? session() : response;
    const result = await send();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_write_response');
  }
});

test('one 401 refreshes session and rechecks account; 429 propagates Retry-After without retry', async () => {
  let writes = 0;
  transport = async path => String(path).includes('/session') ? session()
    : (++writes === 1 ? json({}, 401) : json({ success: true }));
  assert.equal((await send()).ok, true);
  assert.equal(writes, 2);
  let reads = 0;
  writes = 0;
  transport = async path => String(path).includes('/session') ? session(++reads === 1 ? 'reviewed-account' : 'other')
    : (++writes, json({}, 401));
  assert.equal((await send()).code, 'account_changed');
  assert.equal(writes, 1);
  writes = 0;
  transport = async path => String(path).includes('/session') ? session()
    : (++writes, json({ detail: { code: 'rate_limit' } }, 429, { 'Retry-After': '12' }));
  const result = await send();
  assert.equal(result.status, 429);
  assert.equal(result.retryAfterMs, 12_000);
  assert.equal(writes, 1);
});

test('malformed, foreign-origin and destructive messages never reach fetch', () => {
  requests.length = 0;
  for (const data of [null, request({ type: 'remove' }), request({ id: '../bad' }),
    request({ accountId: undefined }), request({ requestId: '' })]) {
    handler({ source: fakeWindow, origin, data });
  }
  handler({ source: {}, origin, data: request() });
  handler({ source: fakeWindow, origin: 'https://other.example', data: request() });
  assert.equal(requests.length, 0);
});

test('timeout aborts a slow session and cannot start a late PATCH', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  requests.length = 0;
  let release: (value: Response) => void;
  transport = async () => new Promise<Response>(resolve => { release = resolve; });
  const result = send();
  t.mock.timers.tick(18_000);
  assert.equal(requests[0].init.signal?.aborted, true);
  release!(session());
  assert.equal((await result).code, 'request_timeout');
  assert.equal(requests.length, 1);
  t.mock.timers.reset();
});
