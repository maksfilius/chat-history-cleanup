# ChatGPT Integration Notes

## 2026-09-05 audit correction — current build is release-blocked

The historical observations below are not current contract guarantees. The actual panel uses
the API exclusively. There is no automatic DOM fallback; DOM archive/delete are now disabled
because menu ownership and confirmation cannot be verified. Release developer globals were removed.

The audit reproduced unsafe replay after interrupted writes, unawaited persistence, multiple
controllers sharing a queue key, malformed restored operation kinds, unknown pin metadata being
selected, and page-generated UI authorization. See `PRE_RELEASE_AUDIT.md` for evidence and status.
Documentation saying an idempotent server operation means a request is never repeated is incorrect.

Bounded guards now require canonical conversation UUIDs, project-shaped IDs and encoded cursors;
requests use the fixed HTTPS ChatGPT origin, no redirects, no cache and no page referrer. PATCH must
return `success: true`. A detail response is accepted only if its `conversation_id` equals the
requested UUID and `is_archived` is boolean. **This exact detail identity field must be verified
on a disposable live account before release.** If absent or changed, the guard returns a permanent
verification error and the queue must not retry that write. No fallback to an unnamed response is
permitted. These are conservative validation requirements, not new live endpoint observations.

Null pin signals remain unknown. Only explicit `is_starred: false` together with `pinned_time: null`
is treated as unpinned. If current ChatGPT returns null for all ordinary chats, broad selection
will skip them: there is no reliable negative pin signal yet. Individual selection stays possible.
Missing/unrecognized project membership also remains unknown and protected.

`verify()` downloads and parses **full conversation detail, including message content**. It does
not persist or analyze the messages, but this violates a literal metadata-only access claim and
needs a researched alternative or informed opt-in before release. The cached token is kept in
memory and transmitted back to ChatGPT; account/workspace binding remains unresolved. No live
account was accessed as part of this audit.

The reproduction instructions at the end describe the old spike UI, not the current build.

Status: **Milestone 0 complete. Findings below were VERIFIED live on 2026-09-03** against a
logged-in Plus account (8 conversations, 5 archived, 1 project chat, German UI) by executing
the spike's probes in the page context of `https://chatgpt.com`.

Confidence tags:

- `VERIFIED` — observed live on 2026-09-03.
- `PARTIAL` — endpoint/field exists and behaves, but the test account had no instance of the
  case (e.g. no pinned chat), so the positive path is unconfirmed.
- `UNKNOWN` — not measurable on this account.

## Where the assumptions live

- `src/chatgpt/selectors.ts` — every DOM assumption.
- `src/chatgpt/api.ts` — every endpoint/payload assumption.

Both are consumed only through `ConversationAdapter` (`src/types/conversation.ts`).

## Conversation discovery

### A. DOM route — usable for selection UI, NOT for inventory

- Rows are `a[href^="/c/<uuid>"]` inside `#history`. `VERIFIED`
- `#history` exists as a stable id. `VERIFIED`
- **Do not match nav by `aria-label` text**: the labels are localized (observed
  `"Seitenleiste"`, `"Chatverlauf"` on a German UI). Selector matching must stay
  language-independent. `VERIFIED`
- **Project conversations use a second URL shape**: `/g/g-p-<projectId>/c/<uuid>`, not
  `/c/<uuid>`. Matching only `/c/` made every conversation inside a project invisible to the
  DOM adapter. Both shapes are now matched and parsed. `VERIFIED 2026-09-03`
- **Pinning a chat moves it out of `#history`** into the "Angeheftet"/Pinned section.
  `listDomConversations()` queries document-wide rather than inside `#history`, so it still
  finds pinned chats — but anything scoped to `#history` (such as the lazy-load scroller) will
  silently miss them. `VERIFIED`
- The DOM held 7 of the account's 8 conversations. The missing one was the project chat,
  which is not rendered in flat history. **The DOM is a subset of the truth.** `VERIFIED`
- The DOM does not react to API-driven changes: after deleting a conversation, its sidebar
  row was still present. Our UI must remove rows itself. `VERIFIED`

