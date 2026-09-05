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
  projects: (limit: number) =>
    // conversations_per_gizmo must be >= 1: the server answers 422 to 0. We ignore the
    // conversations it inlines and page them properly via projectConversations instead.
    `/backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=1&limit=${limit}`,
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

async function accessToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const res = await fetch(`https://chatgpt.com${endpoints.session}`, {
    credentials: 'include', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
  });
  if (!res.ok) throw new ApiError(res.status);
  const token = (await res.json())?.accessToken;
  if (typeof token !== 'string' || !token.trim()) throw new ApiError(401, 'no_session');
  cachedToken = token;
  return token;
}

/** Called when the server rejects our token, so the next request fetches a fresh one. */
export const forgetToken = () => {
  cachedToken = null;
};

/** Carries the bits the queue needs to decide retry vs. give up. */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, code?: string) {
    super(`${status}${code ? ` ${code}` : ''}`);
    this.status = status;
    this.code = code;
  }
  /** Rate limit / server hiccup / offline -> worth retrying. 4xx (except 429) -> not. */
  get transient(): boolean {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
}

async function call(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  if (!path.startsWith('/backend-api/')) throw new Error('Unexpected ChatGPT endpoint');
  const res = await fetch(`https://chatgpt.com${path}`, {
    ...init,
    credentials: 'include',
    redirect: 'error',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 && !retried) {
    // The cached token expired mid-batch. Refresh once before giving up on the operation.
    forgetToken();
    return call(path, init, true);
  }
  if (!res.ok) {
    const code = (await res.json().catch(() => null))?.detail?.code;
    throw new ApiError(res.status, code);
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
    projectId: isProjectId(it.gizmo_id) ? it.gizmo_id : 'gizmo_id' in it ? null : undefined,
    isTemporary: it.is_temporary_chat,
    archived: it.is_archived,
    source: 'api',
  };
}

/** One page. Returns items plus the reported total so paging behavior can be verified. */
export async function listPage(offset = 0, limit = 28) {
  const body = await (await call(endpoints.list(offset, limit))).json();
  return {
    total: body.total as number | undefined,
    limit: body.limit as number | undefined,
    offset: body.offset as number | undefined,
    items: (body.items as ApiItem[]).map(mapApiItem),
    rawKeys: Object.keys(body.items?.[0] ?? {}),
  };
}

const patch = async (id: string, body: Record<string, unknown>): Promise<void> => {
  const res = await call(endpoints.conversation(id), { method: 'PATCH', body: JSON.stringify(body) });
  const result = await res.json().catch(() => null);
  if (result?.success !== true) throw new ApiError(422, 'unconfirmed_write_response');
};

/** The web app's own page size. The real maximum is unknown, so do not raise it. */
export const PAGE_LIMIT = 28;

export interface Project {
  id: string;
  name: string;
}

/** The server rejects anything above 50 with a 422 (verified 2026-09-03). */
export const PROJECTS_LIMIT = 50;

/** Projects the user owns. Their conversations are invisible to the flat listing. */
export async function listProjects(limit = PROJECTS_LIMIT): Promise<Project[]> {
  const body = await (await call(endpoints.projects(limit))).json();
  return (body.items ?? [])
    .map((it: { gizmo?: { gizmo?: { id?: string; display?: { name?: string } } } }) => {
      const g = it.gizmo?.gizmo;
      return g?.id ? { id: g.id, name: g.display?.name ?? g.id } : null;
    })
    .filter((p: Project | null): p is Project => p !== null);
}

/** Every conversation in one project, following the cursor to the end. */
export async function listProjectConversations(gizmoId: string): Promise<Conversation[]> {
  const out: Conversation[] = [];
  let cursor: string | number = 0;
  for (let page = 0; page < 500; page++) {
    const body = await (
      await call(endpoints.projectConversations(gizmoId, cursor, PAGE_LIMIT))
    ).json();
    out.push(...(body.items ?? []).map(mapApiItem));
    if (!body.cursor) break;
    cursor = body.cursor;
  }
  return out;
}

export interface Inventory {
  conversations: Conversation[];
  /** How many conversations we actually hold. */
  total: number;
  /**
   * False when any source could not be read to the end.
   * Bulk actions MUST refuse to run on an incomplete inventory: a partial list plus a broad
   * age rule deletes the wrong things. See the silent-partial-read trap in
   * docs/chatgpt-integration.md.
   */
  complete: boolean;
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
  const seen = new Map<string, Conversation>();
  let complete = true;
  const unreadProjects: string[] = [];
  const readProjects: Project[] = [];

  let reported = 0;
  for (let offset = 0; offset < 20_000; offset += PAGE_LIMIT) {
    const page = await listPage(offset, PAGE_LIMIT);
    reported = page.total ?? reported;
    if (!page.items.length) break;
    // Dedupe: order=updated means an item can shift pages mid-run. That yields duplicates
    // (handled here) and can also drop one entirely (caught below).
    for (const c of page.items) seen.set(c.id, c);
    onProgress?.(seen.size);
    if (seen.size >= reported) break;
  }
  if (seen.size < reported) complete = false;

  // A project we cannot read is a hole in the inventory, never a silent omission.
  try {
    for (const project of await listProjects()) {
      try {
        for (const c of await listProjectConversations(project.id)) seen.set(c.id, c);
        readProjects.push(project);
        onProgress?.(seen.size);
      } catch {
        complete = false;
        unreadProjects.push(project.name);
      }
    }
  } catch {
    complete = false;
    unreadProjects.push('(project list unavailable)');
  }

  return {
    conversations: [...seen.values()],
    total: seen.size,
    complete,
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

export type VerifyResult =
  | { state: 'present'; archived?: boolean }
  | { state: 'deleted' }
  | { state: 'missing' }
  | { state: 'error'; code: number };

/**
 * Reads back one conversation to confirm an action landed.
 * MUST use the detail endpoint: the listing index lags behind writes by >4s and was observed
 * a full operation behind, so list-based verification reports the previous state as current.
 */
export async function verify(id: string): Promise<VerifyResult> {
  let res: Response;
  try {
    res = await call(endpoints.conversation(id));
  } catch (err) {
    const e = asApiError(err);
    if (e.status !== 404) return { state: 'error', code: e.status };
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
