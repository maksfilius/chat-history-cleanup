import { apiAdapter, listAll, listPage, verify } from '../chatgpt/api.ts';
import { domAdapter, listDomConversations, probeLoadMore } from '../chatgpt/dom.ts';
import { createUi } from './panel.ts';

const MOUNT_ID = 'chat-cleanup-root';

/**
 * Idempotent mount. The UI lives in a shadow root appended to <body>, so ChatGPT's SPA
 * rerenders cannot restyle it or duplicate it; the observer only re-adds it if the node
 * is ever removed outright.
 */
function mount() {
  if (document.getElementById(MOUNT_ID)) return;
  const host = createUi();
  host.id = MOUNT_ID;
  document.body.appendChild(host);
}

mount();
new MutationObserver(() => mount()).observe(document.body, { childList: true });

// Milestone 0 probes, kept reachable from devtools instead of as extra UI.
(window as unknown as Record<string, unknown>).__chatCleanup = {
  domAdapter, apiAdapter, listAll, listPage, verify, listDomConversations, probeLoadMore,
};
