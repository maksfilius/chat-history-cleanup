# Privacy Policy — Chat Cleanup

Last updated: 2026-09-24

## Summary

Chat Cleanup processes your ChatGPT history locally in your browser. It has no
developer-operated backend, analytics, advertising, telemetry, or third-party reporting. It
sends requests only to `https://chatgpt.com` using your existing ChatGPT session.

Before the extension reads your history for the first time, it shows an in-product disclosure
and asks you to allow access. The consent version is stored in this Chrome profile.

## Data the extension handles

The extension reads:

- ChatGPT account/workspace ID and session authentication token;
- conversation IDs, titles, creation/update dates, archive and pinned status, temporary-chat
  status when present, and Project membership;
- Project IDs and names;
- full conversation detail responses after you confirm a batch, solely to verify the identity
  and final archive/deletion state of each selected conversation.

A detail response can contain message content. Chat Cleanup does not inspect message text for
classification, index it, retain it, or send it to the developer. The confirmation dialog repeats
this disclosure before each archive/delete batch.

## How data is used and transmitted

The data is used only to list cleanup candidates, apply protection rules, perform the actions you
approve, verify their results, and recover an interrupted batch.

Requests go only to `https://chatgpt.com` over HTTPS. They can include conversation or Project IDs,
the requested archive/delete flag, the ChatGPT account ID, session cookies, and a bearer token.
Redirects are rejected and the page referrer is suppressed. No ChatGPT data is transmitted to the
extension developer or to another service.

## Local storage

The extension stores the following in `chrome.storage.local` for this Chrome profile:

- the current privacy-disclosure consent version;
- conversation IDs you manually protect;
- for an unfinished batch: schema version, ChatGPT account/workspace ID, action type, start time,
  and each selected conversation's ID, title, state, attempt count, and optional error.

Completed batch records are removed. Unfinished records remain until the batch completes, or you
explicitly discard the recovery record. Manual protection IDs remain until you unprotect them or
uninstall the extension. Chrome removes extension-local data when the extension is uninstalled.
The extension does not use Chrome Sync.

## Session credentials

The ChatGPT token is held in page memory, is never written to storage or logged, and is sent only
back to ChatGPT. A persisted batch contains the account/workspace ID so it cannot be resumed in a
different account.

## Permissions

- `storage` stores consent, protected conversation IDs, and unfinished queue state locally.
- Access to `https://chatgpt.com/*` lets the content script provide the cleanup UI and communicate
  with ChatGPT on the page where you invoke it.

No other Chrome permissions are requested.

## Limited Use

Chat Cleanup's use of user data complies with the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data),
including the Limited Use requirements. User data is used only to provide the cleanup
functionality described in the extension's listing and interface. It is not sold, used for
advertising or creditworthiness, or used for any unrelated purpose.

## Your controls

Nothing is archived or deleted until you select conversations and confirm the exact batch. You
can stop a running batch, discard an unfinished recovery record, remove manual protections, or
uninstall the extension to remove its local data.

## Contact

For privacy or support questions, open an issue at
<https://github.com/maksfilius/chat-history-cleanup/issues>.
