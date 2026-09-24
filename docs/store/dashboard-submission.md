# Chrome Web Store dashboard submission

Use this checklist for version `0.1.0`. Keep these answers consistent with `listing.md` and
`PRIVACY.md`.

## 1. Package

- Add new item and upload `chat-cleanup.zip`.
- Confirm name: `Chat Cleanup — Bulk Archive & Delete`.
- Confirm version: `0.1.0`.
- Confirm the package declares only `storage` and `https://chatgpt.com/*`.

Expected SHA-256:

```text
7e07c9e3044bfe27c02435653f5501b0878d14f4929ff3814170731b8032e07e
```

## 2. Store listing

- Primary language: `English`.
- Category: `Productivity`.
- Detailed description: copy the complete **Detailed description** section from `listing.md`.
- Store icon, if the dashboard asks for it: `public/icons/icon128.png`.
- Screenshots, in order:
  1. `docs/store/assets/01-select-old-chats-1280x800.png`
  2. `docs/store/assets/02-review-before-delete-1280x800.png`
  3. `docs/store/assets/03-cleanup-complete-1280x800.png`
- Small promo tile: `docs/store/assets/promo-tile-440x280.png`.
- Promo video: leave empty.
- Marquee promo tile: leave empty.
- Official URL: leave empty until the publisher controls a verified product domain.
- Homepage URL: leave empty until the product landing page is current.
- Support URL: `https://github.com/maksfilius/chat-history-cleanup/issues`.
- Mature content: `No` / unchecked.

The short description is read from `manifest.json`:

```text
Select, review, archive, or delete multiple ChatGPT chats safely. Protect important conversations and resume interrupted batches.
```

## 3. Privacy practices

### Single purpose

```text
Chat Cleanup lets a user review and bulk-archive or bulk-delete conversations in their own ChatGPT history.
```

### Permission justifications

`storage`:

```text
Stores the disclosure-consent version, manually protected conversation IDs, and unfinished queue state in the current Chrome profile so a safe batch can be recovered after a reload.
```

Host access / `https://chatgpt.com/*`:

```text
Runs the cleanup interface on chatgpt.com and sends user-approved list, archive, delete, and verification requests only to ChatGPT. The extension does not access any other website.
```

### Remote code

Select:

```text
No, I am not using remote code.
```

All executable code is included in the extension package. Requests to ChatGPT exchange data and
do not download or execute code.

### Data types

Select these categories, using the closest current dashboard labels:

- Personally identifiable information — ChatGPT account/workspace identifiers and conversation
  identifiers are handled to bind actions to the correct account and conversation.
- Authentication information — the existing ChatGPT session token/cookies are handled in memory
  to authenticate requests back to ChatGPT.
- Personal communications — a selected conversation's detail response can contain messages during
  result verification.
- Website content — conversation titles, dates, state, Project membership, and selected detail
  responses are processed locally.

Do not select financial information, health information, location, web history, or user activity:
the extension does not intentionally collect those categories. Conversation content is disclosed
under personal communications and website content; it is not classified, logged, or retained.

### Data-use certifications

Confirm every dashboard statement covering these facts:

- data is not sold or transferred to third parties outside approved use cases;
- data is not used or transferred for purposes unrelated to the extension's single purpose;
- data is not used or transferred for creditworthiness or lending;
- data is not used for personalized advertising, if that certification is shown;
- handling complies with the Chrome Web Store User Data Policy and Limited Use requirements.

Privacy policy URL:

```text
https://maksfilius.github.io/chat-history-cleanup/privacy/
```

## 4. Distribution

- In-app purchases / paid functionality: `No`.
- Visibility: `Public`.
- Regions: `All regions`.

Use deferred publishing in the final submission dialog by disabling automatic publishing after
approval. This permits one final listing check after review and before the public release. An
approved staged submission must be published within 30 days.

## 5. Test instructions

No test credentials are supplied. Paste:

```text
Prerequisite: Sign in to https://chatgpt.com/ with a reviewer-owned ChatGPT account that has at least two disposable conversations. Chat Cleanup has no separate account, backend, payment, or credentials.

1. Open https://chatgpt.com/ and click the Clean up button in the lower-right corner.
2. Review the data-access disclosure and click Allow and continue.
3. Select conversations manually, with Select all, or with an age preset.
4. Click Archive, review the exact titles and count, and confirm. Progress and the completion report remain visible.
5. To test deletion, select a disposable conversation, click Delete, review the permanent-action confirmation, and confirm.
6. To test recovery, begin a batch with several disposable conversations, click Stop, reload the page, reopen Chat Cleanup, and choose Resume.

Pinned conversations, conversations inside Projects, manually protected conversations, and conversations with unknown protection metadata are excluded from automatic selection. A reviewer can still select a protected conversation explicitly; the confirmation identifies the override.

The extension communicates only with https://chatgpt.com/ using the reviewer's existing signed-in session. It has no developer-operated server or analytics.
```

## 6. Submission

- Save each tab and resolve every validation marker.
- Re-open Store listing, Privacy practices, Distribution, and Test instructions once before
  submission.
- Click **Submit for Review**.
- In the confirmation dialog, turn off automatic publishing to stage the approved release.
- Save the item ID and the review-status URL in the release notes.
