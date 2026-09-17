# Manual release regression checklist

Run this against the exact ZIP candidate with a disposable ChatGPT account or disposable chats.
Record Chrome version, ChatGPT account type, date, ZIP SHA-256, and observed results.

## Clean install and disclosure

- [ ] `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run package` pass from
      a clean checkout.
- [ ] `dist/` loads from `chrome://extensions` without manifest or console errors.
- [ ] On first open, no history loads before the data-access disclosure is accepted.
- [ ] Close/Escape declines access; **Allow and continue** loads history and is remembered after
      reload.
- [ ] The manifest requests only `storage` and runs only on `https://chatgpt.com/*`.

## Inventory and rules

- [ ] Count includes flat history and conversations inside every Project.
- [ ] Multi-page history (>28 chats) reaches the correct total without duplicates or omissions.
- [ ] Pinned, Project, and unknown-metadata chats show the correct protection badges.
- [ ] Age presets 30/90/180/365 select only chats at or beyond the threshold with known dates.
- [ ] Untitled selects only conversations with an empty title.
- [ ] Each rule and Select all skips protected chats and reports the skipped count.
- [ ] If the reported total changes while paging but the final short page yields the current full
      list, no false partial-list warning appears.
- [ ] If the final loaded ID count is still below ChatGPT's reported total, or a Project cannot be
      read, the panel names the gap; unavailable chats are absent from selection while filters and
      exact-ID actions remain usable for safely loaded rows.
- [ ] A Project list with more than one cursor page is read to `cursor: null` without duplicates.

## Selection and review

- [ ] Individual, Shift-range, Clear, Select all, and Project-group selection behave as labelled.
- [ ] Shift-range spans only visible rows and skips protected rows.
- [ ] Manually protecting a selected chat removes it from the selection and survives reload.
- [ ] A protection added in a second ChatGPT tab appears in the first tab and cannot be lost to a
      simultaneous toggle.
- [ ] Archive and Delete dialogs list every exact title and the exact count; long lists scroll.
- [ ] Hand-picked protected chats are identified as an override.
- [ ] Cancel, Escape, and closing the panel perform no action and retain recovery state.

## Archive and delete

- [ ] Archive disposable chats; every confirmed row disappears and can be restored from ChatGPT
      settings.
- [ ] Delete disposable chats; deletion requires the permanent-action confirmation and the chats
      are actually gone.
- [ ] The verification disclosure is visible before both actions.
- [ ] Progress, Stop, failures, partial completion, full completion, and Back to list report exact
      counts; no failure is silently skipped.
- [ ] Reduced-motion preference removes completion animation.

## Recovery, account, and concurrency

- [ ] Stop with two delete requests in flight: they finish, no new target starts, and untouched
      targets remain queued.
- [ ] Reload and Resume: completed targets are not repeated; an uncertain dispatched target is
      read before any possible write.
- [ ] Not now keeps the recovery record. **Discard saved batch** removes only the local record.
- [ ] Open two ChatGPT tabs and start cleanup in both: only one tab acquires the queue; the other
      reports that cleanup is already running.
- [ ] Switch ChatGPT account/workspace after review: the batch refuses to start. A saved batch is
      not offered in a different account.
- [ ] Sign out or produce a 401/403: the batch halts and keeps resumable state.
- [ ] Produce a 429 with `Retry-After`: the batch pauses without walking through every target.
- [ ] Reload the extension while a ChatGPT tab remains open: the orphaned panel disables actions
      and asks for a page reload.

## Privacy and packaging

- [ ] DevTools Network shows extension requests only to HTTPS `chatgpt.com`; no analytics, beacon,
      remote code, developer server, or third-party request appears.
- [ ] `chrome.storage.local` contains only consent version, protected IDs, lease data while active,
      and the documented unfinished-batch fields. It never contains the bearer token or messages.
- [ ] Full detail response message content is not logged, rendered, or persisted.
- [ ] `unzip -Z1 chat-cleanup.zip` lists exactly manifest, content bundle, and four icons.
- [ ] Screenshot assets use disposable titles and contain no account email, real message content,
      or other personal information.

## Sign-off record

- Tester/date:
- Chrome version / OS:
- ChatGPT plan/account type:
- ZIP SHA-256:
- Flat chats / Project chats / Projects tested:
- Archive result:
- Delete result:
- Stop/Resume result:
- Two-tab/account-switch result:
- Console/network observations:
- Release decision:
