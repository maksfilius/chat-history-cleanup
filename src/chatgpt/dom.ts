import type { Conversation, ConversationAdapter } from '../types/conversation.ts';
import { parseConversationHref, selectors } from './selectors.ts';

const q = <T extends Element>(sel: string, root: ParentNode = document) =>
  root.querySelector<T>(sel);

function rowTitle(a: HTMLAnchorElement): string {
  return (a.getAttribute('title') || a.textContent || '').trim();
}

/** Rows currently mounted in the sidebar. Virtualized/unscrolled history is NOT here. */
export function listDomConversations(): Conversation[] {
  const out = new Map<string, Conversation>();
  for (const a of document.querySelectorAll<HTMLAnchorElement>(selectors.conversationLink)) {
    const parsed = parseConversationHref(a.getAttribute('href'));
    if (!parsed || out.has(parsed.id)) continue;
    out.set(parsed.id, {
      id: parsed.id,
      title: rowTitle(a),
      href: a.getAttribute('href') ?? undefined,
      projectId: parsed.projectId,
      source: 'dom',
    });
  }
  return [...out.values()];
}

/** Scrolls the history container to the bottom once and reports how many new rows appeared. */
export async function probeLoadMore(waitMs = 1500): Promise<{ before: number; after: number }> {
  const before = listDomConversations().length;
  const scroller =
    q<HTMLElement>(selectors.historyScroller) ?? q<HTMLElement>(selectors.sidebar);
  scroller?.scrollTo({ top: scroller.scrollHeight });
  await new Promise((r) => setTimeout(r, waitMs));
  return { before, after: listDomConversations().length };
}

/** Discovery only. DOM mutation cannot currently verify menu ownership and is disabled. */
export const domAdapter: ConversationAdapter = {
  name: 'dom',
  listVisibleConversations: async () => listDomConversations(),
  archive: async () => { throw new Error('DOM archive is unavailable: target cannot be verified'); },
  remove: async () => { throw new Error('DOM delete is unavailable: target cannot be verified'); },
};

/**
 * Drops a conversation's row from the sidebar. ChatGPT does not react to our API writes —
 * a deleted conversation's row stays in the DOM until reload (verified 2026-09-03).
 */
export function removeRow(id: string): void {
  for (const a of document.querySelectorAll<HTMLAnchorElement>(selectors.conversationLink)) {
    if (!a.closest('#history, nav') || parseConversationHref(a.getAttribute('href'))?.id !== id) continue;
    // Remove only this verified link, never an ancestor that might own other conversations.
    a.remove();
  }
}
