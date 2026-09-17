import type { Conversation, ConversationAdapter } from '../types/conversation.ts';
import { isProjectId, requireConversationId } from '../types/identifiers.ts';

/**
 * Internal-endpoint route, observed from what the ChatGPT web app itself calls.
 * ChatGPT-only fetch from the content script. The token is cached in memory and sent back
 * to ChatGPT for authentication, never persisted or logged. Endpoints are undocumented.
 *
 * VERIFIED 2026-09-03. Two traps confirmed live:
 *  - The list endpoint answers 200 to a cookie-only request but returns a SILENTLY PARTIAL
 *    set (6 of 8 conversations). Never call it without the Authorization header.
 *  - The detail endpoint 404s on a cookie-only request. Same rule.
 */
export const endpoints = {
  session: '/api/auth/session',
  list: (offset: number, limit: number) =>
    `/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`,
  conversation: (id: string) => `/backend-api/conversation/${requireConversationId(id)}`,
  /**
   * Conversations inside a project are NOT returned by the flat list above — they live behind
   * their own cursor-paginated endpoint. Observed by watching what the project page itself
   * requests (2026-09-03). "snorlax" is ChatGPT's internal name for projects.
   */
  projects: (limit: number, cursor?: string | number) =>
    // conversations_per_gizmo must be >= 1: the server answers 422 to 0. We ignore the
    // conversations it inlines and page them properly via projectConversations instead.
    `/backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=1&limit=${limit}` +
      (cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`),
  projectConversations: (gizmoId: string, cursor: string | number, limit: number) => {
    if (!isProjectId(gizmoId)) throw new Error('Invalid project identifier');
    return `/backend-api/gizmos/${gizmoId}/conversations?cursor=${encodeURIComponent(cursor)}&limit=${limit}`;
  },
} as const;

/**
 * Cached session token. Without this every single API call costs TWO requests — one to
 * /api/auth/session and one to do the actual work — which doubles the traffic of a large
 * batch and is the fastest way to trip ChatGPT's rate limiter.
 * Held in memory only, never persisted.
 */
let cachedToken: string | null = null;
let cachedAccountId: string | null = null;

export interface AccountContext {
  accountId: string;
}

const validAccountId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);

async function sessionContext(forceRefresh = false): Promise<{ token: string; accountId: string }> {
  if (!forceRefresh && cachedToken && cachedAccountId) {
    return { token: cachedToken, accountId: cachedAccountId };
  }
  const res = await fetch(`https://chatgpt.com${endpoints.session}`, {
    credentials: 'include', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
  });
  if (!res.ok) throw new ApiError(res.status);
  const body = await res.json().catch(() => null);
  const token = body?.accessToken;
  const accountId = body?.account?.id;
  if (typeof token !== 'string' || !token.trim()) throw new ApiError(401, 'no_session');
  if (!validAccountId(accountId)) throw new ApiError(422, 'account_context_missing');
  cachedToken = token;
  cachedAccountId = accountId;
  return { token, accountId };
}

/** The account/workspace that every inventory and resumable batch is bound to. */
export async function getAccountContext(forceRefresh = false): Promise<AccountContext> {
  const { accountId } = await sessionContext(forceRefresh);
  return { accountId };
}

/** Refuse to continue when the page session changed since review/confirmation. */
export async function assertAccountContext(expectedAccountId: string): Promise<void> {
  const current = await sessionContext(true);
  if (current.accountId !== expectedAccountId) throw new ApiError(409, 'account_changed');
}

/** Called when the server rejects our token, so the next request fetches a fresh one. */
export const forgetToken = () => {
  cachedToken = null;
  cachedAccountId = null;
};

/** Carries the bits the queue needs to decide retry vs. give up. */
export class ApiError extends Error {
  status: number;
  code?: string;
  retryAfterMs?: number;
  constructor(status: number, code?: string, retryAfterMs?: number) {
    super(`${status}${code ? ` ${code}` : ''}`);
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
  /** Rate limit / server hiccup / offline -> worth retrying. 4xx (except 429) -> not. */
  get transient(): boolean {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
}

export const REQUEST_TIMEOUT_MS = 20_000;

const retryAfterMs = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 5 * 60_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 5 * 60_000)) : undefined;
};

