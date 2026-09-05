# Privacy Policy — Chat Cleanup

Last updated: 2026-09-05

## The short version

Chat Cleanup has no developer-operated backend, analytics, or third-party reporting service.
It handles your ChatGPT data locally and sends authenticated requests to ChatGPT. This
pre-release build is not approved for production use; see `PRE_RELEASE_AUDIT.md`.

## What the extension does

Chat Cleanup runs entirely inside your browser, on `chatgpt.com` only. It lists your
conversations, lets you choose some, and asks ChatGPT to archive or delete them — the same
actions you can already perform by hand, one at a time, in ChatGPT's own interface.

## How we handle data

The extension accesses conversation metadata and your ChatGPT session token to provide its
cleanup workflow. Verification also downloads full conversation detail, including messages.
There is no separate extension account, analytics, telemetry, or remote error reporting.
No data is sent to the extension developer or a separate third-party service.

## What leaves your browser

Only requests to `chatgpt.com`, made from your own logged-in session, to:

- list your conversations and their metadata;
- archive or delete the conversations you selected;
- read back a conversation to confirm an action actually took effect.

These requests transmit conversation/project IDs, action flags, session cookies and a bearer
token to `https://chatgpt.com`. Request redirects are rejected and the extension suppresses the
page referrer. Conversation titles and message bodies are not included in outgoing request bodies.

## What the extension reads

Conversation metadata: ID, title, creation and update time, archived flag, pinned flag, and
project membership. Project discovery also reads project names and IDs.

To check the result of an action, the extension downloads and parses ChatGPT's conversation
detail response. That response can contain the full messages, even though the extension only
uses its identity and archive status. It does not index, analyze, persist or upload those
message bodies. The session response can also contain account information; only its token is
retained in memory. A metadata-only verification mechanism or explicit informed opt-in is a
release blocker, as documented in the audit.

## What the extension stores

In `chrome.storage.local`, on your machine only:

- the ids of conversations you manually marked as protected;
- batch action type, start time, schema version, and each conversation's ID, **title**, action,
  state, attempt count and optional error, for progress and attempted recovery.

The storage records stay in this browser profile and do not use Chrome sync. Conversation IDs
from a resumed batch are sent to ChatGPT when executing that batch. Pending records have no
automatic expiry; the UI can discard them. Settled batches are cleared, subject to the known
storage/recovery defects in the audit. Manual protection IDs remain until removed or the
extension is uninstalled. Removing the extension removes its local storage.

## Session credentials

To talk to ChatGPT the extension reads the session token that your browser already holds for
`chatgpt.com`, exactly as the ChatGPT web page itself does. The token is kept in memory for the
lifetime of the page, is never written to storage, and is never sent anywhere except back to
`chatgpt.com`.

## Permissions

- `storage` — to remember your protected conversations and an unfinished batch.
- Host access to `https://chatgpt.com/*` — the extension only runs there.

No other permissions are requested.

## Contact

Questions about this policy: open an issue in the project repository.
