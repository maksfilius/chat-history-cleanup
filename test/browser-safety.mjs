// Real Chromium DOM/isolated-world checks with synthetic data and blocked page networking.
// Run after npm run build: CHROME_BIN=/path/to/chrome node test/browser-safety.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseline = process.argv.includes('--baseline');
const installCheck = process.argv.includes('--check-install');
const ownershipCheck = !process.argv.includes('--skip-queue-ownership');
const screenshots = process.argv.includes('--screenshots');
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
  // Permit bundled data-URL images while continuing to block all remote page traffic.
  await cdp('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] });
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
  });
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
  const waitFor = (expression, timeout = 2_000) => evaluate(`new Promise((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      if (${expression}) return resolve(true);
      if (performance.now() - started >= ${timeout}) return reject(new Error('Timed out: ' + ${JSON.stringify(expression)}));
      setTimeout(check, 10);
    };
    check();
  })`);
  await evaluate(`
    globalThis.testRoots = [];
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) {
      const root = attach.call(this, options); testRoots.push(root); return root;
    };
    globalThis.mem = {};
    // about:blank has an opaque origin, so native Web Locks reject even in Chrome. Model the
    // exclusive semantics used by the extension while keeping this audit fully offline.
    const heldLocks = new Set();
    const lockWaiters = new Map();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: async (name, options, callback) => {
        if (options?.ifAvailable && heldLocks.has(name)) return callback(null);
        while (heldLocks.has(name)) {
          await new Promise(resolve => {
            const waiters = lockWaiters.get(name) ?? [];
            waiters.push(resolve); lockWaiters.set(name, waiters);
          });
        }
        heldLocks.add(name);
        try { return await callback({ name, mode: 'exclusive' }); }
        finally {
          heldLocks.delete(name);
          for (const resolve of lockWaiters.get(name) ?? []) resolve();
          lockWaiters.delete(name);
        }
      },
    } });
    globalThis.chrome = { runtime: { id: 'synthetic-extension' }, storage: { local: {
      get: async key => structuredClone({ [key]: mem[key] }),
      set: async values => { Object.assign(mem, structuredClone(values)); },
      remove: async key => { delete mem[key]; },
    } } };
    globalThis.writes = [];
    globalThis.inventorySize = 2;
    // The first load deliberately reports one unavailable item. The usable rows and their
    // stable IDs must remain selectable while the omission is disclosed.
    globalThis.reportedInventorySize = 3;
    globalThis.rejectId = null;
    globalThis.archivedIds = new Set();
    globalThis.holdWrites = false;
    globalThis.releaseWrites = [];
    globalThis.fetch = async (path, init = {}) => {
      const url = String(path);
      const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
      if (url.includes('/api/auth/session')) return json({
        accessToken: 'synthetic-token', account: { id: 'synthetic-account' },
      });
      if (init.method === 'PATCH') {
        writes.push({ url, body: JSON.parse(init.body) });
        if (holdWrites) await new Promise(resolve => releaseWrites.push(resolve));
        if (rejectId && url.endsWith(rejectId)) return json({ detail: { code: 'conversation_not_found' } }, 404);
        if (JSON.parse(init.body).is_archived) archivedIds.add(url.split('/').at(-1));
        if (JSON.parse(init.body).is_visible === false) archivedIds.delete(url.split('/').at(-1));
        return json({ success: true });
      }
      if (url.includes('/gizmos/snorlax/sidebar')) return json({ items: [], cursor: null });
      if (url.includes('/conversations?')) {
        const offset = Number(new URL(url).searchParams.get('offset'));
        return json({ total: reportedInventorySize ?? inventorySize, offset, limit: 28, items: offset ? [] : Array.from({ length: inventorySize }, (_, i) => i + 1).map(n => ({
        id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'),
        title: n === 1 ? '<img src=x onerror=alert(1)>' : 'Synthetic B',
        create_time: '2025-01-01T00:00:00Z', update_time: '2025-01-01T00:00:00Z', gizmo_id: null,
        is_starred: false, pinned_time: null, is_archived: false,
      })) });
      }
      if (url.includes('/conversation/')) {
        const id = url.split('/').at(-1);
        return archivedIds.has(id) ? json({ conversation_id: id, is_archived: true })
          : json({ detail: { code: 'conversation_deleted' } }, 404);
      }
      throw new Error('Unexpected synthetic request');
    };
  `);
  await evaluate(`document.body.style.background = '#212121'`);
  await evaluate(bundle);
  const snapshot = async name => {
    if (!screenshots) return;
    await evaluate(`Promise.all([...testRoots.at(-1).querySelectorAll('img.cc-logo')].map(img => img.decode()))`);
    await evaluate(`Promise.all(testRoots.at(-1).getAnimations().map(animation => animation.finished.catch(() => {})))`);
    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    const path = join(profile, name + '.png');
    writeFileSync(path, Buffer.from(shot.data, 'base64'));
    console.log('Screenshot: ' + path);
  };
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
  assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-dlg h3').textContent`),
    'Allow access to your ChatGPT history?');
  assert.match(await evaluate(`testRoots.at(-1).querySelector('.cc-dlg p').textContent`),
    /Data is sent only to ChatGPT, never to the developer/);
  await evaluate(`testRoots.at(-1).querySelector('.cc-ok').click()`);
  assert.equal(await evaluate(`testRoots.at(-1).querySelectorAll('.cc-row').length`), 0,
    'synthetic consent must not authorize history access');
  await click('.cc-ok');
  try {
    await waitFor(`testRoots.at(-1).querySelectorAll('.cc-row').length === 2`);
  } catch (error) {
    console.log(JSON.stringify(await evaluate(`({
      consent: mem.privacyConsentVersion,
      total: testRoots.at(-1).querySelector('.cc-total')?.textContent,
      warning: testRoots.at(-1).querySelector('.cc-warn')?.textContent,
      dialog: testRoots.at(-1).querySelector('.cc-dlg h3')?.textContent,
    })`)));
    throw error;
  }
  assert.equal(await evaluate('testRoots.at(-1).querySelectorAll(".cc-row").length'), 2);
  assert.match(await evaluate(`testRoots.at(-1).querySelector('.cc-warn').textContent`),
    /partial list.*2 verified conversations.*cannot be selected/i);
  assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-chip').disabled`), false,
    'age filters must remain available for safely loaded rows');
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
    await snapshot('selection-buttons');
    await click('.cc-ft button:last-child');
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-dlg h3').textContent`), 'Delete 2 conversations permanently?');
    assert.equal(await evaluate(`testRoots.at(-1).querySelectorAll('.cc-dlg-items li').length`), 2);
    await evaluate(`testRoots.at(-1).querySelector('.cc-ok').click()`);
    assert.equal(await evaluate('writes.length'), 0, 'synthetic confirmation must be ignored');
    await click('.cc-cancel');
    assert.equal(await evaluate('writes.length'), 0, 'cancel must not act');
    assert.equal(await evaluate(`Boolean(testRoots.at(-1).querySelector('.cc-dlg'))`), false,
      'cancel must close the review');
    await click('.cc-row');
    await click('.cc-ft button:last-child');
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-dlg h3').textContent`), 'Delete 1 conversation permanently?');
    await click('.cc-ok');
    await waitFor('writes.length === 1');
    const writes = await evaluate('globalThis.writes');
    assert.equal(writes.length, 1);
    assert.ok(writes[0].url.endsWith('00000000-0000-4000-8000-000000000002'));
    assert.deepEqual(writes[0].body, { is_visible: false });
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-sum').checkVisibility()`), false);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-sum').inert`), true);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-all').disabled`), true);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-none').disabled`), true);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-stat').textContent`), '1 chat deleted');
    assert.equal(await evaluate(`Boolean(testRoots.at(-1).querySelector('.cc-success .cc-check'))`), true);
    assert.equal(await evaluate(`testRoots.at(-1).activeElement?.className`), 'cc-back');
    // Exercise the selection guard directly: even a stale handler cannot select hidden chats.
    await evaluate(`testRoots.at(-1).querySelector('.cc-all').onclick()`);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-sel').textContent`), '0 selected');
    await snapshot('deletion-complete');
    await click('.cc-back');
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-sum').checkVisibility()`), true);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-sum').inert`), false);
    assert.equal(await evaluate(`testRoots.at(-1).querySelectorAll('.cc-row').length`), 1);
    assert.equal(await evaluate(`testRoots.at(-1).querySelectorAll('.cc-row input:checked').length`), 0);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-none').disabled`), true);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-all').disabled`), false);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-note').hidden`), true);
    assert.equal(await evaluate(`testRoots.at(-1).activeElement?.className`), 'cc-all');
    await evaluate('reportedInventorySize = null');
    console.log('PASS: success report hides and guards selection; Back to list restores remaining chats with no hidden selection');
    // A saved record we refuse to trust must not be resumed — and must not disable the panel
    // either. Refusing the record and refusing to work are different answers; a user cannot
    // reach chrome.storage, so an unusable record has to be dismissible from here.
    await evaluate('mem.activeBatch = { version: 99 }');
    await click('.cc-x');
    await click('.cc-open');
    assert.match(await evaluate(`testRoots.at(-1).querySelector('.cc-warn').textContent`), /could not be verified/);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-warn').hidden`), false);
    // No resume was offered for it.
    assert.equal(await evaluate(`Boolean(testRoots.at(-1).querySelector('.cc-dlg'))`), false);
    // Cleaning still works: selection and the destructive control stay available.
    await click('.cc-all');
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-ft button:last-child').disabled`), false,
      'a refused saved record must not brick the panel');
    assert.equal(await evaluate('globalThis.writes.length'), 1, 'and it must not act on its own');
    // Discard removes the record and only then hides the notice.
    await click('.cc-warn button');
    assert.equal(await evaluate(`'activeBatch' in mem`), false, 'discard must actually clear storage');
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-warn').hidden`), true);
    await click('.cc-none');
    console.log('PASS: malicious title, isolated globals, synthetic selection/confirmation rejection, trusted selection, cancel, exact count and target');
    console.log('PASS: a refused saved record is not resumed, does not disable the panel, and is dismissible');
    if (ownershipCheck) {
      // Closing and reopening the panel must never create a second destructive worker: the
      // cross-tab lease cannot catch this, because the reopened panel is the same owner.
      // All requests here remain synthetic.
      await evaluate('writes = []; holdWrites = true; inventorySize = 4');
      await click('.cc-x');
      await click('.cc-open');
      await click('.cc-all');
      await click('.cc-ft button:last-child');
      await click('.cc-ok');
      await waitFor('writes.length === 2');
      assert.equal(await evaluate('writes.length'), 2, 'the panel enables two deletion slots');
      assert.equal(await evaluate('new Set(writes.map(write => write.url)).size'), 2);
      assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-sum').checkVisibility()`), false,
        'selection must also be hidden while work is running');
      await click('.cc-stop');
      assert.match(await evaluate(`testRoots.at(-1).querySelector('.cc-stat').textContent`), /Stopping/);
      await click('.cc-x');
      await click('.cc-open');
      const resumeTitle = await evaluate(`testRoots.at(-1).querySelector('.cc-dlg h3')?.textContent`);
      if (resumeTitle?.startsWith('Resume')) await click('.cc-ok');
      const inFlight = await evaluate('writes');
      console.log(JSON.stringify({ ownershipCheck: 'active requests after reopen/resume', inFlight }));
      assert.equal(inFlight.length, 2, 'closing/reopening must not start another queue');
      await evaluate('holdWrites = false; releaseWrites.splice(0).forEach(resolve => resolve())');
      await waitFor(`mem.activeBatch?.ops?.filter(op => op.state === 'done').length === 2`);
      assert.equal(await evaluate('writes.length'), 2, 'Stop prevents dispatch of the other two chats');
      assert.deepEqual(await evaluate('mem.activeBatch.ops.map(op => op.state)'), ['done', 'done', 'queued', 'queued']);
      await click('.cc-x');
      await click('.cc-open');
      assert.match(await evaluate(`testRoots.at(-1).querySelector('.cc-dlg h3').textContent`), /^Resume/);
      await click('.cc-ok');
      await waitFor('writes.length === 4');
      assert.equal(await evaluate('writes.length'), 4, 'Resume sends only the remaining chats');
      assert.equal(await evaluate('new Set(writes.map(write => write.url)).size'), 4, 'no target is repeated');
      assert.equal(await evaluate(`'activeBatch' in mem`), false, 'the completed record is removed after all saves');
      assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-stat').textContent`), '4 chats deleted');
      console.log('PASS: two deletion slots, Stop, reopen ownership, durable progress and Resume without repeated targets');
    }

    await click('.cc-x');
    await evaluate(`inventorySize = 2; rejectId = '00000000-0000-4000-8000-000000000002'`);
    await click('.cc-open');
    await click('.cc-all');
    await click('.cc-ft button:last-child');
    await click('.cc-ok');
    await waitFor(`testRoots.at(-1).querySelector('.cc-result-kicker')?.textContent === 'Cleanup needs attention'`);
    assert.equal(await evaluate(`Boolean(testRoots.at(-1).querySelector('.cc-success'))`), false);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-result-kicker').textContent`), 'Cleanup needs attention');
    assert.match(await evaluate(`testRoots.at(-1).querySelector('.cc-result-copy').textContent`), /1 of 2 chats deleted. 1 failed/);
    assert.match(await evaluate(`testRoots.at(-1).querySelector('.cc-fail').textContent`), /Synthetic B — conversation no longer exists/);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-sum').checkVisibility()`), false);
    await snapshot('partial-failure');
    await click('.cc-back');
    assert.equal(await evaluate(`testRoots.at(-1).querySelectorAll('.cc-row').length`), 1);

    // Archive gets its own accurate success copy and honors reduced-motion preferences.
    await evaluate('rejectId = null');
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await click('.cc-all');
    await click('.cc-ft button:first-child');
    await click('.cc-ok');
    await waitFor(`testRoots.at(-1).querySelector('.cc-stat')?.textContent === '1 chat archived'`);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-stat').textContent`), '1 chat archived');
    assert.match(await evaluate(`testRoots.at(-1).querySelector('.cc-result-copy').textContent`), /restore these chats/);
    assert.equal(await evaluate(`getComputedStyle(testRoots.at(-1).querySelector('.cc-check')).animationName`), 'none');
    await snapshot('archive-complete');
    await click('.cc-back');
    assert.equal(await evaluate(`testRoots.at(-1).querySelectorAll('.cc-row').length`), 0);
    assert.equal(await evaluate(`Boolean(testRoots.at(-1).querySelector('.cc-empty'))`), true);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-all').disabled`), true);

    // A stopped batch must show the unprocessed count and must never celebrate completion.
    await click('.cc-x');
    await evaluate('inventorySize = 4; holdWrites = true');
    await click('.cc-open');
    await click('.cc-all');
    await click('.cc-ft button:last-child');
    await click('.cc-ok');
    await waitFor('releaseWrites.length === 2');
    await click('.cc-stop');
    await evaluate('holdWrites = false; releaseWrites.splice(0).forEach(resolve => resolve())');
    await waitFor(`testRoots.at(-1).querySelector('.cc-result-kicker')?.textContent === 'Cleanup paused'`);
    assert.equal(await evaluate(`Boolean(testRoots.at(-1).querySelector('.cc-success'))`), false);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-result-kicker').textContent`), 'Cleanup paused');
    assert.match(await evaluate(`testRoots.at(-1).querySelector('.cc-result-copy').textContent`), /2 of 4 chats deleted. 2 not processed/);
    assert.equal(await evaluate(`testRoots.at(-1).querySelector('.cc-sum').checkVisibility()`), false);
    await snapshot('cleanup-paused');
    console.log('PASS: partial failure and Stop show truthful reports; archive success, reduced motion and empty list work');
  }
} finally {
  clearTimeout(deadline);
  await send('Browser.close').catch(() => {});
  browser.kill();
  console.log(`Disposable browser profile retained at ${profile}`);
}
