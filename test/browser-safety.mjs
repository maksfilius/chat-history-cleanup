// Real Chromium DOM/isolated-world checks with synthetic data and blocked page networking.
// Run after npm run build: CHROME_BIN=/path/to/chrome node test/browser-safety.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseline = process.argv.includes('--baseline');
const installCheck = process.argv.includes('--check-install');
const ownershipCheck = process.argv.includes('--check-queue-ownership');
const profile = mkdtempSync(join(tmpdir(), 'chat-cleanup-browser-audit-'));
const browser = spawn(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  ...(installCheck ? ['--enable-unsafe-extension-debugging'] : ['--disable-extensions']),
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--disable-default-apps', '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
const pending = new Map();
let seq = 0;
let buffer = '';
browser.stdio[4].on('data', chunk => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const callback = pending.get(message.id);
    if (callback) {
      pending.delete(message.id);
      message.error ? callback.reject(new Error(JSON.stringify(message.error))) : callback.resolve(message.result);
    }
  }
});
browser.stderr.on('data', () => {});
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
}
const deadline = setTimeout(() => { browser.kill(); throw new Error('Browser audit timed out'); }, 30_000);
const bundle = readFileSync(new URL('../dist/content.js', import.meta.url), 'utf8');

try {
  console.log(JSON.stringify(await send('Browser.getVersion')));
  if (installCheck) {
    const installed = await send('Extensions.loadUnpacked', {
      path: fileURLToPath(new URL('../dist', import.meta.url)),
    });
    assert.equal(typeof installed.id, 'string');
    console.log('PASS: production manifest/bundle accepted as an unpacked Chrome extension');
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  await cdp('Network.enable');
  await cdp('Network.setBlockedURLs', { urls: ['*'] });
  await cdp('Page.enable');
  const { frameTree } = await cdp('Page.getFrameTree');
  const { executionContextId } = await cdp('Page.createIsolatedWorld', {
    frameId: frameTree.frame.id, worldName: 'chat-cleanup-test',
  });
  const evaluate = async (expression, isolated = true) => {
    const result = await cdp('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
      ...(isolated ? { contextId: executionContextId } : {}),
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await evaluate(`
    globalThis.testRoots = [];
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) {
      const root = attach.call(this, options); testRoots.push(root); return root;
    };
    globalThis.mem = {};
    globalThis.chrome = { runtime: { id: 'synthetic-extension' }, storage: { local: {
      get: async key => structuredClone({ [key]: mem[key] }),
      set: async values => { Object.assign(mem, structuredClone(values)); },
      remove: async key => { delete mem[key]; },
    } } };
    globalThis.writes = [];
    globalThis.holdWrites = false;
    globalThis.releaseWrites = [];
    globalThis.fetch = async (path, init = {}) => {
      const url = String(path);
      const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
      if (url.includes('/api/auth/session')) return json({ accessToken: 'synthetic-token' });
      if (init.method === 'PATCH') {
        writes.push({ url, body: JSON.parse(init.body) });
        if (holdWrites) await new Promise(resolve => releaseWrites.push(resolve));
        return json({ success: true });
      }
      if (url.includes('/gizmos/snorlax/sidebar')) return json({ items: [], cursor: null });
      if (url.includes('/conversations?')) return json({ total: 2, offset: 0, limit: 28, items: [1, 2].map(n => ({
        id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'),
        title: n === 1 ? '<img src=x onerror=alert(1)>' : 'Synthetic B',
        create_time: null, update_time: null, gizmo_id: null,
        is_starred: false, pinned_time: null, is_archived: false,
      })) });
      if (url.includes('/conversation/')) return json({ detail: { code: 'conversation_deleted' } }, 404);
      throw new Error('Unexpected synthetic request');
    };
  `);
  await evaluate(bundle);
  const click = async selector => {
    const point = await evaluate(`(() => {
      const el = testRoots.at(-1).querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Missing test control');
      const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    await evaluate('new Promise(resolve => setTimeout(resolve, 0))');
  };
  await click('.cc-open');
  assert.equal(await evaluate('testRoots.at(-1).querySelectorAll(".cc-row").length'), 2);
  assert.equal(await evaluate('testRoots.at(-1).querySelectorAll(".cc-t img").length'), 0, 'titles must be text');
  // Execute in the PAGE world: isolated JS globals must not be visible, shared DOM still is.
  const pageResult = await evaluate(`(async () => {
    const root = document.getElementById('chat-cleanup-root').shadowRoot;
    if (!root) return { accessible: false, devHook: typeof window.__chatCleanup };
    root.querySelector('.cc-all').click();
    root.querySelector('.cc-ft button:last-child').click();
    root.querySelector('.cc-ok').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    return { accessible: true, devHook: typeof window.__chatCleanup };
  })()`, false);
  const forgedWrites = await evaluate('writes.length');
  console.log(JSON.stringify({ pageResult, forgedWrites }));
  if (!baseline) {
    assert.equal(forgedWrites, 0, 'page-generated events must never authorize a destructive write');
    // Also exercise the event gate with a root reference obtained by the test-only harness.
    await evaluate(`testRoots.at(-1).querySelector('.cc-all').click()`);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-sel').textContent`), '0 selected');
    await click('.cc-all');
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-sel').textContent`), '2 selected');
    await click('.cc-ft button:last-child');
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-dlg h3').textContent`), 'Delete 2 conversations permanently?');
    await evaluate(`testRoots.at(-1).querySelector('.cc-ok').click()`);
    assert.equal(await evaluate('writes.length'), 0, 'synthetic confirmation must be ignored');
    await click('.cc-cancel');
    assert.equal(await evaluate('writes.length'), 0, 'cancel must not act');
    await click('.cc-row input');
    await click('.cc-ft button:last-child');
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-dlg h3').textContent`), 'Delete 1 conversation permanently?');
    await click('.cc-ok');
    const writes = await evaluate('globalThis.writes');
    assert.equal(writes.length, 1);
    assert.ok(writes[0].url.endsWith('00000000-0000-4000-8000-000000000002'));
    assert.deepEqual(writes[0].body, { is_visible: false });
    // Reopening must not make stale inventory actionable after saved-state validation fails.
    await evaluate('mem.activeBatch = { version: 99 }');
    await click('.cc-x');
    await click('.cc-open');
    await click('.cc-all');
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-ft button:last-child').disabled`), true);
    assert.equal(await evaluate('globalThis.writes.length'), 1);
    assert.match(await evaluate(`testRoots.at(-1).querySelector('.cc-warn').textContent`), /Invalid or unsupported/);
    await evaluate('delete mem.activeBatch');
    console.log('PASS: malicious title, isolated globals, synthetic selection/confirmation rejection, trusted selection, cancel, exact count and target');
    console.log('PASS: invalid saved state cannot reactivate an old inventory');
    if (ownershipCheck) {
      // A release regression: closing/reopening must never create a second active owner.
      // Currently expected to FAIL (audit F06). All requests here remain synthetic.
      await evaluate('writes = []; holdWrites = true');
      await click('.cc-x');
      await click('.cc-open');
      await click('.cc-all');
      await click('.cc-ft button:last-child');
      await click('.cc-ok');
      assert.equal(await evaluate('writes.length'), 1);
      await click('.cc-x');
      await click('.cc-open');
      const resumeTitle = await evaluate(`testRoots.at(-1).querySelector('.cc-dlg h3')?.textContent`);
      if (resumeTitle?.startsWith('Resume')) await click('.cc-ok');
      const inFlight = await evaluate('writes');
      console.log(JSON.stringify({ ownershipCheck: 'active requests after reopen/resume', inFlight }));
      assert.equal(inFlight.length, 1, 'closing/reopening must not start a second destructive worker');
    }
  }
} finally {
  clearTimeout(deadline);
  await send('Browser.close').catch(() => {});
  browser.kill();
  console.log(`Disposable browser profile retained at ${profile}`);
}
