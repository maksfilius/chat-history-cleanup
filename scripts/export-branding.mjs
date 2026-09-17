// Deterministic SVG -> PNG export. Run only when changing the canonical mark.
// npm run build:branding -- --check validates assets without rewriting them.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const check = process.argv.includes('--check');
const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(`assets/branding/${name}`, root), 'utf8');
// One universal mark: the off-white face carries dark backgrounds, the charcoal keyline light ones.
// The 16px grid version is a separate drawing, so toolbar sizes land on whole pixels.
const master = read('logo.svg'), small = read('logo-16.svg');
const sourceFor = { 16: small, 32: small, 48: master, 128: master };
const colours = { paper: [244, 243, 237], bubble: [32, 37, 34], sparkle: [201, 242, 123] };
for (const source of [master, small]) {
  assert.doesNotMatch(source, /<(?:rect|filter|image|linearGradient|radialGradient)\b/);
  assert.doesNotMatch(source, /\b(?:opacity|fill-opacity|stroke-opacity|filter)=/);
  assert.deepEqual([...new Set(source.match(/#[0-9A-F]{6}/gi))].sort(), ['#202522', '#C9F27B', '#F4F3ED']);
}
mkdirSync(new URL('public/branding/', root), { recursive: true });
// Only the master ships: the 16px drawing exists to rasterise the toolbar sizes.
const logoPath = new URL('public/branding/logo.svg', root);
if (check) assert.equal(readFileSync(logoPath, 'utf8'), master, 'public/branding/logo.svg must match the canonical drawing');
else writeFileSync(logoPath, master);

const profile = mkdtempSync(join(tmpdir(), 'chat-cleanup-branding-'));
const browser = spawn(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--disable-default-apps', '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let seq = 0, buffer = '';
const pending = new Map();
browser.stdio[4].on('data', chunk => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const response = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const p = pending.get(response.id);
    if (p) {
      pending.delete(response.id);
      response.error ? p.reject(new Error(JSON.stringify(response.error))) : p.resolve(response.result);
    }
  }
});
browser.stderr.on('data', () => {});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
});
const deadline = setTimeout(() => { browser.kill(); throw new Error('Branding export timed out'); }, 30_000);
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  await cdp('Network.enable');
  await cdp('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] });
  const evaluate = async expression => {
    const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  await evaluate(`globalThis.render = async (url, size) => {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, size, size);
    return { rgba: [...context.getImageData(0,0,size,size).data], png: canvas.toDataURL('image/png'), width: image.naturalWidth, height: image.naturalHeight };
  }`);
  const dataUrl = svg => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  for (const size of [16, 32, 48, 128]) {
    const source = sourceFor[size];
    const full = await evaluate(`render(${JSON.stringify(dataUrl(source))}, ${size})`);
    // Flat fills only: every fully opaque pixel is one of the three colours, or an edge blend
    // between two of them. Count the exact hits and keep the blended fringe small.
    const opaque = { paper: 0, bubble: 0, sparkle: 0 };
    let solid = 0;
    for (let i = 0; i < full.rgba.length; i += 4) {
      if (full.rgba[i + 3] !== 255) continue;
      solid++;
      for (const [id, colour] of Object.entries(colours)) {
        if (colour.every((channel, c) => channel === full.rgba[i + c])) opaque[id]++;
      }
    }
    for (const [id, count] of Object.entries(opaque)) assert.ok(count > 0, `${size}px must show ${id}`);
    const exact = Object.values(opaque).reduce((a, b) => a + b, 0);
    assert.ok(exact / solid > 0.6, `${size}px is too soft: only ${exact}/${solid} opaque pixels are an exact brand colour`);
    const share = (opaque.paper / exact * 100).toFixed(0);
    // The mark is meant to fill the canvas, so no empty border is required — but the corners
    // stay clear, and the drawing has to actually use the space it is given.
    for (const corner of [0, size - 1, (size - 1) * size, size * size - 1]) {
      assert.notEqual(full.rgba[corner*4+3], 255, `${size}px corners must stay clear`);
    }
    let covered = 0;
    for (let i = 3; i < full.rgba.length; i += 4) if (full.rgba[i]) covered++;
    assert.ok(covered / (size * size) > 0.3, `${size}px only fills ${(covered/(size*size)*100).toFixed(0)}% of the canvas`);
    const path = new URL(`public/icons/icon${size}.png`, root);
    if (check) {
      const url = 'data:image/png;base64,' + readFileSync(path).toString('base64');
      const saved = await evaluate(`render(${JSON.stringify(url)}, ${size})`);
      assert.equal(saved.width, size); assert.equal(saved.height, size);
      assert.deepEqual(saved.rgba, full.rgba, `${size}px PNG does not match the canonical SVG`);
    } else writeFileSync(path, Buffer.from(full.png.split(',')[1], 'base64'));
    console.log(`PASS: ${size}px — ${(exact / solid * 100).toFixed(0)}% of opaque pixels are exactly a brand colour, all three show, clear corners, ${(covered/(size*size)*100).toFixed(0)}% canvas fill (off-white face ${share}%)`);
  }
  // A review sheet at actual sizes, on white, on the Chrome dark theme, and on the dark product UI.
  const backgrounds = [['Light — Chrome toolbar', '#ffffff', '#202522'], ['Dark — chrome://extensions', '#202124', '#e8eaed'], ['Dark — product UI', '#171717', '#F4F3ED']];
  const row = ([name, background, foreground]) => `<section style="background:${background};color:${foreground};padding:28px;border-radius:12px"><h2 style="margin:0 0 8px;font-size:15px">${name}</h2><div style="display:flex;gap:48px;align-items:flex-end">${[16,32,48,128].map(size=>`<figure style="margin:0;text-align:center"><img src="${dataUrl(sourceFor[size])}" width="${size}" height="${size}"><figcaption style="margin-top:14px;font-size:12px;opacity:.75">${size} × ${size}</figcaption></figure>`).join('')}</div></section>`;
  await cdp('Emulation.setDeviceMetricsOverride', { width: 620, height: 790, deviceScaleFactor: 2, mobile: false });
  await evaluate(`document.body.style.cssText='margin:0;padding:20px;background:#e3e5e2;font:14px system-ui;display:grid;gap:20px';document.body.innerHTML=${JSON.stringify(backgrounds.map(row).join(''))};Promise.all([...document.images].map(img=>img.decode()))`);
  const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const sheet = new URL('assets/branding/preview.png', root);
  if (!check) writeFileSync(sheet, Buffer.from(shot.data, 'base64'));
  console.log(`Preview sheet: ${check ? join(profile, 'preview.png') : 'assets/branding/preview.png'}`);
  if (check) writeFileSync(join(profile, 'preview.png'), Buffer.from(shot.data, 'base64'));
} finally {
  clearTimeout(deadline);
  await send('Browser.close').catch(() => {});
  browser.kill();
}
