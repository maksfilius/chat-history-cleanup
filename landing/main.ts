import { createUi } from '../src/content/panel.ts';
import type { Conversation } from '../src/types/conversation.ts';
import type { Operation } from '../src/queue/operationQueue.ts';
import { formatAge } from '../src/cleanup/age.ts';
import { initialize, visibleConversations, addConversation, hasActiveRequests } from './environment.ts';
import { resetStorage } from './storage.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let activeChat: string | null = null;
let complete = false;
let batchBusy = false;
let ui: HTMLElement;

// Keep the preferred landing CTA appearance on the real product's launch button.
// Decorative annotation lives outside the button's bounds and cannot intercept clicks.
const launchHint = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 126 96">
  <text x="15" y="27" fill="#c0d6ac" font-family="Georgia,serif" font-size="19" font-style="italic" transform="rotate(-9 15 27)">Try it</text>
  <path d="M25 39C18 69 59 87 113 74M103 67l10 7-9 9" fill="none" stroke="#accb95" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`);
const launchStyles = `
  .cc-open{right:32px;bottom:122px;display:flex;align-items:center;gap:9px;padding:15px 17px;
    border:1px solid #ebffd4;border-radius:13px;background:#d0f2ae;color:#24351c;
    font:650 14px/1.5 system-ui,sans-serif;
    box-shadow:0 0 0 0 #d0f2ae00,0 0 24px 5px #b6f07f24,0 0 64px 12px #b6f07f12,0 8px 26px #0004;
    animation:demo-glow 2.6s ease-in-out infinite}
  .cc-open::after{content:'';position:absolute;right:calc(100% + 12px);top:-52px;width:126px;height:96px;
    background:url("data:image/svg+xml,${launchHint}") center/contain no-repeat;pointer-events:none}
  .cc-open:hover{background:#e1ffc4}
  .cc-open:focus-visible{outline:2px solid #d0f2ae;outline-offset:5px}
  .cc-root{max-width:calc(100vw - 32px)}
  @keyframes demo-glow{50%{box-shadow:0 0 0 9px #d0f2ae0d,0 0 44px 12px #b6f07f66,0 0 96px 28px #b6f07f26,0 8px 26px #0004}}
  @media(max-width:650px){.cc-open{right:23px;bottom:124px;padding:12px 15px;font-size:13px}}
  @media(prefers-reduced-motion:reduce){.cc-open{animation:none}}
`;

function icon(name: string, className = '') {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('aria-hidden', 'true');
  if (className) el.setAttribute('class', className);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${name}`);
  el.append(use);
  return el;
}

function renderHistory() {
  const query = $<HTMLInputElement>('history-search').value.trim().toLowerCase();
  const visible = visibleConversations().filter((chat) => chat.title.toLowerCase().includes(query));
  const fragment = document.createDocumentFragment();
  for (const chat of visible) {
    const button = document.createElement('button');
    button.className = `history-row${chat.id === activeChat ? ' active' : ''}`;
    button.dataset.chatId = chat.id;
    button.title = chat.isPinned ? `${chat.title} · Pinned` : chat.title;
    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = chat.title;
    button.append(title);
    if (chat.isPinned) button.append(icon('pin', 'row-icon'));
    button.addEventListener('click', () => showChat(chat));
    fragment.append(button);
  }
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = query ? 'No matching chats.' : 'No chats here.';
    fragment.append(empty);
  }
  $('history').replaceChildren(fragment);
  $('history-count').textContent = String(visibleConversations().length);
}

function showHome() {
  $('chat-view').hidden = true;
  $('clean-view').hidden = !complete;
  $('intro').hidden = complete;
  activeChat = null;
  renderHistory();
}

function showChat(chat: Conversation) {
  activeChat = chat.id;
  $('intro').hidden = true;
  $('clean-view').hidden = true;
  $('chat-view').hidden = false;
  $('chat-title').textContent = chat.title;
  $('chat-prompt').textContent = chat.title;
  $('chat-answer').textContent = `Demo conversation · ${formatAge(chat.updatedAt)}`;
  renderHistory();
  setSidebar(false);
}

async function reset() {
  if (batchBusy || hasActiveRequests()) return;
  ui?.remove();
  resetStorage();
  await initialize();
  complete = false;
  $<HTMLInputElement>('history-search').value = '';
  $<HTMLInputElement>('demo-prompt').value = '';
  setSidebar(false);
  showHome();
  mountProduct();
}

function mountProduct() {
  ui = createUi(launchStyles);
  ui.id = 'demo-extension';
  document.body.append(ui);
}

function setSidebar(open: boolean) {
  const mobile = matchMedia('(max-width:650px)').matches;
  $('sidebar').classList.toggle('is-open', open);
  $('sidebar-scrim').hidden = !open;
  $('mobile-menu').setAttribute('aria-expanded', String(open));
  $('sidebar').inert = mobile && !open;
  // The mobile drawer temporarily owns the screen, including keyboard navigation.
  if (ui) ui.hidden = ui.inert = mobile && open;
}

window.addEventListener('demo:removed', ((event: CustomEvent<{ id: string }>) => {
  const row = [...$('history').querySelectorAll<HTMLElement>('[data-chat-id]')]
    .find((element) => element.dataset.chatId === event.detail.id);
  row?.classList.add('is-leaving');
  setTimeout(() => row?.remove(), 230);
  $('history-count').textContent = String(visibleConversations().length);
}) as EventListener);

window.addEventListener('demo:storage', ((event: CustomEvent<{ key: string; value?: unknown }>) => {
  const { key, value } = event.detail;
  if (key === 'batchLease') {
    batchBusy = value !== undefined;
    for (const id of ['reset-button', 'hero-replay']) $<HTMLButtonElement>(id).disabled = batchBusy;
  }
  if (key !== 'activeBatch' || !value) return;
  const saved = value as { kind: 'remove' | 'archive'; ops: Operation[] };
  if (!Array.isArray(saved.ops) || !saved.ops.length || saved.ops.some((op) => op.state !== 'done')) return;
  complete = true;
  $('clean-description').textContent = `${saved.ops.length} chats ${saved.kind === 'remove' ? 'deleted' : 'archived'}.`;
  $('intro').hidden = true;
  $('chat-view').hidden = true;
  $('clean-view').hidden = false;
  // Let the last sidebar rows animate away before reconciling the list.
  setTimeout(renderHistory, 250);
}) as EventListener);

$('history-search').addEventListener('input', renderHistory);
$('brand-home').addEventListener('click', (event) => { event.preventDefault(); showHome(); });
$('back-home').addEventListener('click', showHome);
$('new-chat').addEventListener('click', () => { showHome(); setSidebar(false); $('demo-prompt').focus(); });
$('composer').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (batchBusy) return;
  const input = $<HTMLInputElement>('demo-prompt');
  const title = input.value.trim();
  if (!title) return input.focus();
  const chat = await addConversation(title);
  input.value = '';
  showChat(chat);
});
for (const id of ['reset-button', 'hero-replay']) $(id).addEventListener('click', () => void reset());
for (const id of ['get-button', 'finish-get']) $(id).addEventListener('click', () => $<HTMLDialogElement>('info-dialog').showModal());
$('mobile-menu').addEventListener('click', () => setSidebar(!$('sidebar').classList.contains('is-open')));
$('sidebar-scrim').addEventListener('click', () => setSidebar(false));
matchMedia('(max-width:650px)').addEventListener('change', () => setSidebar(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('sidebar').classList.contains('is-open')) setSidebar(false);
});

void initialize().then(() => {
  setSidebar(false);
  renderHistory();
  mountProduct();
});