### B. Internal endpoint route — the real source of truth

```text
GET   /api/auth/session                                      -> { accessToken }
GET   /backend-api/conversations?offset&limit&order=updated  -> { items, total, limit, offset }
GET   /backend-api/conversation/<id>                         -> detail (includes full mapping)
PATCH /backend-api/conversation/<id>                         -> { is_archived } | { is_visible }
```

Auth: a same-origin `credentials: 'include'` fetch to `/api/auth/session` returns the session
`accessToken`. Read per call, held in a local variable, never stored, logged or transmitted.
No host permissions and no background service worker needed. `VERIFIED`

**Two traps, both confirmed live — this is the most important finding in this document:**

1. A cookie-only request to the list endpoint returns **HTTP 200 with a silently partial
   result** (6 of 8 conversations) instead of an error. A cleanup tool that reads a partial
   inventory and then acts on "everything old" is exactly the bug that loses user data.
2. A cookie-only request to the detail endpoint returns **404**, which is indistinguishable
   from "conversation gone" unless you know to look.

Both are avoided by one rule, enforced in `api.ts`: **every `/backend-api` call sends the
Authorization header.** `VERIFIED`

Paging: `offset`/`limit` with a reported `total`; offset 0 and offset 3 at limit 3 returned
disjoint pages (overlap 0). `VERIFIED`. The maximum accepted `limit` is `UNKNOWN` (the account
is too small to probe a cap); keep the web app's own value of 28.

Cost: the list endpoint averaged **~1.2 s per call** over 15 sequential calls. A 700-chat
inventory is ~25 pages ≈ 30 s. Budget for it in the UI. `VERIFIED`

## Metadata availability

Real field list of `items[0]`, verified 2026-09-03:

```text
id, title, create_time, update_time, latest_assistant_turn_created_at, pinned_time, mapping,
current_node, conversation_template_id, gizmo_id, is_archived, is_starred, is_temporary_chat,
is_do_not_remember, memory_scope, context_scopes, context_scopes_v2, workspace_id,
async_status, safe_urls, blocked_urls, conversation_origin, is_automation_conversation,
snippet, summary_metadata, sugar_item_id, sugar_item_visible
```

| Field | Verdict | Note |
|---|---|---|
| `id` | RELIABLE `VERIFIED` | UUID, identical in DOM and API |
| `title` | RELIABLE `VERIFIED` | non-empty on all 8; untitled rule unproven |
| `createdAt` / `updatedAt` | RELIABLE `VERIFIED` | ISO-8601 with `Z`; every age filter rests on `update_time` |
| `archived` | RELIABLE `VERIFIED` | `is_archived`; `?is_archived=true` is a working separate listing |
| `projectId` | RELIABLE `VERIFIED` | `gizmo_id` prefixed `g-p-` = project. A plain `g-` gizmo is a custom GPT, **not** a project — do not protect on `gizmo_id != null` alone |
| `isTemporary` | `PARTIAL` | `is_temporary_chat` present and `false` on all 8; positive case unseen |
| `isPinned` | RELIABLE `VERIFIED` | a pinned chat carries **both** `pinned_time` (ISO) and `is_starred: true`; unpinned chats have both `null`. Since `null` also means "cannot see", the mapping yields `true` or `undefined`, **never** `false` |
| `messageCount` | UNAVAILABLE for v1 `VERIFIED` | `mapping`/`snippet`/`current_node` are all `null` in the listing. The detail endpoint does return it (110 nodes on a test chat) — but that is 1 request per conversation **and it returns full message content**, which violates the metadata-only privacy posture. Do not build the short-chat filter on it. |

Fail-safe rule encoded in `mapApiItem`: unknown stays `undefined`, never `false`.

## Actions

### Archive `VERIFIED`

```text
UI route:            row "…" menu -> Archive
Request:             PATCH /backend-api/conversation/<id>  { "is_archived": true }
Response:            200 { "success": true }
Success signal:      GET detail -> is_archived: true (immediately correct)
Reversible:          yes — PATCH { "is_archived": false } restored it, 200
Failure signal:      404 { detail: { code: "conversation_not_found" } }
Fallback:            domAdapter.archive() clicks the real row menu
```

