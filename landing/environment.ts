import type { Conversation, ConversationAdapter } from '../src/types/conversation.ts';
import type { Inventory, VerifyResult } from '../src/chatgpt/api.ts';
import { ApiError } from '../src/chatgpt/api.ts';
import { isConversationId } from '../src/types/identifiers.ts';
import { readKey, writeKey } from './storage.ts';

interface DemoConversation extends Conversation { deleted?: boolean }
const DAY = 86_400_000;
const DEMO_ACCOUNT_ID = 'demo-account';
const titles = [
  'Business plan', 'Japan trip', 'Writing', 'Ideas', 'Egg timer', 'Email draft', 'Regex',
  'New chat', 'Movie title', 'CSS fix', 'Quick question', 'Dinner ideas', 'Conversions',
  'Explain this', 'Test', 'Birthday caption', 'Excel formula', 'New chat', 'Grammar',
  'Font search', 'Code fix', 'Weekend plans', 'Summary', 'Translation', 'Quick test',
  'Names', 'Debugging', 'New chat', 'Old idea', 'Sandbox',
];
export const projects = [{ id: 'g-p-demo-writing', name: 'Writing' }];
let conversations: DemoConversation[] = [];
let activeRequests = 0;
const delay = () => new Promise<void>((done) => setTimeout(done, 160));

export async function initialize() {
  const fixtures: DemoConversation[] = titles.map((title, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    title,
    updatedAt: Date.now() - (i < 4 ? 8 + i : 120 + (i % 9) * 30) * DAY,
    createdAt: Date.now() - 365 * DAY,
    isPinned: i < 2,
    projectId: i === 2 || i === 3 ? projects[0].id : null,
    archived: false,
    source: 'api',
  }));
  const stored = await readKey<DemoConversation[]>('conversations');
  // Refresh fixture copy in existing demo tabs without resetting chats or saved batch state.
  const fixtureTitles = new Map(fixtures.map((chat) => [chat.id, chat.title]));
  conversations = Array.isArray(stored) && stored.every((chat) =>
    chat && isConversationId(chat.id) && typeof chat.title === 'string')
    ? stored.map((chat) => ({ ...chat, title: fixtureTitles.get(chat.id) ?? chat.title }))
    : fixtures;
  // The landing contains fictional local data, so the production first-run data disclosure
  // does not apply to this demo surface.
  await writeKey('privacyConsentVersion', 1);
}

export const visibleConversations = (): Conversation[] =>
  conversations.filter((chat) => !chat.deleted && !chat.archived).map((chat) => ({ ...chat }));

export async function listAll(onProgress?: (loaded: number) => void): Promise<Inventory> {
  const visible = visibleConversations();
  onProgress?.(visible.length);
  return {
    conversations: visible,
    total: visible.length,
    complete: true,
    issues: [],
    unreadProjects: [],
    projects,
    accountId: DEMO_ACCOUNT_ID,
  };
}

export async function assertAccountContext(expectedAccountId: string) {
  if (expectedAccountId !== DEMO_ACCOUNT_ID) throw new ApiError(409, 'account_changed');
}

async function act(id: string, kind: 'archive' | 'remove') {
  const chat = conversations.find((item) => item.id === id);
  if (!chat) throw new ApiError(404, 'conversation_not_found');
  if (chat.deleted) throw new ApiError(404, 'conversation_deleted');
  activeRequests++;
  try {
    await delay();
    if (kind === 'archive') chat.archived = true;
    else chat.deleted = true;
    await writeKey('conversations', conversations);
  } finally { activeRequests--; }
}

export const apiAdapter: ConversationAdapter = {
  name: 'fictional-demo',
  listVisibleConversations: async () => visibleConversations(),
  archive: (id) => act(id, 'archive'),
  remove: (id) => act(id, 'remove'),
};

export const apiAdapterFor = (_accountId: string): ConversationAdapter => apiAdapter;

export async function verify(id: string): Promise<VerifyResult> {
  await delay();
  const chat = conversations.find((item) => item.id === id);
  if (!chat) return { state: 'missing' };
  if (chat.deleted) return { state: 'deleted' };
  return { state: 'present', archived: chat.archived === true };
}

/** Called by the product only after a result is verified. Animate the fictional sidebar. */
export function removeRow(id: string) {
  window.dispatchEvent(new CustomEvent('demo:removed', { detail: { id } }));
}

export async function addConversation(title: string): Promise<Conversation> {
  const chat: DemoConversation = {
    id: crypto.randomUUID(), title, updatedAt: Date.now(), createdAt: Date.now(),
    isPinned: false, projectId: null, archived: false, source: 'api',
  };
  conversations.unshift(chat);
  await writeKey('conversations', conversations);
  return { ...chat };
}

export const hasActiveRequests = () => activeRequests > 0;