async function call(
  path: string,
  init: RequestInit = {},
  retried = false,
  expectedAccountId?: string,
): Promise<Response> {
  if (!path.startsWith('/backend-api/')) throw new Error('Unexpected ChatGPT endpoint');
  const session = await sessionContext();
  if (expectedAccountId && session.accountId !== expectedAccountId) {
    throw new ApiError(409, 'account_changed');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`https://chatgpt.com${path}`, {
      ...init,
      credentials: 'include',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${session.token}`,
        'ChatGPT-Account-ID': session.accountId,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    if (controller.signal.aborted) throw new ApiError(0, 'request_timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 && !retried) {
    // The cached token expired mid-batch. Refresh once before giving up on the operation.
    forgetToken();
    return call(path, init, true, expectedAccountId);
  }
  if (!res.ok) {
    const code = (await res.json().catch(() => null))?.detail?.code;
    throw new ApiError(res.status, code, retryAfterMs(res.headers.get('Retry-After')));
  }
  return res;
}

/** Offline / DNS / aborted -> status 0, which ApiError treats as transient. */
export const asApiError = (e: unknown): ApiError =>
  e instanceof ApiError ? e : new ApiError(0, String(e));

/** Raw item shape we depend on. Anything not listed here is ignored on purpose. */
interface ApiItem {
  id: string;
  title: string | null;
  create_time: string | null;
  update_time: string | null;
  is_archived?: boolean;
  is_starred?: boolean | null;
  pinned_time?: string | null;
  is_temporary_chat?: boolean;
  gizmo_id?: string | null;
}

/**
 * The pin fields are part of every listing item the API returns. Their presence — not their
 * value — is what tells us the state is known.
 */
const pinKnown = (it: ApiItem): boolean => 'pinned_time' in it || 'is_starred' in it;
const customGizmoId = (value: unknown): value is string =>
  typeof value === 'string' && /^g-[A-Za-z0-9_-]+$/.test(value) && !value.startsWith('g-p-');

const toMs = (s: unknown): number | undefined => {
  if (typeof s !== 'string' || !s) return undefined;
  const ms = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(ms) ? ms : undefined;
};

export function mapApiItem(it: ApiItem): Conversation {
  requireConversationId(it?.id);
  if (it.title !== null && typeof it.title !== 'string') throw new Error('Invalid conversation title');
  return {
    id: it.id,
    title: (it.title ?? '').trim(),
    href: `/c/${it.id}`,
    createdAt: toMs(it.create_time),
    updatedAt: toMs(it.update_time),
    // Two independent pin signals, both set together on a pinned chat (VERIFIED 2026-09-03:
    // pinned_time "2026-09-03T20:15:38Z" + is_starred true). On an unpinned chat the server
    // sends both as **null** — not false — so a null value is an answer, while a MISSING field
    // is the only real "we cannot tell". Reading null as unknown protects every ordinary
    // conversation and stops the product doing anything at all.
    isPinned: pinKnown(it) ? it.pinned_time != null || it.is_starred === true : undefined,
    // Project chats carry a "g-p-" gizmo; a plain "g-" gizmo is a custom GPT, not a project.
    // Same rule: a present-but-null gizmo means "not in a project"; an absent field means
    // we were not told.
    projectId: isProjectId(it.gizmo_id)
      ? it.gizmo_id
      : it.gizmo_id === null || customGizmoId(it.gizmo_id)
        ? null
        : undefined,
    isTemporary: it.is_temporary_chat,
    archived: it.is_archived,
    source: 'api',
  };
}

/** One page. Returns items plus the reported total so paging behavior can be verified. */
export async function listPage(offset = 0, limit = 28, accountId?: string) {
  const body = await (await call(endpoints.list(offset, limit), {}, false, accountId)).json();
  if (!body || typeof body !== 'object' || !Array.isArray(body.items) ||
    !Number.isSafeInteger(body.total) || body.total < 0 ||
    !Number.isSafeInteger(body.offset) || body.offset !== offset ||
    !Number.isSafeInteger(body.limit) || body.limit !== limit ||
    body.items.length > limit) {
    throw new ApiError(422, 'invalid_list_response');
  }
  return {
    total: body.total as number,
    limit: body.limit as number,
    offset: body.offset as number,
    items: (body.items as ApiItem[]).map(mapApiItem),
    rawKeys: Object.keys(body.items?.[0] ?? {}),
  };
}

const patch = async (
  id: string,
  body: Record<string, unknown>,
  accountId?: string,
): Promise<void> => {
  const res = await call(
    endpoints.conversation(id),
    { method: 'PATCH', body: JSON.stringify(body) },
    false,
    accountId,
  );
  const result = await res.json().catch(() => null);
  if (result?.success !== true) throw new ApiError(422, 'unconfirmed_write_response');
};

/** The web app's own page size. The real maximum is unknown, so do not raise it. */
export const PAGE_LIMIT = 28;

export interface Project {
  id: string;
  name: string;
}

/** Page size. The server rejected anything above 50 when verified on 2026-09-03. */
export const PROJECTS_LIMIT = 50;

/**
 * Projects the user owns. Their conversations are invisible to the flat listing.
 *
 * The sidebar route is cursor-paginated. Older responses omitted `cursor`; treat that as one
 * complete page for backwards compatibility. Valid non-project gizmos are ignored because the
 * same sidebar route can include them alongside Projects.
 */
export async function listProjects(limit = PROJECTS_LIMIT, accountId?: string): Promise<Project[]> {
  const projects = new Map<string, Project>();
  const cursors = new Set<string>();
  let cursor: string | number | undefined;

  for (let page = 0; page < 500; page++) {
    const body = await (
      await call(endpoints.projects(limit, cursor), {}, false, accountId)
    ).json();
    if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
      throw new ApiError(422, 'invalid_projects_response');
    }
    for (const item of body.items as Array<{
      gizmo?: { gizmo?: { id?: string; display?: { name?: string } } };
    }>) {
      const gizmo = item.gizmo?.gizmo;
      if (customGizmoId(gizmo?.id)) continue;
      if (!isProjectId(gizmo?.id)) throw new ApiError(422, 'invalid_project_item');
      if (projects.has(gizmo.id)) throw new ApiError(422, 'duplicate_project_item');
      projects.set(gizmo.id, {
        id: gizmo.id,
        name: typeof gizmo.display?.name === 'string' ? gizmo.display.name : gizmo.id,
      });
    }

    // The original response had no cursor and represented a complete single page.
    if (!('cursor' in body) || body.cursor === null) return [...projects.values()];
    if (typeof body.cursor !== 'string' && typeof body.cursor !== 'number') {
      throw new ApiError(422, 'invalid_project_list_cursor');
    }
    const cursorKey = String(body.cursor);
    if (!cursorKey || cursors.has(cursorKey)) throw new ApiError(422, 'project_list_cursor_cycle');
    cursors.add(cursorKey);
    cursor = body.cursor;
  }
  throw new ApiError(422, 'project_list_page_limit_reached');
}

/** Every conversation in one project, following the cursor to the end. */
export async function listProjectConversations(gizmoId: string, accountId?: string): Promise<Conversation[]> {
  const out: Conversation[] = [];
  const cursors = new Set<string>();
  let cursor: string | number = 0;
  for (let page = 0; page < 500; page++) {
    const body = await (
      await call(endpoints.projectConversations(gizmoId, cursor, PAGE_LIMIT), {}, false, accountId)
    ).json();
    if (!body || typeof body !== 'object' || !Array.isArray(body.items) || !('cursor' in body)) {
      throw new ApiError(422, 'invalid_project_conversations_response');
    }
    const items = body.items.map(mapApiItem);
    if (items.some((item: Conversation) => item.projectId !== gizmoId)) {
      throw new ApiError(422, 'project_membership_mismatch');
    }
    out.push(...items);
    if (body.cursor === null) return out;
    if (typeof body.cursor !== 'string' && typeof body.cursor !== 'number') {
      throw new ApiError(422, 'invalid_project_cursor');
    }
    const cursorKey = String(body.cursor);
    if (!cursorKey || cursors.has(cursorKey)) throw new ApiError(422, 'project_cursor_cycle');
    cursors.add(cursorKey);
    cursor = body.cursor;
  }
  throw new ApiError(422, 'project_page_limit_reached');
}

export interface Inventory {
  accountId: string;
  conversations: Conversation[];
  /** How many conversations we actually hold. */
  total: number;
  /** False when a source could not be read to the end. Loaded records remain safe to review. */
  complete: boolean;
  /** User-safe explanations for every detected gap. Never leave a partial read unexplained. */
  issues: string[];
  /** Projects whose conversations could not be fetched, by name. Surfaced to the user. */
  unreadProjects: string[];
  /** Projects that were read, so the panel can offer "select all chats in this project". */
  projects: Project[];
}

/**
 * The whole account: the flat history plus every project's conversations, which the flat
 * listing omits entirely. ~1.2s per request, so report progress.
 */
export async function listAll(onProgress?: (loaded: number) => void): Promise<Inventory> {
  const { accountId } = await getAccountContext(true);
  const seen = new Map<string, Conversation>();
  const unsafeIds = new Set<string>();
  const issues = new Set<string>();
  const unreadProjects: string[] = [];
  const readProjects: Project[] = [];

  let reported = 0;
  let reachedFlatEnd = false;
  for (let offset = 0; offset < 20_000; offset += PAGE_LIMIT) {
    const page = await listPage(offset, PAGE_LIMIT, accountId);
    reported = page.total;
    if (!page.items.length) {
      reachedFlatEnd = true;
      break;
    }
    // Dedupe: order=updated means an item can shift pages mid-run. That yields duplicates
    // (handled here) and can also drop one entirely (caught below).
    for (const c of page.items) {
      if (unsafeIds.has(c.id)) continue;
      const prior = seen.get(c.id);
      if (prior && (prior.isPinned !== c.isPinned || prior.projectId !== c.projectId)) {
        // Never keep one arbitrary version of conflicting protection metadata.
        seen.delete(c.id);
        unsafeIds.add(c.id);
        issues.add('Chats with conflicting protection metadata were excluded.');
      } else {
        seen.set(c.id, c);
      }
    }
    onProgress?.(seen.size);
    // `total` is a live value and can legitimately change between pages. A short page is the
    // reliable end marker; stopping merely because the moving count was reached creates both
    // false warnings and avoidable omissions.
    if (page.items.length < PAGE_LIMIT) {
      reachedFlatEnd = true;
      break;
    }
  }
  if (!reachedFlatEnd) issues.add('The conversation history exceeded the supported page limit.');
  if (seen.size < reported) {
    issues.add('ChatGPT did not return every conversation reported by the history list.');
  }

  // A project we cannot read is a hole in the inventory, never a silent omission.
  try {
    const projects = await listProjects(PROJECTS_LIMIT, accountId);
    for (const project of projects) {
      try {
        for (const c of await listProjectConversations(project.id, accountId)) {
          if (unsafeIds.has(c.id)) continue;
          const prior = seen.get(c.id);
          if (prior && prior.projectId !== c.projectId) {
            seen.delete(c.id);
            unsafeIds.add(c.id);
            issues.add('Chats with conflicting Project metadata were excluded.');
            continue;
          }
          seen.set(c.id, c);
        }
        readProjects.push(project);
        onProgress?.(seen.size);
      } catch {
        unreadProjects.push(project.name);
        issues.add('Some Project conversations could not be read and were excluded.');
      }
    }
  } catch {
    unreadProjects.push('(project list unavailable)');
    issues.add('The Project list could not be read, so Project conversations were excluded.');
  }

  return {
    accountId,
    conversations: [...seen.values()],
    total: seen.size,
    complete: issues.size === 0,
    issues: [...issues],
    unreadProjects,
    projects: readProjects,
  };
}

export const apiAdapter: ConversationAdapter = {
  name: 'api',
  listVisibleConversations: async () => (await listPage(0, 28)).items,
  archive: (id) => patch(id, { is_archived: true }),
  // ChatGPT's own "Delete" sets is_visible:false. Destructive: caller must confirm.
  remove: (id) => patch(id, { is_visible: false }),
};

/** Account-bound adapter used for every reviewed or resumed batch. */
export const apiAdapterFor = (accountId: string): ConversationAdapter => ({
  name: 'api',
  listVisibleConversations: async () => (await listPage(0, PAGE_LIMIT, accountId)).items,
  archive: (id) => patch(id, { is_archived: true }, accountId),
  remove: (id) => patch(id, { is_visible: false }, accountId),
});

export type VerifyResult =
  | { state: 'present'; archived?: boolean }
  | { state: 'deleted' }
  | { state: 'missing' }
  | { state: 'error'; code: number; reason?: string; retryAfterMs?: number };

/**
 * Reads back one conversation to confirm an action landed.
 * MUST use the detail endpoint: the listing index lags behind writes by >4s and was observed
 * a full operation behind, so list-based verification reports the previous state as current.
 */
export async function verify(id: string, accountId?: string): Promise<VerifyResult> {
  let res: Response;
  try {
    res = await call(endpoints.conversation(id), {}, false, accountId);
  } catch (err) {
    const e = asApiError(err);
    if (e.status !== 404) {
      return { state: 'error', code: e.status, reason: e.code, retryAfterMs: e.retryAfterMs };
    }
    return { state: e.code === 'conversation_deleted' ? 'deleted' : 'missing' };
  }
  const body = await res.json().catch(() => null);
  // The response must name the exact conversation requested. Unknown schema fails closed.
  // This still downloads the full detail response; see PRIVACY.md and PRE_RELEASE_AUDIT.md.
  if (body?.conversation_id !== id || typeof body?.is_archived !== 'boolean') {
    return { state: 'error', code: 422 };
  }
  return { state: 'present', archived: body.is_archived };
}
