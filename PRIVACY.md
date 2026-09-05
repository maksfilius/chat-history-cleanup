# Privacy Policy — Chat Cleanup

Last updated: 2026-09-03

## The short version

Chat Cleanup has no servers. It cannot collect your data, because there is nowhere to send it.

## What the extension does

Chat Cleanup runs entirely inside your browser, on `chatgpt.com` only. It lists your
conversations, lets you choose some, and asks ChatGPT to archive or delete them — the same
actions you can already perform by hand, one at a time, in ChatGPT's own interface.

## What we collect

Nothing. There is no backend, no account, no analytics, no telemetry, no error reporting, and
no third-party service of any kind.

## What leaves your browser

Only requests to `chatgpt.com`, made from your own logged-in session, to:

- list your conversations and their metadata;
- archive or delete the conversations you selected;
- read back a conversation to confirm an action actually took effect.

No request is made to any other domain. Your conversation content is never uploaded anywhere.

## What the extension reads

Conversation **metadata** only: id, title, creation and update time, archived flag, pinned
flag, and project membership. This is what the age filters and protection rules need.

The extension does not read, index, or transmit the messages inside your conversations.

## What the extension stores

In `chrome.storage.local`, on your machine only:

- the ids of conversations you manually marked as protected;
- the state of an unfinished batch, so it can be resumed after a reload.

Both stay on your computer. Neither is ever transmitted. Removing the extension removes them.

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
