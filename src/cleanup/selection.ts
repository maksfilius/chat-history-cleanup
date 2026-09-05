import type { Project } from '../chatgpt/api.ts';
import type { Conversation } from '../types/conversation.ts';

/**
 * Pure selection primitives for Free v1's manual bulk workflow.
 *
 * The rule they all share: a bulk gesture ("select all", a shift-range) never picks up a
 * protected conversation. The user can still add one by ticking it deliberately — protection
 * is a safety default, not a lock.
 */

export interface BulkSelection {
  ids: string[];
  /** How many protected conversations the gesture deliberately left out. */
  skipped: number;
}

/** "Select all": every conversation that is not protected. */
export function selectAll(
  conversations: readonly Conversation[],
  protectedBy: ReadonlyMap<string, string>,
): BulkSelection {
  const ids: string[] = [];
  let skipped = 0;
  for (const c of conversations) {
    if (protectedBy.has(c.id)) skipped++;
    else ids.push(c.id);
  }
  return { ids, skipped };
}

/**
 * Shift-click range, inclusive, in the order the rows are displayed.
 * Protected conversations inside the range are skipped rather than silently swept in.
 */
export function selectRange(
  conversations: readonly Conversation[],
  anchorIndex: number,
  targetIndex: number,
  protectedBy: ReadonlyMap<string, string>,
): BulkSelection {
  const lo = Math.max(0, Math.min(anchorIndex, targetIndex));
  const hi = Math.min(conversations.length - 1, Math.max(anchorIndex, targetIndex));
  if (lo > hi) return { ids: [], skipped: 0 };
  return selectAll(conversations.slice(lo, hi + 1), protectedBy);
}

export interface ProjectGroup {
  id: string;
  name: string;
  ids: string[];
}

/**
 * Conversations grouped by project, for "select all chats in this project".
 * Only projects that actually hold conversations are returned.
 */
export function projectGroups(
  conversations: readonly Conversation[],
  projects: readonly Project[],
): ProjectGroup[] {
  const byProject = new Map<string, string[]>();
  for (const c of conversations) {
    if (!c.projectId) continue;
    (byProject.get(c.projectId) ?? byProject.set(c.projectId, []).get(c.projectId)!).push(c.id);
  }
  return projects
    .map((p) => ({ id: p.id, name: p.name, ids: byProject.get(p.id) ?? [] }))
    .filter((g) => g.ids.length > 0);
}
