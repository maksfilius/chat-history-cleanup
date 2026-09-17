// Capture Chrome Web Store screenshots from the production extension UI on chatgpt.com.
// A fresh temporary Chrome profile and fictional metadata keep private account data out.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'docs/store/assets');
const profile = mkdtempSync(join(tmpdir(), 'chat-cleanup-store-capture-'));
const chrome = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const bundle = readFileSync(resolve(root, 'dist/content.js'), 'utf8');
mkdirSync(output, { recursive: true });

const browser = spawn(chrome, [
  '--headless=new',
  '--remote-debugging-pipe',
  `--user-data-dir=${profile}`,
  '--window-size=1280,800',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-component-update',
  '--disable-sync',
  '--disable-default-apps',
  '--lang=en-US',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });

let sequence = 0;
let buffer = '';
const pending = new Map();
let browserError = '';

browser.stdio[4].on('data', (chunk) => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const callback = pending.get(message.id);
    if (callback) {
      pending.delete(message.id);
      clearTimeout(callback.timer);
      message.error ? callback.reject(new Error(JSON.stringify(message.error))) : callback.resolve(message.result);
    }
  }
});
browser.stderr.on('data', (chunk) => { browserError += chunk.toString(); });

const send = (method, params = {}, sessionId) => new Promise((resolvePromise, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => {
    pending.delete(id);
    reject(new Error(`Chrome command timed out: ${method}`));
  }, 30_000);
  pending.set(id, { resolve: resolvePromise, reject, timer });
  browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
});

const deadline = setTimeout(() => {
  browser.kill();
  throw new Error('Store screenshot capture timed out');
}, 90_000);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

