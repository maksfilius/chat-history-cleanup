# Chat Cleanup

A focused Chrome extension for safely cleaning large ChatGPT conversation histories.

## Product idea

ChatGPT lets users delete or archive conversations individually, but managing hundreds of old chats is cumbersome. Chat Cleanup provides a safer bulk-cleanup workflow built around review, protection rules, and reliable queued operations.

**Positioning:**

> Clean hundreds of old ChatGPT chats safely in minutes.

## Status

Pre-MVP / validation stage.

The first version should remain intentionally small and local-only.

## Product boundary

**Free — better manual control.** The user decides what gets cleaned; our job is to make
choosing and executing it fast and safe.

**Pro (not built) — helps decide what to clean and automates repetitive cleanup.** Nothing of
it ships today; the roadmap is tracked privately.

Safety is never a paid feature. Confirmation before deletion, the reliable queue, progress,
retry/backoff, protection from accidental bulk selection and clear error states all stay Free.
There are no artificial Free limits — no cap on how many conversations you may select or delete.

## Free v1

- Manual multi-select, with shift-click range selection.
- Select all unprotected conversations.
- Select all chats inside a Project (the Project itself is never touched).
- Clear selection.
- Bulk archive and bulk delete, with explicit confirmation stating the count.
- Pinned and Project conversations are protected from bulk gestures, and can still be
  included by hand.
- Manual protection you set yourself, stored locally.
- Sequential queue with progress, retry/backoff and rate-limit handling.
- An interrupted batch survives a reload and can be resumed without repeating anything.

## Not in Free v1

Date filters, suggested cleanup, short/untitled heuristics and any automatic recommendation are
deliberately absent — they belong to Pro. No accounts, backend, payments, AI classification,
cloud sync, or multi-AI support.

## Start here

If you are working on this codebase, read in this order:

1. `README.md` — this file: what Free v1 is and is not.
2. `docs/chatgpt-integration.md` — every verified finding about how ChatGPT's own endpoints
   behave, including the traps that will bite you (silently partial reads, a listing index that
   lags writes, conversations hidden inside projects).
3. `src/chatgpt/` — the adapter boundary. Every ChatGPT-specific assumption lives here and
   nowhere else.

Product planning, the Free/Pro boundary and the task log are kept outside this repository.

## Suggested stack

- Manifest V3
- TypeScript
- React
- Vite
- chrome.storage.local

## Product validation principle

The goal of v1 is not feature completeness. The goal is to answer:

> Is cleanup sufficiently better than the native ChatGPT workflow that users install and keep the extension?
