# Chrome Web Store listing

**Draft — do not submit.** `PRE_RELEASE_AUDIT.md` records unresolved release blockers.

## Name

Chat Cleanup

## Short description (132 char max)

Select and clean hundreds of ChatGPT chats fast. Bulk archive or delete, protect what matters,
resume after a reload.

## Category

Productivity

## Detailed description

ChatGPT lets you delete conversations one at a time. If you have hundreds, that is not a
workflow — it is an afternoon.

Chat Cleanup adds one thing to ChatGPT: a safe way to clear out old conversations in bulk.

**Built for selecting fast**
Multi-select, shift-click for a range, select everything at once, or select every chat inside
one of your Projects in a single click. The Project itself is never touched — only its
conversations.

**What matters is protected**
Select All and shift ranges skip conversations known to be protected or with unverified metadata.
You can include a protected chat by ticking it yourself. Selecting a named Project is an explicit
override for that Project's chats; the current chip also includes pinned/manually protected chats
inside it. Protection synchronization and freshness still need the fixes listed in the audit.

**Review before anything happens**
You see the exact list before you act. Deletion asks for explicit confirmation and states the
count. Nothing is ever deleted automatically.

**A queue that does not fall over**
Conversations are processed one at a time, and every action is verified against ChatGPT
afterwards — a request that returns "OK" is not trusted until the change is confirmed. Rate
limits and hiccups are retried with backoff. If ChatGPT throttles your account, the batch stops
cleanly instead of failing everything.

**Close the tab, keep your progress**
The extension saves batch progress and offers recovery when reopened. The current implementation
can repeat a write whose result was not durably recorded. This must be fixed before release.

**Private by construction**
No separate extension account, developer backend or analytics. Requests go to ChatGPT using your
existing session. The extension reads titles/dates/project metadata and downloads full conversation
detail to verify actions; message bodies are not indexed, persisted or uploaded. Batch titles and
IDs are stored locally. See PRIVACY.md; metadata-only verification or informed opt-in is unresolved.

## Permission justification

- **storage** — remembers which conversations you protected and the state of an unfinished
  batch, so it can be resumed. Local only.
- **Host access to chatgpt.com** — the extension only runs on ChatGPT and makes requests only
  to ChatGPT, using your existing session.

## Single purpose statement

Chat Cleanup has one purpose: reviewing and bulk-archiving or bulk-deleting the user's own
ChatGPT conversations.

## Data usage disclosures

- Does the extension handle user data? **Yes:** website content, conversation/project metadata,
  session authentication information, and full detail responses for verification. Processing and
  batch storage are local; authenticated cleanup requests go to ChatGPT. Complete the current
  store dashboard disclosures accordingly before submission.
- Is data sold to third parties? **No.**
- Is data used for purposes unrelated to the single purpose? **No.**
- Is data used to determine creditworthiness or for lending? **No.**

Privacy policy: see PRIVACY.md in the repository.

## Screenshots to capture (1280x800)

1. The panel open on ChatGPT, showing the conversation list with protection badges.
2. After "Select all": the count plus "N protected chats skipped".
3. Project bulk selection — "Select all chats in a project".
4. The delete confirmation dialog stating the count.
5. Batch progress with the counter and bar.
6. The resume prompt after a reload.