try {
  const version = await send('Browser.getVersion');
  console.log('Capture: Chrome connected');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });
  await cdp('Emulation.setUserAgentOverride', {
    userAgent: version.userAgent.replace('HeadlessChrome/', 'Chrome/'),
    acceptLanguage: 'en-US,en;q=0.9',
    platform: 'MacIntel',
  });

  const pageEvaluate = async (expression) => {
    const result = await cdp('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitOnPage = async (expression, timeoutMs = 20_000) => {
    const expires = Date.now() + timeoutMs;
    while (true) {
      try {
        if (await pageEvaluate(expression)) return;
      } catch {
        // The old execution context is expected to disappear while navigation commits.
      }
      if (Date.now() > expires) throw new Error(`Timed out on chatgpt.com: ${expression}`);
      await sleep(100);
    }
  };
  await cdp('Runtime.evaluate', {
    expression: "setTimeout(() => location.replace('https://chatgpt.com/'), 0); true",
    returnByValue: true,
  });
  console.log('Capture: navigation started');
  await waitOnPage("document.readyState !== 'loading' && Boolean(document.body)");
  await sleep(2_000);
  console.log('Capture: ChatGPT surface loaded');
  const pageUrl = await pageEvaluate('location.href');
  assert.match(pageUrl, /^https:\/\/chatgpt\.com\//, `Unexpected capture page: ${pageUrl}`);

  // Isolated-world globals mirror Chrome content-script isolation. Only the DOM is shared.
  const { frameTree } = await cdp('Page.getFrameTree');
  const { executionContextId } = await cdp('Page.createIsolatedWorld', {
    frameId: frameTree.frame.id,
    worldName: 'chat-cleanup-store-capture',
  });
  const evaluate = async (expression) => {
    const result = await cdp('Runtime.evaluate', {
      expression,
      contextId: executionContextId,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression, timeoutMs = 12_000) => {
    const expires = Date.now() + timeoutMs;
    while (!(await evaluate(expression))) {
      if (Date.now() > expires) throw new Error(`Timed out: ${expression}`);
      await sleep(50);
    }
  };

  const now = Date.now();
  const daysAgo = (days) => new Date(now - days * 86_400_000).toISOString();
  const fixture = [
    ['API pagination notes', 41, false],
    ['CSS grid alignment', 96, false],
    ['Docker compose timeout', 186, false],
    ['SQL join example', 205, false],
    ['React state experiment', 237, false],
    ['Python CSV cleanup', 278, false],
    ['Regex test', 314, false],
    ['Travel packing checklist', 361, false],
    ['Temporary calculation', 419, false],
    ['Email outline', 472, false],
    ['Quick product comparison', 514, false],
    ['Quarterly planning', 602, true],
  ].map(([title, days, pinned], index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    title,
    create_time: daysAgo(Number(days) + 4),
    update_time: daysAgo(Number(days)),
    gizmo_id: null,
    is_starred: pinned ? true : null,
    pinned_time: pinned ? daysAgo(Number(days)) : null,
    is_archived: false,
  }));
  const projectFixture = [
    ['Launch research', 243],
    ['Release checklist', 388],
  ].map(([title, days], index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    title,
    create_time: daysAgo(Number(days) + 8),
    update_time: daysAgo(Number(days)),
    gizmo_id: 'g-p-store-capture',
    is_starred: null,
    pinned_time: null,
    is_archived: false,
  }));

  await evaluate(`
    globalThis.storeRoots = [];
    const nativeAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) {
      const root = nativeAttachShadow.call(this, options);
      storeRoots.push(root);
      return root;
    };
    const heldLocks = new Set();
    const lockWaiters = new Map();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: async (name, options, callback) => {
        if (options?.ifAvailable && heldLocks.has(name)) return callback(null);
        while (heldLocks.has(name)) {
          await new Promise(resolve => {
            const waiters = lockWaiters.get(name) ?? [];
            waiters.push(resolve);
            lockWaiters.set(name, waiters);
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
    globalThis.storeMemory = { privacyConsentVersion: 1 };
    globalThis.chrome = { runtime: { id: 'store-capture-extension' }, storage: { local: {
      get: async key => {
        if (key === null || key === undefined) return structuredClone(storeMemory);
        if (Array.isArray(key)) return Object.fromEntries(key.map(k => [k, structuredClone(storeMemory[k])]));
        if (typeof key === 'object') return Object.fromEntries(Object.entries(key).map(([k, fallback]) =>
          [k, structuredClone(storeMemory[k] ?? fallback)]));
        return { [key]: structuredClone(storeMemory[key]) };
      },
      set: async values => { Object.assign(storeMemory, structuredClone(values)); },
      remove: async key => { for (const k of Array.isArray(key) ? key : [key]) delete storeMemory[k]; },
    } } };
    globalThis.storeFlat = ${JSON.stringify(fixture)};
    globalThis.storeProjects = ${JSON.stringify(projectFixture)};
    globalThis.storeArchived = new Set();
    globalThis.storeDeleted = new Set();
    globalThis.fetch = async (request, init = {}) => {
      const url = String(request);
      const json = (value, status = 200) => new Response(JSON.stringify(value), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
      if (url.includes('/api/auth/session')) return json({
        accessToken: 'fictional-store-token',
        account: { id: 'fictional-store-account' },
      });
      if (init.method === 'PATCH') {
        const id = url.split('/').at(-1);
        const body = JSON.parse(init.body);
        if (body.is_archived === true) storeArchived.add(id);
        if (body.is_visible === false) storeDeleted.add(id);
        return json({ success: true });
      }
      if (url.includes('/gizmos/snorlax/sidebar')) return json({
        items: [{ gizmo: { gizmo: {
          id: 'g-p-store-capture',
          display: { name: 'Product launch' },
        } } }],
        cursor: null,
      });
      if (url.includes('/gizmos/g-p-store-capture/conversations')) {
        return json({ items: storeProjects, cursor: null });
      }
      if (url.includes('/conversations?')) {
        const parsed = new URL(url);
        const offset = Number(parsed.searchParams.get('offset'));
        const limit = Number(parsed.searchParams.get('limit'));
        return json({
          total: storeFlat.length,
          offset,
          limit,
          items: storeFlat.slice(offset, offset + limit),
        });
      }
      if (url.includes('/conversation/')) {
        const id = url.split('/').at(-1);
        if (storeDeleted.has(id)) return json({ detail: { code: 'conversation_deleted' } }, 404);
        return json({ conversation_id: id, is_archived: storeArchived.has(id) });
      }
      throw new Error('Unexpected store-capture request: ' + url);
    };
  `);

  await evaluate(bundle);
  await waitFor("storeRoots.length > 0 && Boolean(storeRoots.at(-1).querySelector('.cc-open'))");
  console.log('Capture: production bundle mounted');

  const click = async (selector, textPattern) => {
    const point = await evaluate(`(() => {
      const candidates = [...storeRoots.at(-1).querySelectorAll(${JSON.stringify(selector)})];
      const el = ${textPattern ? `candidates.find(node => ${textPattern}.test(node.textContent.trim()))` : 'candidates[0]'};
      if (!el) throw new Error('Missing capture control: ' + ${JSON.stringify(selector)});
      el.scrollIntoView({ block: 'nearest' });
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    await sleep(100);
  };

  const setCaption = async (eyebrow, title, copy) => {
    await evaluate("storeRoots.at(-1).querySelector('#chat-cleanup-store-caption')?.remove()");
    await pageEvaluate(`(() => {
      // The host-page cookie banner obscures the extension footer. Remove only that banner;
      // keeping ChatGPT's navigation visible makes the integration context unambiguous.
      const exactText = (value) => [...document.querySelectorAll('body *')]
        .filter(node => node.children.length === 0 && node.textContent.trim() === value);
      for (const marker of exactText('What can you do?')) {
        (marker.closest('button') ?? marker).style.display = 'none';
      }
      for (const marker of exactText('Get responses tailored to you')) marker.style.display = 'none';
      for (const marker of [...document.querySelectorAll('body *')]
        .filter(node => node.children.length === 0 &&
          node.textContent.trim().startsWith('Log in to get answers based on'))) {
        marker.style.display = 'none';
      }
      for (const label of ['Log in', 'Sign up for free']) {
        for (const marker of exactText(label)) {
          (marker.closest('a,button') ?? marker).style.display = 'none';
        }
      }
      const disclaimer = [...document.querySelectorAll('body *')]
        .filter(node => {
          const rect = node.getBoundingClientRect();
          return node.innerText?.trim().startsWith('ChatGPT is AI.') &&
            rect.width > 0 && rect.width <= 1000 && rect.height > 0 && rect.height <= 80;
        })
        .sort((a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return ar.width * ar.height - br.width * br.height;
        })[0];
      if (disclaimer) disclaimer.style.display = 'none';
      let footerMask = document.getElementById('chat-cleanup-store-footer-mask');
      if (!footerMask) {
        footerMask = document.createElement('div');
        footerMask.id = 'chat-cleanup-store-footer-mask';
        footerMask.setAttribute('aria-hidden', 'true');
        footerMask.style.cssText = [
          'position:fixed', 'left:260px', 'right:0', 'bottom:0', 'height:34px',
          'z-index:2147483644', 'background:#000', 'pointer-events:none',
        ].join(';');
        document.body.appendChild(footerMask);
      }
      for (const marker of exactText('We use cookies')) {
        let node = marker;
        while (node && node !== document.body) {
          const rect = node.getBoundingClientRect();
          if (rect.width >= innerWidth * .8 && rect.bottom >= innerHeight - 2 && rect.height < 300) {
            node.remove();
            break;
          }
          node = node.parentElement;
        }
      }
      document.getElementById('chat-cleanup-store-caption')?.remove();
      const card = document.createElement('section');
      card.id = 'chat-cleanup-store-caption';
      card.setAttribute('aria-hidden', 'true');
      card.style.cssText = [
          'position:fixed', 'left:72px', 'top:50%', 'transform:translateY(-50%)',
          'width:470px', 'box-sizing:border-box', 'z-index:2147483647',
          'padding:32px 34px 32px 38px', 'border:1px solid rgba(201,242,123,.4)',
          'border-left:4px solid #c9f27b', 'border-radius:18px',
          'background:linear-gradient(145deg,rgba(29,35,31,.99),rgba(14,17,15,.99))',
          'box-shadow:0 34px 100px rgba(0,0,0,.78),0 12px 34px rgba(0,0,0,.55),0 0 52px rgba(201,242,123,.09),inset 0 1px 0 rgba(255,255,255,.05)',
          'font-family:system-ui,-apple-system,sans-serif', 'overflow:hidden',
          'color:#f4f3ed', 'pointer-events:none', 'backdrop-filter:blur(24px) saturate(120%)',
      ].join(';');
      card.innerHTML = '<div data-eyebrow></div><h1></h1><p></p>';
      document.body.appendChild(card);
      const eyebrow = card.querySelector('[data-eyebrow]');
      const heading = card.querySelector('h1');
      const paragraph = card.querySelector('p');
      eyebrow.textContent = ${JSON.stringify(eyebrow)};
      heading.textContent = ${JSON.stringify(title)};
      paragraph.textContent = ${JSON.stringify(copy)};
      eyebrow.style.cssText = 'color:#c9f27b;font:700 13px/1.2 system-ui;letter-spacing:.12em;text-transform:uppercase;margin-bottom:14px';
      heading.style.cssText = 'color:#f4f3ed;font:700 38px/1.08 system-ui;margin:0 0 16px;letter-spacing:-.03em';
      paragraph.style.cssText = 'color:#c9ccc9;font:400 18px/1.5 system-ui;margin:0;max-width:390px';
    })()`);
    await evaluate(`(() => {
      const card = document.getElementById('chat-cleanup-store-caption');
      if (!card) throw new Error('Missing store caption');
      storeRoots.at(-1).appendChild(card);
    })()`);
  };

  const capture = async (name) => {
    await evaluate("Promise.all(storeRoots.at(-1).getAnimations().map(animation => animation.finished.catch(() => {})))");
    await sleep(200);
    const bodyText = await pageEvaluate('document.body.innerText');
    assert.doesNotMatch(bodyText, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'Email found in capture page');
    assert.doesNotMatch(bodyText, /We use cookies/, 'Cookie banner found in capture page');
    assert.doesNotMatch(bodyText, /What can you do\?/, 'ChatGPT suggestion found in capture page');
    assert.doesNotMatch(bodyText, /Get responses tailored to you|ChatGPT is AI\.|Sign up for free/,
      'Guest-only ChatGPT copy found in capture page');
    const shot = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const data = Buffer.from(shot.data, 'base64');
    assert.equal(data.readUInt32BE(16), 1280, 'Screenshot width');
    assert.equal(data.readUInt32BE(20), 800, 'Screenshot height');
    writeFileSync(resolve(output, name), data);
    console.log(`Store screenshot: docs/store/assets/${name}`);
  };

  await click('.cc-open');
  // Twelve ordinary chats are rows; the two protected Project chats start collapsed as a group.
  await waitFor("storeRoots.at(-1).querySelector('.cc-total')?.textContent === '14 conversations' && storeRoots.at(-1).querySelectorAll('.cc-row').length === 12");
  console.log('Capture: fictional inventory loaded');
  assert.equal(await evaluate("Boolean(storeRoots.at(-1).querySelector('.cc-warn:not([hidden])'))"), false);
  await click('.cc-chip', '/^180d\\+/');
  assert.equal(await evaluate("storeRoots.at(-1).querySelector('.cc-sel').textContent"), '9 selected');
  await setCaption(
    'Chat Cleanup',
    'Find old chats in seconds',
    'Age filters surface cleanup candidates while pinned and Project chats stay protected.',
  );
  await capture('01-select-old-chats-1280x800.png');

  await click('.cc-ft button:last-child');
  await waitFor("Boolean(storeRoots.at(-1).querySelector('.cc-dlg'))");
  assert.equal(
    await evaluate("storeRoots.at(-1).querySelector('.cc-dlg h3').textContent"),
    'Delete 9 conversations permanently?',
  );
  await setCaption(
    'Safe by design',
    'Review the exact list first',
    'See every title and the exact count before confirming permanent deletion.',
  );
  await capture('02-review-before-delete-1280x800.png');

  await click('.cc-cancel');
  await click('.cc-ft .cc-primary');
  await waitFor("Boolean(storeRoots.at(-1).querySelector('.cc-dlg'))");
  await click('.cc-ok');
  await waitFor("Boolean(storeRoots.at(-1).querySelector('.cc-back'))", 20_000);
  assert.equal(await evaluate("storeRoots.at(-1).querySelector('.cc-stat').textContent"), '9 chats archived');
  await setCaption(
    'Clear result',
    'Know exactly what changed',
    'Visible progress and a completion report make every bulk action easy to verify.',
  );
  await capture('03-cleanup-complete-1280x800.png');

  console.log(`Capture page: ${pageUrl}`);
  console.log('Privacy check: fresh profile, fictional metadata, no email in captured DOM');
} catch (error) {
  if (browserError) console.error(browserError.slice(-4_000));
  throw error;
} finally {
  clearTimeout(deadline);
  if (browser.exitCode === null) {
    browser.kill();
    await Promise.race([
      new Promise((done) => browser.once('exit', done)),
      sleep(3_000),
    ]);
  }
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    console.warn(`Could not remove temporary Chrome profile: ${error}`);
  }
}
