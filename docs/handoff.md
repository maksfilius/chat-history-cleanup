# Handoff

Written 2026-10-02, after two days spent on one bug. Read the archive section before touching
anything that writes to ChatGPT.

## Where the project stands

Chat Cleanup is a Chrome extension that adds multi-select, age filters and a review step to
chatgpt.com, then bulk-archives or bulk-deletes the selection. No backend, no account, no
analytics; two permissions, `storage` and `https://chatgpt.com/*`.

| | |
| --- | --- |
| Published | `0.1.0`, approved 2026-09-28, [Store listing](https://chromewebstore.google.com/detail/chat-cleanup-%E2%80%94-bulk-archi/ldaeofnbfjlljghcfflkalndgfkdeahi) |
| Packaged, not submitted | `0.2.0` — `chat-cleanup.zip`, SHA-256 in `docs/store/dashboard-submission.md` |
| Landing | live at `https://maksfilius.github.io/chat-history-cleanup/`, deploys from `pages/` on push to `main` |

`0.2.0` renames the extension for Store search and carries the archive fix below. It has **not**
been through a real-account regression run — that is the main thing left.

## The archive bug, and why it took two days

**Symptom.** Archiving reported success, the row vanished from the sidebar, and after a reload
the conversation was back. Deleting worked fine.

**Root cause.** The request was being sent from the content script's **isolated world**. Chrome
issues that fetch with a different origin and fetch-metadata, and ChatGPT accepts it — `200
{"success": true}`, and the detail endpoint dutifully reports `is_archived: true` — while
archiving nothing, permanently. Re-sending never moved a conversation.

**Fix.** `src/content/pageBridge.ts`, a second content script declared `"world": "MAIN"` in the
manifest. The isolated world asks it over `postMessage`; it performs the PATCH from the page
itself, where the identical request works. Available since Chrome 111; the manifest already
required 120.

Only archiving goes through the bridge, deliberately:

- any script on chatgpt.com can post to it, so whatever it exposes is exposed to the page;
- archiving is reversible from ChatGPT's own settings, deleting is not;
- deleting therefore stays in the isolated world, where it has always worked.

The session token is read inside the bridge and never travels in a message — every script on the
page can read those.

### What was ruled out first, so you do not repeat it

All of these were measured and are dead ends. The request content was never the problem.

| Hypothesis | How it died |
| --- | --- |
| The archived listing simply lags | The conversation was absent from ChatGPT's own Archived chats too |
| Wrong account or workspace | One `personal` account; the native button sends the same `ChatGPT-Account-ID` |
| The endpoint or payload changed | ChatGPT's own Archive menu item sends the byte-identical `PATCH /backend-api/conversation/<id> {"is_archived":true}` |
| Missing headers | Replaying with the app's full set — `oai-did`, `originator`, `x-openai-web-frontend` — changed nothing |
| A missing `POST /backend-api/conversation/init` first | Replayed init + patch; nothing |
| A second channel (WebSocket, XHR, beacon) | Hooks on all four: the native click emits exactly one request and nothing else, then or in the following minute |
| The Work/Chat surface toggle | Same result in both |

A DOM adapter that clicked the row menu was also built and reverted — clicking the menu produces
that same PATCH, so it could never have helped.

### The second trap: confirming the archive

Having learned that `detail.is_archived` can be `true` for an unarchived conversation, the
obvious move is to confirm against `?is_archived=true` instead. **Do not.** That listing is built
from an index that trails writes by tens of seconds and varies with load:

```text
+3.1s   detail=true   listed=false
+9.7s   detail=true   listed=false
+21.2s  detail=true   listed=false
+33.5s  detail=true   listed=false
```

A batch confirming against it reports its own successful work as failed. The detail field only
lied while the write was not archiving; once the bridge made the write real, it became correct
and immediate, which is what `verify()` uses.

ChatGPT's sidebar is built from the same trailing index, which is why an archived conversation
sits there for a few minutes. The archive success screen says so; that is the honest answer to
the original symptom.

## What you can and cannot trust in ChatGPT's API

Full detail in `docs/chatgpt-integration.md`. The short version:

| Thing | Verdict |
| --- | --- |
| `GET detail -> is_archived` | Immediate and correct — **provided the write came from the page world** |
| `?is_archived=true` listing | Correct eventually; trails by tens of seconds. Never use it to confirm a write |
| `total` on a listing | Unreliable. Reported 29 for an account with 65 — page until a short page |
| Cookie-only requests | The list answers 200 with a silently partial set; the detail endpoint 404s. Always send the bearer token |
| Rate limits | Per endpoint, and burst-sensitive. Three parallel pages all 429 while a single request before and after returned 200. No `Retry-After`, no `x-ratelimit-*` headers exist |
| `DELETE /backend-api/conversation/id/<id>` | A newer delete route, seen elsewhere. We still use `PATCH {is_visible:false}`, which works |

The rate limit is the single most important operational constraint: our traffic can lock the user
out of their own history in ChatGPT's own UI. Inventory reads retry once on a 429 and then stop —
retrying harder spends a budget that is already gone.

## Layout

```
src/content/pageBridge.ts   main-world bridge; archive only
src/content/panel.ts        the UI
src/chatgpt/api.ts          endpoints, session, listAll, verify, archiveViaPage
src/chatgpt/dom.ts          sidebar reads; DOM writes stay disabled
src/queue/                  the operation queue: retries, persistence, single-writer lease
pages/                      the landing site, deployed by .github/workflows/pages.yml
landing/                    interactive demo; a local harness, no longer published
```

`build.mjs` emits two bundles, `dist/content.js` and `dist/pageBridge.js`. Both are in the
packaging allowlist in `scripts/package-extension.mjs`; a new file that is not listed will not
ship.

Gate before any commit: `npm run typecheck && npm test && npm run build && npm run test:browser
&& npm run test:landing`. The browser suite drives the real bundle against a synthetic ChatGPT
and loads both worlds, so it exercises the bridge protocol end to end.

## Before submitting 0.2.0

1. **Real-account regression** against the exact zip, per `docs/store/regression-checklist.md`.
   Verify the SHA first.
2. **A large batch.** 50+ conversations in one run: speed, and whether the rate limiter bites
   mid-batch. Never tested at that size with a working archive.
3. Everything else in the dashboard checklist is already updated: name, version, hash.

## Not done, and worth doing

- **Custom domain.** The landing is on `maksfilius.github.io`, which accrues no authority and is
  expensive to move once indexed. `pages/README.md` has the one-command swap.
- **Search Console**, sitemap submitted.
- **Store reviews.** Nothing ranks without them; `docs/landing-seo.md` has the reasoning and the
  competitor numbers.
- **Blog.** Two posts shipped, the queue of next ones is in `docs/landing-seo.md`.
- `loadFailure()` in `panel.ts` maps a failed inventory load to a human reason. It is not unit
  tested — it lives in a module the node tests do not import.

## Method notes

Four wrong diagnoses were shipped and reverted over these two days. Every one came from
measuring what was easy instead of what mattered. The specific traps:

- **`requestAnimationFrame` does not fire** in a tab driven by CDP `Runtime.evaluate`. Any
  scroll-driven or animation-driven effect measures as dead. Use real input through the
  computer tool, or screenshots.
- **Programmatic `scrollTop` does not trigger ChatGPT's sidebar loader**; a real wheel event
  does. "No lazy loading" was wrong because of this.
- **A diagnostic without the bearer token measures a different endpoint** than the extension
  uses. A cookie-only probe said 200 while the authenticated one was 429.
- **Validate the oracle before trusting it.** A confirmation helper was written, never checked
  against a known-positive, and then used to "prove" three hypotheses.
- **Evidence from an account the user is also acting on is contaminated.** Two conversations
  that appeared to arrive late had probably been archived by hand. The user caught that; I had
  not controlled for it.

The pattern worth keeping: when a request looks byte-identical to one that works, stop examining
the request. Ask who is sending it.
