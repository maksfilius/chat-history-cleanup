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

`0.2.0` renames the extension for Store search and contains the current archive transport.
On 2026-10-03 the user successfully archived 28 chats in one batch; processing took several
minutes and the chats remained visible in the sidebar for a further few minutes. This validates
that observed batch, but does not establish a guaranteed list-update time.

## Current archive UX — 2026-10-03

Archiving remains available. A completed batch now says “Wait for ChatGPT to update” and
“N archive requests accepted by ChatGPT.” A visually distinct notice says chats may remain
visible for several minutes and tells the user not to archive them again: wait a few minutes,
then reload ChatGPT or check Settings → Data controls → Archived chats. Partial results show
the same notice when at least one archive request succeeded. No statement attributes the delay
to a proven ChatGPT bug or guarantees a maximum delay.

The extension no longer removes archived rows from ChatGPT's sidebar itself; it leaves that
rendering to ChatGPT. Successfully processed IDs still leave our local cleanup list. Delete
behaviour is unchanged. The browser test checks both the status wording and that the archive
sidebar row is not artificially removed.

Comparison baseline for the 0.1.0 source review: commit `1e7b65b` (release preparation).
There is no release tag proving an exact Store ZIP match. Main extension differences are the
name/summary, MAIN archive bridge, bounded inventory retries and clearer load errors, a
redundant verification-read reduction, and the updated archive UX/tests. Filters, protections,
selection, delete endpoint, and requested permissions are unchanged from that source baseline.

## Latest correction — chats reached the archive after a delay (2026-10-02)

The user corrected the preceding report: the chats did reach the archive, but with a delay.
For those observed chats, the native archive action was not permanently failing. The exact
latency and the mechanism behind delayed visibility were not measured. HTTP 429 was observed
for inventory loading separately; causation between that limit and the archive delay is not
established. This does not yet validate every previous extension batch or the release ZIP.

Treat earlier statements below that these same chats were never archived as superseded by
this correction. Do not repeat archive writes solely because the sidebar or archived list has
not updated yet. Future live checks should record the request outcome, elapsed time, and eventual
active/archive state separately. Further transport changes need evidence beyond immediate
listing visibility. No additional requests were made to the user's account for this update.

## Live batch confirmation — 28 chats (2026-10-03)

The user reports that an extension batch archived all 28 selected chats successfully. Queue
processing took several minutes, then the chats remained visible in the sidebar for another
few minutes before ChatGPT's list caught up. This supports the distinction between completed
archive requests and delayed list visibility. The completion UI was made more prominent around
that distinction; it does not promise a fixed delay.

## Latest observation — native archive now also fails (2026-10-02)

After earlier native success, the user now reports that ChatGPT's own three-dot Archive
also fails, the archived list does not load, and the competitor extension fails too.
Our inventory warning is specifically mapped from HTTP 429; this establishes throttling
for an inventory request, not the status or durable result of the archive PATCH.
OpenAI's public status page currently reports operational; that does not exclude an
account/session-specific problem. It is not yet established that both extensions were
disabled and the page reloaded when the native failure was observed.

Do not attribute the current failure exclusively to our transport or declare it a proven
native bug. Pause request-generating tests. Recheck one disposable native archive after
throttling subsides in a browser session with both extensions disabled and a fresh page.
No further transport changes are justified without that control or a captured failing response.

## Live feedback — archive failure still reproducible (2026-10-02)

The user retested after the bridge/account/header changes: rows disappear but return after
reload. The user also confirmed that ChatGPT's native Archive menu persists correctly.
The previous transport changes did NOT resolve the reported bug. MAIN versus ISOLATED,
account headers, and synthetic success tests are not an established root cause.

Next step: capture and compare native versus extension archive for an explicitly chosen
throwaway conversation on the affected browser, then verify state after reload. Do not
repeat speculative transport changes or label the returning rows a propagation delay.
The immediate detail-based confirmation remains insufficient on this affected account.

Browser access in the agent environment currently finds only the headless Chrome process
for the local landing preview (`/tmp/chat-cleanup-pages-preview`), with zero exposed tabs.
No live authenticated ChatGPT tab was accessed and no user conversations were changed.

## Archive investigation update — 2026-10-02

**Reported symptom:** chats disappear when archive reports success, then return after reload.
The MAIN bridge is already present in 0.2.0, but a controlled real-account regression of the
exact ZIP is still required. Do not describe this issue as resolved based on synthetic tests.

Static inspection of competitor `daipnaolfenpglcjgjkgeaandppiabgn` version 5.2.2 confirms that it
uses MAIN at document_start, captures page fetch, gets the session token/account ID, and sends
`PATCH {is_archived:true}` with `chatgpt-account-id`. Its package was read, not installed.

This review found and corrected these gaps in our implementation:

- The bridge omitted the account header and never compared its fresh session to the reviewed
  account. The isolated world's cached session check did not protect the actual write.
- It accepted any 2xx body. It now requires `success === true` before detail verification.
- Its fetches outlived the caller's timeout. They now share an abort deadline; a late session
  response cannot start an archive write after that deadline.
- It now captures page fetch at document_start, refreshes once on 401, and propagates Retry-After.
- The existing browser test accidentally ran BOTH bundles in ISOLATED. It now uses separate
  worlds. An additional browser regression uses a backend fixture outside the page and destroys
  both worlds before re-reading active and archived listings.

The old handoff's assertion about Chrome sending a different origin was not demonstrated by
retained request evidence. A matching endpoint/body alone also cannot prove that a native DOM
click would behave identically. Keep the MAIN implementation, but treat the server-side cause
as unconfirmed until a controlled live test establishes it.

The queue still uses detail identity plus is_archived for immediate confirmation. Archive
listings were observed to lag, so they are not polled per operation. For release validation,
check durable state after reload and in ChatGPT's Archived chats. Returning rows must not be
explained away as delay without evidence. The completion UI describes possible delayed list updates without claiming a proven cause.

See `docs/chatgpt-integration.md` for current evidence and the explicit regression gates.

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
&& npm run test:landing`. The browser suite drives production bundles against synthetic data in separate worlds.
`test/archive-browser.mjs` also verifies active/archive state after a fresh navigation.
These checks validate our implementation, not ChatGPT server behaviour.

## Automated verification from this review

Typecheck, 109 unit tests, build, browser safety, separate-world archive/reload regression,
and landing browser checks pass. Browser tests used Chrome 154 with synthetic backend data;
no live ChatGPT session was accessed. The 0.2.0 ZIP was rebuilt; its current hash is in
`docs/store/dashboard-submission.md`. Changes are uncommitted; nothing was submitted.

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
