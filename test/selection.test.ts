import assert from 'node:assert/strict';
import test from 'node:test';
import { projectGroups, selectAll, selectRange } from '../src/cleanup/selection.ts';
import type { Conversation } from '../src/types/conversation.ts';

const chat = (id: string, projectId: string | null = null): Conversation => ({
  id,
  title: id,
  projectId,
  source: 'api',
});
const convs = [chat('a'), chat('b'), chat('c'), chat('d'), chat('e')];
const prot = new Map([
  ['b', 'pinned'],
  ['d', 'in a project'],
]);

test('select all takes every unprotected conversation and reports what it skipped', () => {
  const r = selectAll(convs, prot);
  assert.deepEqual(r.ids, ['a', 'c', 'e']);
  assert.equal(r.skipped, 2);
});

test('select all on an all-protected list selects nothing rather than everything', () => {
  const r = selectAll([chat('b'), chat('d')], prot);
  assert.deepEqual(r.ids, []);
  assert.equal(r.skipped, 2);
});

test('a shift-range skips protected conversations inside it', () => {
  // Range a..d spans both protected rows; neither may be swept in silently.
  const r = selectRange(convs, 0, 3, prot);
  assert.deepEqual(r.ids, ['a', 'c']);
  assert.equal(r.skipped, 2);
});

test('a range works in either direction and stays inside the list', () => {
  assert.deepEqual(selectRange(convs, 3, 0, prot).ids, ['a', 'c']);
  assert.deepEqual(selectRange(convs, 4, 4, prot).ids, ['e']);
  assert.deepEqual(selectRange(convs, -5, 99, prot).ids, ['a', 'c', 'e']);
  assert.deepEqual(selectRange([], 0, 3, prot).ids, []);
});

test('project groups list only projects that hold conversations', () => {
  const withProjects = [
    chat('p1', 'g-p-1'),
    chat('p2', 'g-p-1'),
    chat('q1', 'g-p-2'),
    chat('flat'),
  ];
  const groups = projectGroups(withProjects, [
    { id: 'g-p-1', name: 'Project One' },
    { id: 'g-p-2', name: 'Project Two' },
    { id: 'g-p-3', name: 'Empty Project' },
  ]);
  assert.deepEqual(groups, [
    { id: 'g-p-1', name: 'Project One', ids: ['p1', 'p2'] },
    { id: 'g-p-2', name: 'Project Two', ids: ['q1'] },
  ]);
});

test('a shift-range spans what is rendered, not the whole inventory', () => {
  // With folders collapsed, render order and inventory order differ. A range computed over the
  // inventory would sweep up rows the user cannot see — the opposite of predictable.
  const rendered = [chat('loose-1'), chat('loose-2'), chat('p1', 'g-p-1')];
  const r = selectRange(rendered, 0, 2, new Map([['p1', 'in a project']]));
  assert.deepEqual(r.ids, ['loose-1', 'loose-2'], 'only visible, unprotected rows');
  assert.equal(r.skipped, 1);
});

test('project grouping keeps every conversation reachable exactly once', () => {
  const convs = [chat('a'), chat('p1', 'g-p-1'), chat('p2', 'g-p-1'), chat('q1', 'g-p-2')];
  const groups = projectGroups(convs, [
    { id: 'g-p-1', name: 'One' },
    { id: 'g-p-2', name: 'Two' },
  ]);
  const grouped = groups.flatMap((g) => g.ids);
  const loose = convs.filter((c) => !grouped.includes(c.id)).map((c) => c.id);
  assert.deepEqual(loose, ['a'], 'chats outside a project stay in the main list');
  assert.deepEqual([...grouped].sort(), ['p1', 'p2', 'q1'], 'and each project chat appears once');
});
