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

function rowFor(id: string): HTMLElement | null {
  const a = q<HTMLAnchorElement>(`a[href^="/c/${id}"]`);
  return (a?.closest('li') as HTMLElement) ?? a?.parentElement ?? null;
}

/** Clicks the row menu and the item whose text matches `label`. User-equivalent route. */
async function menuAction(id: string, label: RegExp): Promise<void> {
  const row = rowFor(id);
  if (!row) throw new Error(`row not found: ${id}`);
  row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  const trigger = q<HTMLElement>(selectors.rowMenuButton, row);
  if (!trigger) throw new Error('row menu button not found');
  trigger.click();
  await new Promise((r) => setTimeout(r, 300));
  const item = [...document.querySelectorAll<HTMLElement>(selectors.menuItem)].find((el) =>
    label.test(el.textContent ?? ''),
  );
  if (!item) throw new Error(`menu item ${label} not found`);
  item.click();
}

/** DOM route. Kept as the fallback adapter; delete additionally needs a confirm dialog click. */
export const domAdapter: ConversationAdapter = {
  name: 'dom',
  listVisibleConversations: async () => listDomConversations(),
  archive: (id) => menuAction(id, /archive/i),
  remove: (id) => menuAction(id, /delete/i),
};

/**
 * Drops a conversation's row from the sidebar. ChatGPT does not react to our API writes —
 * a deleted conversation's row stays in the DOM until reload (verified 2026-09-03).
 */
export function removeRow(id: string): void {
  const a = q<HTMLAnchorElement>(`a[href^="/c/${id}"]`);
  (a?.closest('li') ?? a)?.remove();
}
