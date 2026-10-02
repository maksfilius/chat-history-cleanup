import { isConversationId } from '../types/identifiers.ts';

/**
 * Performs the archive write from the page's own world.
 *
 * `PATCH /backend-api/conversation/<id> { is_archived: true }` sent from the content script's
 * isolated world is accepted — 200, and the detail endpoint reports `is_archived: true` — yet
 * for many conversations nothing is archived, permanently: re-sending never moves them
 * (observed 2026-10-01/02 across a whole account). The identical request issued by a script
 * running in the page archives those same conversations. Chrome sends an isolated-world fetch
 * with a different origin and fetch-metadata, and something on ChatGPT's side acts on that.
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

interface Request {
  channel: typeof CHANNEL;
  type: 'archive';
  requestId: string;
  id: string;
}

type Outcome = { ok: true } | { ok: false; status: number; code?: string };

const isRequest = (value: unknown): value is Request => {
  const m = value as Partial<Request> | null;
  return !!m && m.channel === CHANNEL && m.type === 'archive' &&
    typeof m.requestId === 'string' && m.requestId.length <= 64 && isConversationId(m.id);
};

async function archive(id: string): Promise<Outcome> {
  const session = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' });
  if (!session.ok) return { ok: false, status: session.status, code: 'no_session' };
  const token = (await session.json().catch(() => null))?.accessToken;
  if (typeof token !== 'string' || !token.trim()) {
    return { ok: false, status: 401, code: 'no_session' };
  }
  const res = await fetch(`/backend-api/conversation/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_archived: true }),
  });
  if (!res.ok) {
    const code = (await res.json().catch(() => null))?.detail?.code;
    return { ok: false, status: res.status, code };
  }
  // The caller still confirms against the archived listing. A 2xx here proves nothing on its
  // own; that is the whole reason this file exists.
  return { ok: true };
}

window.addEventListener('message', (event: MessageEvent) => {
  // Same-window only: a message from a frame or another origin is not ours.
  if (event.source !== window || !isRequest(event.data)) return;
  const { requestId, id } = event.data;
  const reply = (result: Outcome) =>
    window.postMessage({ channel: CHANNEL, type: 'result', requestId, ...result }, '/');
  archive(id).then(reply, () => reply({ ok: false, status: 0, code: 'bridge_error' }));
});
