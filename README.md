# Chat Cleanup

A focused Chrome extension for reviewing and bulk-cleaning a large ChatGPT conversation history.

> Clean hundreds of old ChatGPT chats safely in minutes.

## Release status

The repository contains a tested **release candidate**, not a submitted public release. Automated
checks pass, but a real-account regression run and the remaining Chrome Web Store publisher work
are still required. See [RELEASE_READINESS.md](RELEASE_READINESS.md).

The extension uses undocumented ChatGPT web endpoints. They can change without notice, and the
current OpenAI terms restrict automatic or programmatic extraction. The publisher decided to keep
this integration for initial market validation and accept the documented distribution risk. Do
not describe it as an official or public OpenAI API. See the concrete
[code-to-policy audit](docs/openai-policy-audit.md), [competitor review](docs/competitor-implementation-review.md),
and prepared [permission request](docs/openai-permission-request.md).

## What v1 does

- Loads the complete flat history and conversations inside Projects.
- Selects conversations manually, by range, all at once, or with deterministic age presets:
  30, 90, 180, or 365 days. An untitled rule is also available.
- Protects pinned chats, Project chats, manually protected chats, and records whose protection
  metadata is unknown from rule-based and global bulk selection.
- Shows the exact titles in a review dialog before archive or permanent deletion.
- Requires explicit confirmation for every batch; deletion is never automatic.
- Archives sequentially and deletes at no more than two conversations at a time.
- Verifies each result, respects `Retry-After`, stops on account-wide rate limits, and reports
  every failure.
- Persists unfinished work locally and reconciles an uncertain write by reading its outcome
  before it can be sent again.
- Binds a reviewed batch to the ChatGPT account/workspace that created it and allows only one
  destructive queue across open ChatGPT tabs.

## Privacy and scope

There is no backend, extension account, analytics, advertising, cloud sync, or third-party data
transfer. The extension runs only on `https://chatgpt.com/*`, sends authenticated requests only
to ChatGPT, and stores protection/recovery state in `chrome.storage.local`.

Before reading history, the extension presents an in-product data disclosure and requires an
affirmative choice. Result verification downloads ChatGPT's full conversation detail response,
which can contain messages, but only checks the conversation identity and archive state. Message
content is not analyzed, retained, or sent to the developer. See [PRIVACY.md](PRIVACY.md).

## Build and verify

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:browser
npm run test:landing
npm run package
```

`npm run package` creates `chat-cleanup.zip` from a clean allowlisted `dist/`: `manifest.json`,
`content.js`, and the four icon files. It prints the archive SHA-256.

For manual testing, load `dist/` from `chrome://extensions` and follow
[docs/store/regression-checklist.md](docs/store/regression-checklist.md).

## Architecture

All ChatGPT-specific assumptions live behind the adapter in `src/chatgpt/`. The injected UI does
not contain endpoint or selector logic. Start with [docs/chatgpt-integration.md](docs/chatgpt-integration.md)
before changing discovery, actions, or verification.

The v1 scope stays narrow: no accounts, backend, payments, AI scoring, summaries, folders, prompt
library, cloud sync, multi-provider support, or mobile app.