### Delete `VERIFIED`

```text
UI route:            row "…" menu -> Delete -> confirm dialog
Request:             PATCH /backend-api/conversation/<id>  { "is_visible": false }
Response:            200 { "success": true }
Success signal:      GET detail -> 404 { detail: { code: "conversation_deleted" } }
Failure signal:      404 { detail: { code: "conversation_not_found" } } = id was never valid
Fallback:            domAdapter.remove() + confirm-dialog click (dialog click NOT implemented)
```

**The two 404 codes are different and Milestone 5 depends on it:** `conversation_deleted`
means our own destructive action already landed (mark done, never replay after a reload),
while `conversation_not_found` means the id was never valid (a real error). Encoded in
`verify()` as `state: 'deleted' | 'missing'`.

### Verification must not use the listing `VERIFIED`

The listing index lags writes badly. Measured: after an unarchive, the listing still reported
the conversation as archived ~1 minute later; after a subsequent archive, the listing showed
the *previous* operation's state and had not caught up 4 s later. The detail endpoint was
correct immediately every time.

Reconfirmed during the Milestone 2 live test, minutes apart on the same conversation: the
listing returned `is_archived: false` while the detail endpoint returned `true` for a
conversation the queue had just archived successfully.

Consequence: **confirm every queued action with the detail endpoint, never by re-listing.**
A queue that re-lists to check its work will read stale state and retry completed destructive
operations. `verify()` is written this way.

### Rate limiting `VERIFIED — the limit is real and reachable`

15 sequential list calls: no 429. **No rate-limit headers are exposed at all** (responses carry
only `x-build`, `x-content-type-options`, `x-oai-is-update`, `x-oai-request-id`), so a limit can
only be detected by catching a 429 — there is no budget to read in advance.

**But sustained use across a development session did trip it.** ChatGPT showed the account:

> "Du stellst zu viele Anfragen in kurzer Zeit. Der Zugriff auf deine Unterhaltungen wurde
> vorübergehend eingeschränkt, um deine Daten zu schützen."

That message restricted the user's access to their **own conversation list in ChatGPT's own
UI**, not just ours. It cleared on its own within minutes. This is the single most important
operational constraint on the product: our traffic can lock the user out of their own history.

Request cost per conversation, before the fix:

```text
PATCH  = /api/auth/session + /backend-api/conversation/<id>   = 2 requests
verify = /api/auth/session + /backend-api/conversation/<id>   = 2 requests
                                                        total = 4 per conversation
```

A 700-conversation cleanup was therefore ~2 800 requests. **Caching the session token halves
that to 2**, and the token is valid for the whole session, so there was never a reason to
re-fetch it per call.

Design consequences, all implemented:

- the session token is cached in memory and only re-fetched on a 401;
- a 429 that survives the retry ladder **halts the entire batch** rather than failing each
  remaining conversation in turn — a rate limit is a property of the account, not of one
  conversation;
- the halted batch stays persisted and resumable, so waiting a few minutes costs nothing;
- `x-oai-request-id` is worth surfacing in failure reports.

Still unknown: the actual threshold (requests per minute/hour). It was reached over a long
session of mixed probing and batches, not from a single measured burst.

### Pinned chats stay in the cleanup candidate set `VERIFIED`

Pinning does **not** remove a conversation from the default listing — the pinned chat was still
returned among the 8. So a broad age rule will happily select it, and Milestone 4's protection
is the only thing standing between a pinned chat and a bulk delete. It has to be a hard filter,
not a UI hint.

### Conversations inside projects need a second endpoint `VERIFIED — RESOLVED 2026-09-03`

The flat `/backend-api/conversations` listing does **not** return conversations that live inside
a project. Found by watching what the project page itself requests, rather than by guessing:

```text
GET /backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=N&limit=<=50
    -> { items: [ { gizmo: { gizmo: { id: "g-p-...", display: { name } } } } ], cursor }
GET /backend-api/gizmos/<gizmoId>/conversations?cursor=0&limit=28
    -> { items: [ <same item shape as the flat listing> ], cursor }
```

