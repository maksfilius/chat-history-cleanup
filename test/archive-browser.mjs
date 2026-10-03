// Separate MAIN/ISOLATED worlds, real reload, synthetic backend outside the page.
// No ChatGPT account or external network is used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const id = '00000000-0000-4000-8000-000000000001';
const { outputFiles } = await build({
  stdin: { contents: `import { apiAdapterFor, listAll } from './src/chatgpt/api.ts';
    globalThis.testApi = { archive: () => apiAdapterFor('reviewed-account').archive('${id}'), listAll };`,
    resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'iife', target: 'chrome120',
});
const apiBundle = outputFiles[0].text;
const bridge = readFileSync('dist/pageBridge.js', 'utf8');
const browser = spawn(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cc-archive-'))}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
browser.stderr.on('data', () => {});
let sequence = 0, buffer = '', sessionId;
const pending = new Map();
let backendArchived = false, backendAccount = 'reviewed-account', malformed = false;
const writes = [];
let networkError;
const send = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
  const requestId = ++sequence;
  pending.set(requestId, { resolve, reject });
  browser.stdio[3].write(JSON.stringify({ id: requestId, method, params, sessionId: session }) + '\0');
});
async function serve(event) {
  const { requestId, request } = event.params;
  const url = new URL(request.url);
  let result, status = 200, contentType = 'application/json';
  if (url.origin !== 'https://chatgpt.com') throw new Error('Unexpected remote origin');
  if (url.pathname === '/') { result = '<!doctype html><title>Archive fixture</title>'; contentType = 'text/html'; }
  else if (url.pathname === '/api/auth/session') result = { accessToken: 'test-token', account: { id: backendAccount } };
  else if (request.method === 'PATCH') {
    assert.equal(url.pathname, `/backend-api/conversation/${id}`);
    assert.deepEqual(JSON.parse(request.postData), { is_archived: true });
    const headers = new Headers(request.headers);
    assert.equal(headers.get('ChatGPT-Account-ID'), 'reviewed-account');
    assert.equal(headers.get('Authorization'), 'Bearer test-token');
    writes.push(request.url);
    if (!malformed) backendArchived = true;
    result = { success: !malformed };
  } else if (url.pathname === '/backend-api/conversations') {
    const archived = url.searchParams.get('is_archived') === 'true';
    const items = backendArchived === archived ? [{ id, title: 'Disposable fixture',
      create_time: '2025-01-01T00:00:00Z', update_time: '2025-01-01T00:00:00Z',
      gizmo_id: null, is_starred: false, pinned_time: null, is_archived: backendArchived }] : [];
    result = { items, total: items.length, offset: 0, limit: 28 };
  } else if (url.pathname === '/backend-api/gizmos/snorlax/sidebar') result = { items: [], cursor: null };
  else { result = {}; status = 404; }
  await send('Fetch.fulfillRequest', { requestId, responseCode: status,
    responseHeaders: [{ name: 'Content-Type', value: contentType }],
    body: Buffer.from(typeof result === 'string' ? result : JSON.stringify(result)).toString('base64'),
  }, event.sessionId);
}
browser.stdio[4].on('data', chunk => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\0')) !== -1) {
    const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    if (message.method === 'Fetch.requestPaused') {
      serve(message).catch(error => { networkError = error; });
      continue;
    }
    const callback = pending.get(message.id);
    if (!callback) continue;
    pending.delete(message.id);
    message.error ? callback.reject(new Error(JSON.stringify(message.error))) : callback.resolve(message.result);
  }
});
const deadline = setTimeout(() => { browser.kill(); throw networkError ?? new Error('Archive browser test timed out'); }, 30_000);
let contextId;
async function evaluate(expression, isolated = true) {
  if (networkError) throw networkError;
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true,
    ...(isolated ? { contextId } : {}) });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function isolate() {
  const { frameTree } = await send('Page.getFrameTree');
  ({ executionContextId: contextId } = await send('Page.createIsolatedWorld', {
    frameId: frameTree.frame.id, worldName: 'archive-test',
  }));
  await evaluate(`const isolatedFetch = fetch;
    globalThis.fetch = (url, init = {}) => {
      if (init.method === 'PATCH') throw new Error('Archive regressed to ISOLATED');
      return isolatedFetch(url, init);
    };`);
  await evaluate(apiBundle);
}
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, undefined);
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, undefined));
  await send('Page.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: bridge });
  await send('Page.navigate', { url: 'https://chatgpt.com/' });
  await isolate();
  assert.equal(await evaluate('testApi.listAll().then(inventory => inventory.total)'), 1);
  await evaluate('testApi.archive()');
  assert.equal(writes.length, 1);
  assert.equal(backendArchived, true);
  // Navigating again destroys both JS worlds and their cached state, just like a reload.
  await send('Page.navigate', { url: 'https://chatgpt.com/?reload=1' });
  await isolate();
  assert.equal(await evaluate('testApi.listAll().then(inventory => inventory.total)'), 0,
    'fresh history after navigation must not resurrect the archived chat');
  assert.equal(await evaluate(`fetch('/backend-api/conversations?is_archived=true', {
    headers: { Authorization: 'Bearer test-token', 'ChatGPT-Account-ID': 'reviewed-account' }
  }).then(response => response.json()).then(body => body.items[0].id)`, false), id);
  assert.equal(writes.length, 1, 'reload does not replay a write');
  console.log('PASS: MAIN archive changes backend state; fresh page lists it only in archive');
  backendArchived = false; malformed = true;
  assert.equal(await evaluate(`testApi.archive().then(() => 'accepted', e => e.code)`), 'invalid_write_response');
  assert.equal(backendArchived, false);
  const beforeSwitch = writes.length;
  backendAccount = 'different-account';
  assert.equal(await evaluate(`testApi.archive().then(() => 'accepted', e => e.code)`), 'account_changed');
  assert.equal(writes.length, beforeSwitch, 'cached isolated session cannot bypass bridge account validation');
  console.log('PASS: false-success response is rejected; workspace switch sends no PATCH');
  if (networkError) throw networkError;
} finally {
  clearTimeout(deadline);
  browser.kill();
}
