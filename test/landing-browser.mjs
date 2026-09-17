// Exercise the offline landing draft in a disposable Chrome profile. No account or server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const profile = mkdtempSync(join(tmpdir(), 'chat-cleanup-landing-'));
const browser = spawn(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--disable-default-apps', '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let seq = 0;
let buffer = '';
const pending = new Map();
const failures = [];
const requests = [];
browser.stdio[4].on('data', chunk => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (message.method === 'Runtime.exceptionThrown') failures.push(message.params.exceptionDetails);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
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
const deadline = setTimeout(() => { browser.kill(); throw new Error('Landing check timed out'); }, 45_000);
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Network.enable');
  await cdp('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.demoRoots = [];
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) {
      const root = attach.call(this, options); demoRoots.push(root); return root;
    };
  ` });
  await cdp('Page.navigate', { url: new URL('../landing/index.html', import.meta.url).href });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async expression => {
    const expires = Date.now() + 12000;
    while (!(await evaluate(expression))) {
      if (Date.now() > expires) {
        console.log(JSON.stringify({ failures, ui: await evaluate(`({result: document.querySelector('#result-title')?.textContent, progress: document.querySelector('#progress-counter')?.textContent, dialog: document.querySelector('#confirm-dialog')?.open, count: document.querySelector('#history-count')?.textContent})`) }));
        throw new Error('Timed out: ' + expression);
      }
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  };
  const ui = expression => evaluate(`(() => { const root = window.demoRoots.at(-1); return (${expression}); })()`);
  const click = async (selector, modifiers = 0) => {
    const point = await evaluate(`(() => {
      const scope = ${JSON.stringify(selector)}.startsWith('.cc-') ? window.demoRoots.at(-1) : document;
      const element = scope.querySelector(${JSON.stringify(selector)});
      if (!element || !element.checkVisibility() || element.disabled) throw new Error('Unavailable control: ' + ${JSON.stringify(selector)});
      element.scrollIntoView({ block: 'nearest' });
      const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, modifiers, ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, modifiers, ...point });
    await new Promise(resolve => setTimeout(resolve, 40));
  };
  const waitUi = expression => waitFor(`(() => { const root = window.demoRoots?.at(-1); return root && (${expression}); })()`);
  const screenshot = async name => {
    await new Promise(resolve => setTimeout(resolve, 350));
    const result = await cdp('Page.captureScreenshot', { format: 'png' });
    const path = join(profile, name + '.png');
    writeFileSync(path, Buffer.from(result.data, 'base64'));
    console.log('Screenshot: ' + path);
  };
  await waitFor(`document.querySelectorAll('.history-row').length === 30`);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.equal(await evaluate(`document.querySelector('#mobile-menu').checkVisibility()`), false);
  assert.ok(await evaluate(`document.querySelector('#intro').innerText.split(/\\s+/).length < 25`));
  await screenshot('desktop-intro');
  await click('.cc-open');
  assert.equal(await ui(`root.querySelector('.cc-total').textContent`), '30 conversations');
  assert.equal(await ui(`root.querySelectorAll('.cc-grp').length`), 1);
  assert.equal(await ui(`root.querySelector('.cc-grp').getAttribute('aria-expanded')`), 'false');
  await click('.cc-all');
  assert.equal(await ui(`root.querySelector('.cc-sel').textContent`), '26 selected');
  assert.match(await ui(`root.querySelector('.cc-note').textContent`), /4 protected chats skipped/);
  await screenshot('desktop-review');
  await click('.cc-none');
  // Protected conversations remain selectable by hand, exactly like the real extension.
  await click('.cc-row.cc-prot input');
  await click('.cc-ft button:last-child');
  assert.match(await ui(`root.querySelector('.cc-dlg p').textContent`), /Includes protected conversations: 1 pinned/);
  await click('.cc-cancel');
  await click('.cc-none');
  // Manual protection changes bulk selection and survives a reload.
  await click('.cc-row:not(.cc-prot) .cc-lock');
  await click('.cc-all');
  assert.equal(await ui(`root.querySelector('.cc-sel').textContent`), '25 selected');
  await click('.cc-x');
  await cdp('Page.reload');
  await waitUi(`root.querySelector('.cc-open')`);
  await click('.cc-open');
  await waitUi(`root.querySelector('.cc-lock[aria-pressed="true"]')`);
  await click('.cc-lock[aria-pressed="true"]');
  // Shift selection uses the actual rendered row order.
  await click('.cc-row:nth-child(3) input');
  await click('.cc-row:nth-child(5) input', 8);
  assert.equal(await ui(`root.querySelector('.cc-sel').textContent`), '3 selected');
  await click('.cc-none');
  // Projects expand and have the same explicit group override/confirmation.
  await click('.cc-grp');
  await click('.cc-grp button');
  assert.equal(await ui(`root.querySelector('.cc-sel').textContent`), '2 selected');
  await click('.cc-ft button:last-child');
  assert.match(await ui(`root.querySelector('.cc-dlg p').textContent`), /2 in a project/);
  await click('.cc-cancel');
  await click('.cc-none');
  await click('.cc-grp');
  await click('.cc-all');
  await click('.cc-ft button:last-child');
  assert.equal(await ui(`root.querySelector('.cc-dlg h3').textContent`), 'Delete 26 conversations permanently?');
  assert.match(await ui(`root.querySelector('.cc-dlg p').textContent`),
    /^Deleted chats cannot be recovered\.\n\nTo verify each result/);
  assert.equal(await ui(`root.querySelector('.cc-cancel').textContent`), 'Cancel');
  assert.equal(await ui(`root.querySelector('.cc-ok').textContent`), 'Delete 26');
  assert.equal(await ui(`root.querySelector('.cc-ok').classList.contains('cc-danger')`), true);
  assert.equal(await ui(`(() => { const d = root.querySelector('.cc-dlg').getBoundingClientRect(); const p = root.querySelector('.cc-root').getBoundingClientRect(); return d.left >= p.left && d.right <= p.right && d.top >= p.top; })()`), true,
    'confirmation stays inside the product panel, not a fullscreen landing modal');
  await screenshot('desktop-confirm');
  await click('.cc-cancel');
  assert.equal(await evaluate(`document.querySelector('#history-count').textContent`), '30');
  await click('.cc-ft button:last-child');
  await click('.cc-ok');
  assert.equal(await ui(`root.querySelector('.cc-sum').hidden`), true);
  assert.equal(await ui(`root.querySelector('.cc-stop').textContent`), 'Stop');
  await waitUi(`root.querySelector('.cc-back') && root.querySelector('.cc-stat').textContent === '26 chats deleted'`);
  assert.equal(await evaluate(`document.querySelector('#history-count').textContent`), '4');
  assert.equal(await ui(`root.querySelector('.cc-back').textContent`), 'Back to list');
  await screenshot('desktop-complete');
  await click('.cc-back');
  assert.equal(await ui(`root.querySelector('.cc-total').textContent`), '4 conversations');
  assert.equal(await ui(`root.querySelector('.cc-sum').hidden`), false);
  await click('.cc-x');
  await click('#finish-get');
  assert.match(await evaluate(`document.querySelector('#info-dialog').textContent`), /in development/);
  await click('#info-dialog .modal-close');
  await click('#hero-replay');
  await click('.cc-open');
  await click('.cc-all');
  await click('.cc-ft button:first-child');
  assert.equal(await ui(`root.querySelector('.cc-dlg h3').textContent`), 'Archive 26 conversations?');
  assert.match(await ui(`root.querySelector('.cc-dlg p').textContent`),
    /^Archived chats stay in your account and can be restored from ChatGPT settings\.\n\nTo verify each result/);
  assert.equal(await ui(`root.querySelector('.cc-ok').classList.contains('cc-danger')`), false);
  await click('.cc-ok');
  await waitFor(`Number(document.querySelector('#history-count').textContent) < 30`);
  await click('.cc-stop');
  await waitUi(`root.querySelector('.cc-back')`);
  assert.equal(await ui(`root.querySelector('.cc-result-kicker').textContent`), 'Cleanup paused');
  assert.equal(await ui(`root.querySelectorAll('.cc-ft button').length`), 1, 'no invented Continue button');
  const pausedCount = await evaluate(`document.querySelector('#history-count').textContent`);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await evaluate(`document.querySelector('#history-count').textContent`), pausedCount);
  // Recovery goes through the same saved-state prompt after page reload.
  await cdp('Page.reload');
  await waitUi(`root.querySelector('.cc-open')`);
  await click('.cc-open');
  await waitUi(`root.querySelector('.cc-dlg')`);
  assert.match(await ui(`root.querySelector('.cc-dlg h3').textContent`), /^Resume archiving/);
  assert.equal(await ui(`root.querySelector('.cc-cancel').textContent`), 'Not now');
  await screenshot('desktop-resume');
  await click('.cc-ok');
  await waitUi(`root.querySelector('.cc-back') && root.querySelector('.cc-stat').textContent === '26 chats archived'`);
  assert.equal(await evaluate(`document.querySelector('#history-count').textContent`), '4');
  await click('.cc-x');
  await click('#reset-button');
  await click('#demo-prompt');
  await cdp('Input.insertText', { text: '<img src=x onerror=alert(1)>' });
  await click('#composer button');
  assert.equal(await evaluate(`document.querySelector('#history-count').textContent`), '31');
  assert.equal(await evaluate(`document.querySelectorAll('#chat-prompt img, #chat-answer img').length`), 0);
  await click('#reset-button');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.equal(await ui(`getComputedStyle(root.querySelector('.cc-open')).animationName`), 'none');
  assert.equal(await ui(`(() => {
    const button = root.querySelector('.cc-open').getBoundingClientRect();
    const composer = document.querySelector('#composer').getBoundingClientRect();
    return button.bottom <= composer.top || button.top >= composer.bottom || button.right <= composer.left || button.left >= composer.right;
  })()`), true, 'The cleanup launcher must not cover the mobile composer');
  await screenshot('mobile-intro');
  await click('#mobile-menu');
  await screenshot('mobile-sidebar');
  await click('#history-search');
  await cdp('Input.insertText', { text: 'Japan' });
  assert.equal(await evaluate(`document.querySelectorAll('.history-row').length`), 1);
  await click('.history-row');
  await screenshot('mobile-chat');
  await click('.cc-open');
  await click('.cc-all');
  await screenshot('mobile-review');
  await click('.cc-ft button:last-child');
  await screenshot('mobile-confirm');
  assert.equal(await ui(`root.querySelector('.cc-root').getBoundingClientRect().right <= innerWidth`), true);
  assert.deepEqual(failures, []);
  assert.equal(requests.some(url => /^https?:/.test(url)), false);
  console.log('PASS: shared product panel/dialogs, manual/pinned/project protection, shift selection, archive/delete, Stop, persisted recovery, result/Back to list, desktop/mobile and no external requests');

} finally {
  clearTimeout(deadline);
  await send('Browser.close').catch(() => {});
  browser.kill();
  console.log('Disposable profile: ' + profile);
}
