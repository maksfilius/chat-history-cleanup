import { createHash } from 'node:crypto';
import { readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const archive = resolve(root, 'chat-cleanup.zip');
const files = [
  'manifest.json',
  'content.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

for (const file of files) {
  const path = resolve(root, 'dist', file);
  if (!statSync(path).isFile()) throw new Error(`Missing release file: ${file}`);
  // ZIP stores DOS timestamps. Fixing them makes identical source produce identical bytes.
  utimesSync(path, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
}

rmSync(archive, { force: true });
const zipped = spawnSync('zip', ['-X', '-q', archive, ...files], {
  cwd: resolve(root, 'dist'),
  encoding: 'utf8',
});
if (zipped.status !== 0) throw new Error(zipped.stderr || 'zip failed');

const listing = spawnSync('unzip', ['-Z1', archive], { encoding: 'utf8' });
if (listing.status !== 0) throw new Error(listing.stderr || 'could not inspect archive');
const actual = listing.stdout.trim().split('\n').filter(Boolean);
if (actual.join('\n') !== files.join('\n')) {
  throw new Error(`Unexpected archive contents:\n${actual.join('\n')}`);
}

const data = readFileSync(archive);
const sha256 = createHash('sha256').update(data).digest('hex');
console.log(`chat-cleanup.zip ready (${data.length} bytes)`);
console.log(`SHA-256 ${sha256}`);
