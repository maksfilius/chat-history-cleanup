# Chrome Web Store listing copy

Prepared for the release candidate. The publisher must complete the policy, live-test, privacy
URL, and contact items in `RELEASE_READINESS.md` before submission.

## Name

Bulk Delete & Archive ChatGPT Chats — Chat Cleanup

Renamed in 0.2.0 to state the target platform and actions explicitly: ChatGPT, bulk delete,
and archive. This makes the listing easier to identify for those searches; ranking gains
have not been measured or guaranteed.

## Short description (132 characters maximum)

Bulk delete or archive ChatGPT chats safely. Filter by age, review every selection, protect important chats, and resume anytime.

## Category

Productivity

## Detailed description

Bulk delete or archive selected ChatGPT chats without clearing your entire history.

Chat Cleanup adds multi-select and cleanup filters directly to chatgpt.com. Choose old or unwanted
conversations, review the exact titles and count, then archive them or permanently delete them.

WHAT YOU CAN DO

• Select individual conversations or a range with Shift-click
• Select all eligible conversations at once
• Find chats last active at least 30, 90, 180, or 365 days ago
• Find untitled conversations
• Review the exact batch before anything changes
• Bulk archive or permanently delete the selected chats
• Stop an active batch and resume it after reloading the page
• See progress and failures for every conversation

BUILT TO PREVENT ACCIDENTS

Nothing is deleted automatically. Every archive or delete batch requires confirmation and shows
the affected titles and total count. Permanent deletion has a separate warning because it cannot
be undone.

Pinned chats, chats inside Projects, manually protected chats, and chats whose protection status
cannot be verified are skipped by automatic filters and Select all. You can still select a
protected conversation manually, and Chat Cleanup identifies that override before starting.

If you may need a conversation later, choose Archive. Archived chats remain available through
ChatGPT settings. After ChatGPT accepts archive requests, its sidebar and Archived chats list may
take several minutes to update. Chat Cleanup shows when you should wait instead of repeating the
same action.

HOW IT WORKS

1. Open ChatGPT and click the Clean up button.
2. Select conversations manually or filter them by last activity.
3. Review the exact list of chats.
4. Choose Archive or Delete and follow the visible progress.

PRIVATE BY DESIGN

Chat Cleanup has no account, backend, analytics, advertising, or cloud sync. It runs only on
chatgpt.com and communicates only with ChatGPT through your existing signed-in session. To verify
a result, it may retrieve a selected conversation's detail response from ChatGPT. Message content
is not analyzed, retained, or sent to the developer. Protection and unfinished-batch state are
stored locally in Chrome.

Chat Cleanup is free. It works with the ChatGPT web app in Chrome and requires a signed-in ChatGPT
account.

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
- Prepared three 1280×800 screenshots from the production bundle on the real ChatGPT surface,
  using a fresh Chrome profile and fictional staged metadata:
  1. `01-select-old-chats-1280x800.png` — last-activity preset with protected chats skipped.
  2. `02-review-before-delete-1280x800.png` — exact destructive-action review list.
  3. `03-cleanup-complete-1280x800.png` — accepted archive requests with a prominent delayed-list notice.
- Regenerate screenshots with `npm run capture:store-screenshots`, then visually review them
  before upload because the ChatGPT host page can change.
- The 440×280 small promotional tile is ready. A 1400×560 marquee tile is optional.
- Do not show real names, email addresses, private titles, message text, or account identifiers.

## Published listing

- Store URL: `https://chromewebstore.google.com/detail/chat-cleanup-%E2%80%94-bulk-archi/ldaeofnbfjlljghcfflkalndgfkdeahi`.
- Extension ID: `ldaeofnbfjlljghcfflkalndgfkdeahi`.
- Public privacy policy: `https://chatcleanup.com/privacy/`.
- Support email: `chatcleanup.support@gmail.com`.
- Support URL: `https://github.com/maksfilius/chat-history-cleanup/issues`.
- Version `0.1.0` was approved and publicly released on 2026-09-28.
- Version `0.2.0` is a local release candidate, not submitted. It renames the listing, updates
  archive transport and error handling, reports archive status as returned by ChatGPT, and
  explains possible delayed list updates without claiming a proven ChatGPT bug. The user
  reports successful archive with variable delay; the complete release sign-off remains open.

## Remaining presentation checks for 0.2.0

- Done locally: refresh the Store and public-site archive screenshots for the current accepted
  request status and prominent delayed-list notice.
- Explain possible delayed sidebar/archive list updates in Store copy. The landing FAQ now
  explains the delay without attributing it to a proven ChatGPT bug.
- Done locally: replace the landing's privacy promise with the accurate scope: no data sent
  to the developer or third parties; requests go to ChatGPT.
- Done locally: check the actual public site in `pages/` at desktop and mobile widths.
  `test:landing` covers the separate interactive harness, not this public marketing page.
