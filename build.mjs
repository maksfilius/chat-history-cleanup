import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

// A store archive must be assembled from a clean tree. Copying over an existing dist leaves
// removed files behind and can silently ship old code or private review assets.
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
// Two bundles on purpose: the bridge runs in the page's own world, where archiving works, and
// must share nothing with the isolated-world script beyond postMessage.
for (const [entry, outfile] of [
  ['src/content/index.ts', 'dist/content.js'],
  ['src/content/pageBridge.ts', 'dist/pageBridge.js'],
]) {
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    outfile,
    logLevel: 'info',
  });
}
cpSync('public/manifest.json', 'dist/manifest.json');
cpSync('public/icons', 'dist/icons', { recursive: true });
