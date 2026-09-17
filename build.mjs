import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

// A store archive must be assembled from a clean tree. Copying over an existing dist leaves
// removed files behind and can silently ship old code or private review assets.
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/content/index.ts'],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outfile: 'dist/content.js',
  logLevel: 'info',
});
cpSync('public/manifest.json', 'dist/manifest.json');
cpSync('public/icons', 'dist/icons', { recursive: true });
