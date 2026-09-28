# Release readiness — 2026-09-28

## Decision

**Code status: released. Public-release status: version 0.1.0 is live in the Chrome Web Store.**

The code-level blockers from the 2026-09-05 audit were addressed, the synthetic release suite
passed, and Google approved the first public submission. The published listing is
[Chat Cleanup — Bulk Archive & Delete](https://chromewebstore.google.com/detail/chat-cleanup-%E2%80%94-bulk-archi/ldaeofnbfjlljghcfflkalndgfkdeahi).

The publisher decided on 2026-09-16 to keep the hardened private-endpoint adapter for initial
market validation and accept the documented OpenAI-terms risk. This is a business risk decision,
not a finding that the integration is authorized. The listing must not describe the interface as
an official or public OpenAI API. A permission request remains prepared and recommended.

## What was hardened

- Trusted user input and a closed Shadow DOM gate selection and confirmation.
- The confirmation is modal within the panel and lists the immutable exact batch.
- Conversation and Project identifiers, list schemas, paging totals/cursors, membership, and write
  responses are validated. Unknown metadata fails safe.
- Requests have a 20-second timeout, reject redirects, honor `Retry-After`, and remain on the
  ChatGPT origin.
- A durable `dispatched` state is saved before each write. Recovery reads an uncertain outcome
  before permitting another write.
- Web Locks plus a storage lease permit one destructive queue across tabs. Queue snapshots and
  manual protection changes are serialized.
- Batches are bound to the ChatGPT account/workspace ID and stop after account/session changes.
- Safety-critical storage reads distinguish an empty value from unavailable or malformed storage.
- First-run data handling now requires affirmative in-product consent. Every batch repeats the
  full-detail verification disclosure.
- Deterministic 30/90/180/365-day and untitled rules are in the product UI. Protected records are
  excluded by default.
- `dist/` is cleaned and allowlisted. The ZIP contains six files and is rebuilt from scratch.
- `esbuild` was upgraded from the vulnerable 0.24 line; `npm audit` reports zero vulnerabilities.

## Automated evidence

- `npm run typecheck`: pass.
- `npm test`: 96/96 pass.
- `npm run build`: extension and existing landing demo pass.
- Chrome 153 synthetic safety flow: pass, including trusted consent/confirmation, exact targets,
  two deletion slots, Stop, close/reopen ownership, Resume without duplicate targets, failures,
  archive, and reduced motion.
- Chrome 153 accepts `dist/` as an unpacked Manifest V3 extension.
- Existing desktop/mobile landing parity flow: pass with network blocked.
- Store asset export: pass with network blocked; the 440×280 promotional tile was generated and
  visually reviewed. Three 1280×800 screenshots were captured from the production bundle on the
  public ChatGPT surface with a fresh profile and fictional staged metadata, then visually
  reviewed. Landing-demo screenshots were removed because they did not represent the current
  ChatGPT surface.
- `npm audit --omit=optional`: zero vulnerabilities.
- `git diff --check`: pass.
- Store archive: `chat-cleanup.zip`, 28,727 bytes, six allowlisted files, reproducible SHA-256
  `7e07c9e3044bfe27c02435653f5501b0878d14f4929ff3814170731b8032e07e`.

These tests use synthetic conversations. They do not prove that today's private ChatGPT endpoints
still behave the same on a real account.

## Publication record and follow-up

1. **Real-account regression.** Keep running every applicable item in
   [docs/store/regression-checklist.md](docs/store/regression-checklist.md) on disposable chats,
   including multi-page history, Projects, pinned chats, two tabs, account switch, Stop/Resume,
   one archive, and one permanent delete.
2. **Privacy publication: complete.** [PRIVACY.md](PRIVACY.md) is published at a stable
   [HTTPS URL](https://maksfilius.github.io/chat-history-cleanup/privacy/), with
   `chatcleanup.support@gmail.com` and the public issue tracker as support channels. Chrome requires
   disclosure even when data stays local; dashboard answers must continue to match the product and
   policy. See Chrome's
   [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).
3. **Publisher account: complete.** The account is registered and the contact email is verified.
4. **Dashboard submission: complete.** Google approved version `0.1.0`, and it was publicly
   released on 2026-09-28 under extension ID `ldaeofnbfjlljghcfflkalndgfkdeahi`.

## Accepted distribution risk

The implementation reads ChatGPT history through undocumented web endpoints. OpenAI's current
terms restrict automatic or programmatic extraction. Competitor research shows both DOM-driven and
private-endpoint extensions in the Chrome Web Store, but Store acceptance is not OpenAI permission.
See [docs/openai-policy-audit.md](docs/openai-policy-audit.md) and
[docs/competitor-implementation-review.md](docs/competitor-implementation-review.md). A ready-to-send
permission request remains in [docs/openai-permission-request.md](docs/openai-permission-request.md).

## Known operational limits

- All ChatGPT endpoints and response shapes are undocumented and can break without notice.
- Project discovery follows the private endpoint's cursor until completion, with cycle and page
  guards because the endpoint is undocumented.
- Result verification downloads a full detail response because no reliable metadata-only endpoint
  has been identified. The user is informed before consent and before each batch.
- Only Chrome has been tested. The manifest declares Chrome 120 as the minimum because the queue
  relies on Web Locks.
- Page-level clickjacking cannot be completely eliminated by a content-script UI. Synthetic events
  are rejected and the Shadow DOM is closed; a future extension-owned popup would provide a
  stronger security boundary.
