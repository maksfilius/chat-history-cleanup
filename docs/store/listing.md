# Chrome Web Store listing copy

Prepared for the release candidate. The publisher must complete the policy, live-test, privacy
URL, and contact items in `RELEASE_READINESS.md` before submission.

## Name

Bulk Delete & Archive ChatGPT Chats — Chat Cleanup

Renamed in 0.2.0. Store search weighs the name most heavily and the previous one did not contain
"ChatGPT" — the word people actually type. The brand moves to the tail because it earns no
searches yet, and "Archive" stays because that query has far less competition than "delete".

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
• Find chats older than 30, 90, 180, or 365 days
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

If you may need a conversation later, choose Archive. Archived chats leave the sidebar but remain
available through ChatGPT settings.

HOW IT WORKS

1. Open ChatGPT and click the Clean up button.
2. Select conversations manually or apply an age filter.
3. Review the exact list of chats.
4. Choose Archive or Delete and follow the visible progress.

PRIVATE BY DESIGN

Chat Cleanup has no account, backend, analytics, advertising, or cloud sync. It runs only on
chatgpt.com and communicates only with ChatGPT through your existing signed-in session. Message
content is not analyzed, retained, or sent to the developer. Protection and unfinished-batch state
are stored locally in Chrome.

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
  1. `01-select-old-chats-1280x800.png` — age preset with protected chats skipped.
  2. `02-review-before-delete-1280x800.png` — exact destructive-action review list.
  3. `03-cleanup-complete-1280x800.png` — successful archive completion report.
- Regenerate screenshots with `npm run capture:store-screenshots`, then visually review them
  before upload because the ChatGPT host page can change.
- The 440×280 small promotional tile is ready. A 1400×560 marquee tile is optional.
- Do not show real names, email addresses, private titles, message text, or account identifiers.

## Published listing

- Store URL: `https://chromewebstore.google.com/detail/chat-cleanup-%E2%80%94-bulk-archi/ldaeofnbfjlljghcfflkalndgfkdeahi`.
- Extension ID: `ldaeofnbfjlljghcfflkalndgfkdeahi`.
- Public privacy policy: `https://maksfilius.github.io/chat-history-cleanup/privacy/`.
- Support email: `chatcleanup.support@gmail.com`.
- Support URL: `https://github.com/maksfilius/chat-history-cleanup/issues`.
- Version `0.1.0` was approved and publicly released on 2026-09-28.
- Version `0.2.0` renames the listing, stops reporting unconfirmed archives as successful, and
  explains that a failed archive is ChatGPT's fault rather than the extension's. Submitted after
  a real-account regression run.
