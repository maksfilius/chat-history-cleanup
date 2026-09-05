import type { Conversation } from '../types/conversation.ts';

/**
 * Why a conversation must not be cleaned, or null if nothing protects it.
 *
 * Order matters only for which reason is shown; any hit protects.
 */
export function protectionFor(c: Conversation, manual: ReadonlySet<string>): string | null {
  // Reasons are phrased to read after "protected — " in the UI.
  if (manual.has(c.id)) return 'set by you';
  // A conversation we did not get from the API carries no project/pin metadata at all, so we
  // cannot prove it is safe. Fail safe rather than assume.
  if (c.source !== 'api') return 'metadata unavailable';
  if (c.projectId) return 'in a project';
  // isPinned is true or undefined, never false: a pinned chat always carries pinned_time and
  // is_starred (verified 2026-09-03), so undefined here means "not pinned", not "unknown".
  if (c.isPinned) return 'pinned';
  return null;
}

/**
 * Human-readable summary of what is protected inside a hand-picked selection, e.g.
 * "2 in a project, 1 pinned". Used to make a deliberate override explicit in the dialog.
 */
export function protectionSummary(
  ids: Iterable<string>,
  protectedBy: ReadonlyMap<string, string>,
): string {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const why = protectedBy.get(id);
    if (why) counts.set(why, (counts.get(why) ?? 0) + 1);
  }
  return [...counts.entries()].map(([why, n]) => `${n} ${why}`).join(', ');
}

/** id -> why it is protected, for every conversation that is. */
export function protectionMap(
  conversations: readonly Conversation[],
  manual: ReadonlySet<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of conversations) {
    const why = protectionFor(c, manual);
    if (why) out.set(c.id, why);
  }
  return out;
}
