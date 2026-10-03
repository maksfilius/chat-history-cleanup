import { isConversationId } from '../types/identifiers.ts';

/**
 * Performs the archive write from the page's own world.
 *
 * `PATCH /backend-api/conversation/<id> { is_archived: true }` sent from the content script's
 * isolated world is accepted — 200, and the detail endpoint reports `is_archived: true` — yet
 * for many conversations nothing is archived, permanently: re-sending never moves them
 * (reported in the 2026-10-01/02 investigation). Keep the page-world transport used by the
 * working competitor. The precise server-side cause still needs a controlled live regression;
 * execution world alone does not prove that Chrome sends a different Origin header.
 *
 * Only archiving goes through here, deliberately. Any script on the page can post to this
 * bridge, so whatever it exposes is exposed to chatgpt.com itself; archiving is reversible from
 * ChatGPT's own settings, and deleting is not. Deleting stays in the isolated world, where it
 * works and where the page cannot reach it.
 *
 * The session token is read here and never travels in a message: postMessage is readable by
 * every script on the page.
 */
const CHANNEL = 'chat-cleanup-bridge';
// Captured at document_start, before page code can replace fetch.
const pageFetch = window.fetch.bind(window);
// Finish/abort before the isolated caller's 20-second response deadline.
const TIMEOUT_MS = 18_000;

interface Request {
  channel: typeof CHANNEL;
  type: 'archive';
  requestId: string;
  id: string;
  accountId: string;
}

type Outcome = { ok: true } | { ok: false; status: number; code?: string; retryAfterMs?: number };

const validAccountId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);

const isRequest = (value: unknown): value is Request => {
  const m = value as Partial<Request> | null;
  return !!m && m.channel === CHANNEL && m.type === 'archive' &&
    typeof m.requestId === 'string' && m.requestId.length > 0 && m.requestId.length <= 64 &&
    isConversationId(m.id) && validAccountId(m.accountId);
};

const failure = async (res: Response): Promise<Outcome> => {
  const code = (await res.json().catch(() => null))?.detail?.code;
  const retry = res.headers.get('Retry-After');
  const seconds = retry === null || !retry.trim() ? NaN : Number(retry);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry ?? '') - Date.now();
  return { ok: false, status: res.status, code: typeof code === 'string' ? code : undefined,
    retryAfterMs: Number.isFinite(delay) ? Math.max(0, Math.min(delay, 300_000)) : undefined };
};

async function archive(id: string, accountId: string, signal: AbortSignal, retried = false): Promise<Outcome> {
  const session = await pageFetch('/api/auth/session', {
    credentials: 'include', cache: 'no-store', redirect: 'error', signal,
  });
  if (!session.ok) return failure(session);
  const body = await session.json().catch(() => null);
  const token = body?.accessToken;
  if (typeof token !== 'string' || !token.trim()) {
    return { ok: false, status: 401, code: 'no_session' };
  }
  if (!validAccountId(body?.account?.id)) {
    return { ok: false, status: 422, code: 'account_context_missing' };
  }
  if (body.account.id !== accountId) return { ok: false, status: 409, code: 'account_changed' };
  // An expired caller must not start a late write after its session request finally resolves.
  signal.throwIfAborted();
  const res = await pageFetch(`/backend-api/conversation/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
    signal,
    headers: { Authorization: `Bearer ${token}`, 'ChatGPT-Account-ID': accountId,
      'Content-Type': 'application/json' },
    body: JSON.stringify({ is_archived: true }),
  });
  if (res.status === 401 && !retried) return archive(id, accountId, signal, true);
  if (!res.ok) return failure(res);
  const result = await res.json().catch(() => null);
  if (result?.success !== true) return { ok: false, status: 422, code: 'invalid_write_response' };
  // The queue still checks the exact conversation through the detail endpoint. A valid
  // response is required here, but is not sufficient to declare the operation completed.
  return { ok: true };
}

window.addEventListener('message', (event: MessageEvent) => {
  // Same-window only: a message from a frame or another origin is not ours.
  if (event.source !== window || event.origin !== window.location.origin || !isRequest(event.data)) return;
  const { requestId, id, accountId } = event.data;
  const reply = (result: Outcome) =>
    window.postMessage({ channel: CHANNEL, type: 'result', requestId, ...result }, '/');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  archive(id, accountId, controller.signal)
    .then(reply, () => reply({ ok: false, status: 0,
      code: controller.signal.aborted ? 'request_timeout' : 'bridge_error' }))
    .finally(() => clearTimeout(timer));
});
