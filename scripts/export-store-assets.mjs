// Deterministic Chrome Web Store promotional tile from the canonical logo.
// Store screenshots must come from the real extension on ChatGPT, using disposable data.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'docs/store/assets');
mkdirSync(output, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'chat-cleanup-store-assets-'));
const browser = spawn(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--disable-default-apps', '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });

let sequence = 0;
let buffer = '';
const pending = new Map();
const failures = [];
const requests = [];
browser.stdio[4].on('data', (chunk) => {
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

const send = (method, params = {}, sessionId) => new Promise((resolvePromise, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve: resolvePromise, reject });
  browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
});

const timeout = setTimeout(() => {
  browser.kill();
  throw new Error('Store asset export timed out');
}, 45_000);

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Network.enable');
  await cdp('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] });

  const evaluate = async (expression) => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression) => {
    const expires = Date.now() + 12_000;
    while (!(await evaluate(expression))) {
      if (Date.now() > expires) throw new Error(`Timed out: ${expression}`);
      await new Promise((done) => setTimeout(done, 40));
    }
  };
  const capture = async (name) => {
    await new Promise((done) => setTimeout(done, 250));
    const shot = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
    writeFileSync(resolve(output, name), Buffer.from(shot.data, 'base64'));
    console.log(`Store asset: docs/store/assets/${name}`);
  };

  const logo = readFileSync(resolve(root, 'public/branding/logo.svg'), 'utf8');
  const logoBody = logo.slice(logo.indexOf('>') + 1, logo.lastIndexOf('</svg>'));
  const promo = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280">
    <rect width="440" height="280" rx="0" fill="#202522"/>
    <circle cx="416" cy="-8" r="112" fill="#2a302c"/>
    <circle cx="-12" cy="286" r="106" fill="#252b27"/>
    <g transform="translate(34 72) scale(.92)">${logoBody}</g>
    <text x="169" y="117" fill="#F4F3ED" font-family="Arial, sans-serif" font-size="30" font-weight="700">Chat Cleanup</text>
    <text x="170" y="151" fill="#C9F27B" font-family="Arial, sans-serif" font-size="16" font-weight="700">Review. Protect. Clean up.</text>
    <text x="170" y="180" fill="#c9ccc9" font-family="Arial, sans-serif" font-size="13">Bulk archive or delete with confidence.</text>
  </svg>`;
  const promoSvg = resolve(output, 'promo-tile-440x280.svg');
  writeFileSync(promoSvg, promo);
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 440, height: 280, deviceScaleFactor: 1, mobile: false,
  });
  await cdp('Page.navigate', { url: new URL('../docs/store/assets/promo-tile-440x280.svg', import.meta.url).href });
  await waitFor(`document.querySelector('svg')?.getBoundingClientRect().width === 440`);
  await capture('promo-tile-440x280.png');

  if (failures.length) throw new Error(`Browser exceptions: ${JSON.stringify(failures)}`);
  if (requests.some((url) => /^https?:/.test(url))) {
    throw new Error(`Unexpected network request: ${requests.find((url) => /^https?:/.test(url))}`);
  }
} finally {
  clearTimeout(timeout);
  await send('Browser.close').catch(() => {});
  browser.kill();
}
