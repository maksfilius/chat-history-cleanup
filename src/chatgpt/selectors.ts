/**
 * Every ChatGPT DOM assumption lives here. Nothing else may contain a raw selector.
 * Prefer href/aria/data-testid over generated class names.
 */
export const selectors = {
  /** Sidebar nav element; ChatGPT renders history inside it. */
  sidebar: 'nav[aria-label], #history, nav',
  /**
   * Conversation rows. Two shapes, both must be matched:
   *   /c/<uuid>                     — an ordinary chat
   *   /g/g-p-<projectId>/c/<uuid>   — a chat that lives inside a project
   * Missing the second shape hides every project conversation (verified 2026-09-03).
   */
  conversationLink: 'a[href^="/c/"], a[href*="/c/"][href^="/g/g-p-"]',
  /** Scroll container for lazy loading; falls back to the sidebar itself. */
  historyScroller: '#history, nav [class*="overflow-y-auto"]',
  /** Per-row "..." trigger. testid has been stable-ish; keep the aria fallback. */
  rowMenuButton: '[data-testid$="-options"], button[aria-haspopup="menu"]',
  /** Menu items are matched by text at call time, not by class. */
  menuItem: '[role="menuitem"]',
} as const;

/**
 * Conversation ids are UUIDs in the /c/ path, optionally nested under a project:
 *   /c/<uuid>  or  /g/g-p-<projectId>/c/<uuid>
 */
const ID_RE = /^\/(?:g\/(g-p-[A-Za-z0-9_-]+)\/)?c\/([0-9a-fA-F-]{36})(?:[/?#]|$)/;

export interface ParsedHref {
  id: string;
  /** Set when the link is a project conversation. */
  projectId: string | null;
}

export function parseConversationHref(href: string | null | undefined): ParsedHref | null {
  if (!href) return null;
  let path = href;
  if (href.startsWith('http')) {
    try {
      path = new URL(href).pathname;
    } catch {
      return null;
    }
  }
  const m = ID_RE.exec(path);
  return m ? { id: m[2].toLowerCase(), projectId: m[1] ?? null } : null;
}
