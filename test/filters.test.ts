import assert from 'node:assert/strict';
import test from 'node:test';
import { candidates, olderThan, ruleCount, untitled } from '../src/cleanup/filters.ts';
import type { Conversation } from '../src/types/conversation.ts';

const NOW = Date.parse('2026-09-03T12:00:00Z');
const chat = (id: string, daysOld: number | undefined, title = 't'): Conversation => ({
  id,
  title,
  updatedAt: daysOld === undefined ? undefined : NOW - daysOld * 86_400_000,
  source: 'api',
});

test('age rule matches at and beyond the threshold, never below', () => {
  const r = olderThan(90);
  assert.equal(r.describe(chat('a', 89), NOW), null);
  assert.match(r.describe(chat('b', 90), NOW)!, /last active 90 days ago/);
  assert.match(r.describe(chat('c', 400), NOW)!, /400 days/);
});

test('a conversation with unknown age is never suggested', () => {
  // Fail safe: no timestamp means we cannot prove it is old, so it stays out of the batch.
  for (const days of [30, 90, 180, 365]) {
    assert.equal(olderThan(days).describe(chat('x', undefined), NOW), null);
  }
});

test('untitled matches only a genuinely empty title', () => {
  assert.equal(untitled.describe(chat('a', 1, ''), NOW), 'never given a title');
  assert.equal(untitled.describe(chat('b', 1, '   '), NOW), 'never given a title');
  assert.equal(untitled.describe(chat('c', 1, 'real title'), NOW), null);
});

test('overlapping rules yield one candidate carrying every reason', () => {
  const convs = [chat('old-untitled', 400, ''), chat('recent', 2), chat('old', 200)];
  const found = candidates(convs, [olderThan(30), olderThan(90), untitled], NOW);
  assert.equal(found.size, 2, 'no duplicate entry for a chat matched by three rules');
  assert.deepEqual(found.get('old-untitled'), ['last active 400 days ago', 'never given a title']);
  assert.equal(found.has('recent'), false);
  assert.deepEqual(found.get('old'), ['last active 200 days ago'], 'identical reasons collapse');
});

test('rule counts are per-rule, not cumulative', () => {
  const convs = [chat('a', 400), chat('b', 100), chat('c', 5)];
  assert.equal(ruleCount(convs, olderThan(30), NOW), 2);
  assert.equal(ruleCount(convs, olderThan(365), NOW), 1);
  assert.equal(ruleCount(convs, untitled, NOW), 0);
});
