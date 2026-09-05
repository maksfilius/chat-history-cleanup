# Manual regression checklist

Run before every release. Use disposable conversations for anything destructive — create three
by sending "test" in a new chat.

## Install

- [ ] `npm ci && npm run build` succeeds from a clean checkout.
- [ ] `chrome://extensions` → Load unpacked → `dist/` loads with no errors on the card.
- [ ] Icon renders crisply in the toolbar (16/32), on the extensions page (48) and in the
      store listing (128).
- [ ] Open `https://chatgpt.com` → the "Clean up" button appears without any manual step.

## Discovery

- [ ] The count matches the account: flat conversations **plus** every project's conversations.
- [ ] Chats inside projects appear, badged `project`.
- [ ] Pinned chats appear, badged `pinned`.
- [ ] Archived chats do not appear in the default list.
- [ ] With a project deliberately unreachable (offline mid-load), the panel warns that the list
      is incomplete and names the project, and both action buttons stay disabled.

## SPA navigation

- [ ] Click a conversation in the sidebar → exactly one panel instance remains mounted.
- [ ] Selection survives the navigation.
- [ ] ChatGPT's own layout is untouched: sidebar, composer, and message area behave normally.

## Selection (Free v1 — manual only)

- [ ] No date filters or "Suggested cleanup" section appear anywhere.
- [ ] Individual conversations can be selected and deselected; the count follows.
- [ ] "Select all" selects every unprotected conversation and reports how many protected ones
      it skipped.
- [ ] Shift-click selects a range, and protected conversations inside that range are skipped.
- [ ] "Clear" appears only when something is selected, and empties the selection.
- [ ] A project chip selects every conversation in that project; clicking it again deselects
      them. Nothing in the UI offers to delete the project itself.

## Protection

- [ ] Project and pinned conversations show "protected — …" and are dimmed.
- [ ] The lock toggles manual protection; the state survives a page reload.
- [ ] Hand-picking a protected conversation is allowed, and the confirm dialog names the
      override ("Includes protected conversations: 2 in a project").

## Actions

- [ ] Archive on a disposable chat: confirm dialog states the count, progress runs, the row
      disappears from ChatGPT's sidebar, and the chat is archived in ChatGPT settings.
- [ ] Delete on a disposable chat: confirmation is explicit and states the count.
- [ ] Cancelling the dialog does nothing at all.
- [ ] A failure is listed with a reason and is not silently skipped.

## Interruption and recovery

- [ ] Stop mid-batch → the batch halts after the current conversation.
- [ ] Reload → the panel offers Resume, naming how many already finished.
- [ ] Resume completes without repeating anything already done.
- [ ] Discard forgets the batch without undoing what happened.
- [ ] After a fully completed batch, no resume prompt appears.

## History sizes

- [ ] Empty history: panel shows 0 conversations and does not error.
- [ ] Small history (< 28, one page): loads in one request.
- [ ] Large history (> 28, several pages): progress counts up, the total is right, and the UI
      stays responsive while rows render.

## Rate limiting

- [ ] Under a 429, the batch halts with the "rate-limited, nothing was lost" message rather
      than failing every remaining conversation.
- [ ] The halted batch resumes cleanly once the limit clears.

---

## Verified live 2026-09-04 (build with the report fix)

- [x] Content script mounts by itself; exactly one instance.
- [x] Panel lists flat conversations plus every project's; project/pinned rows badged.
- [x] Select all skips protected and reports the count skipped.
- [x] Shift-click range skips protected inside the range.
- [x] Project chip selects and deselects that project's chats.
- [x] Clear appears only when something is selected.
- [x] Delete confirmation states the count and names a protected override.
- [x] Cancel does nothing.
- [x] After a batch the report stays on screen; "Back to list" restores the list once.
