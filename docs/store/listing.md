# Chrome Web Store listing copy

Prepared for the release candidate. The publisher must complete the policy, live-test, privacy
URL, contact, and graphic-asset items in `RELEASE_READINESS.md` before submission.

## Name

Chat Cleanup: Bulk Delete for ChatGPT

## Short description (132 characters maximum)

Select, review, archive, or delete multiple ChatGPT chats safely. Protect important conversations and resume interrupted batches.

## Category

Productivity

## Detailed description

Review and clean a large ChatGPT conversation history without opening and removing chats one by
one.

Chat Cleanup adds a focused cleanup panel directly to ChatGPT. Select conversations manually,
with Shift-click, all at once, by Project, or with deterministic age presets for 30, 90, 180, and
365 days. An untitled-chat rule is also included. The extension never scores importance with AI
and never deletes automatically.

**Review the exact batch**

Before archive or permanent deletion, the confirmation shows the exact conversation titles and
total count. Delete requires an explicit confirmation and clearly states that it cannot be undone.

**Protect important conversations**

Pinned chats, chats inside Projects, manually protected chats, and chats with unknown protection
metadata are excluded from global and rule-based selection. You can still include a protected chat
by selecting it explicitly; the confirmation identifies the override. The extension changes only
conversations, never the Project itself.

**Recover interrupted cleanup**

Archive runs sequentially and delete uses at most two in-flight conversations. Each result is
checked against ChatGPT. Rate limits stop the batch cleanly, failures remain visible, and unfinished
state is stored locally so you can resume after a reload. An uncertain request is reconciled before
the extension can send it again.

**Local and narrow by design**

There is no Chat Cleanup account, backend, analytics, advertising, or cloud sync. The extension
runs only on chatgpt.com and sends requests only to ChatGPT through your signed-in session. It asks
for informed consent before reading history. Verification can download a selected conversation's
detail response, which may contain messages; message content is not analyzed, retained, or sent to
the developer. See the linked privacy policy for the complete disclosure.

Chat Cleanup is an independent extension and is not affiliated with or endorsed by OpenAI.

## Permission justification

- **storage** — stores the disclosure-consent version, manually protected conversation IDs, and
  unfinished queue state in the current Chrome profile so a safe batch can be recovered.
- **Access to chatgpt.com** — injects the cleanup UI and sends the user-approved list, archive,
  delete, and verification requests to ChatGPT. No other website is accessed.

## Single purpose statement

Chat Cleanup lets a user review and bulk-archive or bulk-delete conversations in their own ChatGPT
history.

## Privacy practices dashboard

Disclose conservatively because Chrome requires disclosure even for local-only processing:

- **Authentication information:** handled in memory to authenticate requests to ChatGPT; not
  collected by or transmitted to the developer.
- **Website content / user-generated content / personal communications:** conversation metadata
  is displayed locally; selected conversation detail responses can contain message content during
  result verification. Message content is not retained or transmitted to the developer.
- **Persistent identifiers:** ChatGPT account/workspace and conversation IDs are used for targeting
  and recovery; protection and unfinished-batch IDs are stored locally.
- **Data sale, advertising, credit, unrelated use:** none.
- **Limited Use certification:** data is used only for the extension's stated cleanup function.

Keep the dashboard answers, this listing, the in-product disclosure, and `PRIVACY.md` identical in
substance.

## Store assets

- 128×128 store icon: `public/icons/icon128.png`.
- Prepared the 440×280 promotional tile in `docs/store/assets/`. Regenerate it with
  `npm run build:store-assets`.
- Capture up to five 1280×800 screenshots from a disposable account:
  1. First-run disclosure.
  2. Age preset with protected chats skipped.
  3. Exact archive/delete review list.
  4. Live progress or rate-limit pause.
  5. Completion report or reload/Resume prompt.
- The 440×280 small promotional tile is ready. A 1400×560 marquee tile is optional.
- Do not show real names, email addresses, private titles, message text, or account identifiers.

## Publisher fields still required

- Public HTTPS URL hosting `PRIVACY.md`.
- Working support email and support URL.
- Primary language and distribution regions.
- Publisher identity/trader-status fields required for the selected regions.