"snorlax" is ChatGPT's internal name for projects. Notes:

- project conversations page by **cursor**, not by `offset`; `cursor: null` ends the walk;
- `conversations_per_gizmo=0` is rejected with 422 — it must be >= 1, so we pass 1 and ignore
  the inlined conversations, paging them properly instead;
- `limit` on the sidebar endpoint is capped at 50 (422 above that, with a helpful message);
- items carry the same fields as the flat listing, including `gizmo_id`, so they map through
  `mapApiItem` unchanged and come out protected as "in a project".

**Measured impact on the verification account:**

```text
flat listing            7 conversations
project A                7
project B               17
project C                2   (these 2 ALSO appear in the flat listing)
------------------------------------------------
unique total           31        the panel had been showing 7
```

**24 of 31 conversations — 77% of the account — were invisible to the product.**

Consistent with the data, though inferred from only three projects: the two projects whose
conversations are missing from the flat listing are the **pinned** ones (sidebar section
"Angeheftet"), while the unpinned project's conversations appear in both. That matches the
original user report ("chats in the Angeheftet folder do not show at all").

`listAll()` now reads the flat listing and every project, dedupes by id, and marks the
inventory incomplete — naming the projects it could not read — if any project fetch fails.

## Risks

1. **Undocumented endpoints.** `/backend-api/*` can change without notice. Mitigated by the
   adapter boundary plus a working DOM fallback.
2. **Silent partial reads** (see traps above) are the highest-severity failure mode for this
   product: partial inventory + broad age rule = deleting the wrong things. Discovery should
   additionally sanity-check `items.length` against the reported `total` before any bulk action.
3. **Terms/policy.** The calls are the ones the user's own session already makes, on their own
   data, user-initiated, one at a time, nothing proxied or uploaded. Worth a policy read before
   store submission.
4. **Temporary-chat detection unproven.** `is_temporary_chat` was `false` on every conversation;
   the positive case is still unseen, so that protection must fail safe. Pinned detection is
   now verified.
5. **Project conversations need their own endpoint** (resolved above). The lesson generalises:
   the flat listing is not the account. Any future "where did that chat go" report should start
   by diffing the sidebar against the inventory.
6. **DOM fallback is partial:** `domAdapter.remove()` opens the menu but does not click the
   confirmation dialog.
7. **Optimistic ids.** A newly created chat's URL is `/c/WEB:<uuid>` until the server assigns
   the real id. `conversationIdFromHref` rejects it by design (regression-tested) — PATCHing it
   would 404.

## Recommendation for the MVP adapter strategy

**Hybrid, API-first.** Verified, not assumed:

- **Discovery + metadata: API only.** The DOM cannot supply `update_time`, `is_archived` or a
  total, and it was missing a conversation outright. Every cleanup filter needs age.
- **Actions: API,** sequential, verified through the detail endpoint, with `dom.ts` kept as a
  drop-in fallback behind the same interface.
- **DOM: selection/highlighting UI only** — plus the knowledge that it will not self-refresh
  after our writes.

Switching cost if the API breaks: implement two methods in `dom.ts`.

## Reproducing this

1. `npm install && npm run build`
2. `chrome://extensions` → Developer mode → Load unpacked → select `dist/`
3. Open `https://chatgpt.com`; the "Chat Cleanup — spike" panel appears bottom-right.
4. Read-only: **Scan DOM**, **Probe API**, **Probe paging**, **Scroll+count**.
5. Actions: create a disposable chat, paste its id (from the URL, after it stops being
   `WEB:…`) into the panel, then **Archive one** → **Verify** → **Delete one…**.

The panel acts on exactly one id at a time and cannot run a batch — deliberate for the spike.

### What the live run actually did

Created one throwaway conversation, archived it, unarchived it, archived it again, deleted it,
and confirmed removal. No pre-existing conversation was read, modified, archived or deleted;
the account started and ended at 8 conversations. No message content was collected — only the
metadata field names and flags recorded above.
