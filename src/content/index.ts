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
