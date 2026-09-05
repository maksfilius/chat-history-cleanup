import assert from 'node:assert/strict';
import test from 'node:test';
import { olderThan, reviewSet, untitled } from '../src/cleanup/filters.ts';
import { protectionFor, protectionSummary } from '../src/cleanup/protections.ts';
import type { Conversation } from '../src/types/conversation.ts';

const NOW = Date.parse('2026-09-03T12:00:00Z');
const chat = (id: string, over: Partial<Conversation> = {}): Conversation => ({
  id,
  title: `title ${id}`,
  updatedAt: NOW - 400 * 86_400_000, // old enough that every age rule matches
  source: 'api',
  ...over,
});
const none = new Set<string>();

test('each protection source is recognised', () => {
  assert.equal(protectionFor(chat('a'), none), null);
  assert.equal(protectionFor(chat('b', { projectId: 'g-p-123' }), none), 'in a project');
  assert.equal(protectionFor(chat('c', { isPinned: true }), none), 'pinned');
  assert.equal(protectionFor(chat('d'), new Set(['d'])), 'set by you');
});

test('a conversation without API metadata is protected, not assumed safe', () => {
  // The DOM adapter cannot see project or pin state, so it must never look clean.
  assert.equal(protectionFor(chat('x', { source: 'dom' }), none), 'metadata unavailable');
});

test('a project chat is not protected by a plain custom-GPT gizmo', () => {
  // mapApiItem only stores projectId for "g-p-" gizmos; a custom GPT chat is ordinary.
  assert.equal(protectionFor(chat('e', { projectId: null }), none), null);
});

test('protection always wins over cleanup rules', () => {
  const convs = [
    chat('plain'),
    chat('project', { projectId: 'g-p-1' }),
    chat('pinned', { isPinned: true }),
    chat('manual'),
    chat('dom-sourced', { source: 'dom' }),
  ];
  // Every rule at once, all of them matching every conversation.
  const rules = [olderThan(30), olderThan(365), untitled];
  const { suggested, protected: prot } = reviewSet(convs, rules, new Set(['manual']), NOW);

  assert.deepEqual([...suggested.keys()], ['plain'], 'only the unprotected chat is suggested');
  assert.equal(prot.size, 4);
  assert.deepEqual(
    [...prot.entries()].sort(),
    [
      ['dom-sourced', 'metadata unavailable'],
      ['manual', 'set by you'],
      ['pinned', 'pinned'],
      ['project', 'in a project'],
    ].sort(),
  );
});

test('manual protection overrides everything, including a chat the rules love', () => {
  const convs = [chat('doomed')];
  const before = reviewSet(convs, [olderThan(30)], none, NOW);
  assert.equal(before.suggested.has('doomed'), true);

  const after = reviewSet(convs, [olderThan(30)], new Set(['doomed']), NOW);
  assert.equal(after.suggested.has('doomed'), false);
  assert.equal(after.protected.get('doomed'), 'set by you');
});

test('with no rules active nothing is suggested, but protections are still reported', () => {
  const convs = [chat('a'), chat('b', { isPinned: true })];
  const r = reviewSet(convs, [], none, NOW);
  assert.equal(r.suggested.size, 0);
  assert.equal(r.protected.size, 1);
});

test('protectionSummary describes a hand-picked override', () => {
  // Shown in the confirm dialog so an override is never silent.
  const prot = new Map([
    ['a', 'in a project'],
    ['b', 'in a project'],
    ['c', 'pinned'],
    ['d', 'set by you'],
  ]);
  assert.equal(protectionSummary(['a', 'b', 'c'], prot), '2 in a project, 1 pinned');
  assert.equal(protectionSummary(['d'], prot), '1 set by you');
  // Nothing protected in the selection -> nothing to warn about.
  assert.equal(protectionSummary(['x', 'y'], prot), '');
  assert.equal(protectionSummary([], prot), '');
});
