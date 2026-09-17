# Competitor implementation review

Review date: 2026-09-16. This review uses public Chrome Web Store listings, public repositories,
and developer statements. It cannot prove whether a publisher has a private agreement with OpenAI.
Absence of a public permission statement is recorded only as absence of public evidence.

## Finding

The reviewed products use one of two implementation families:

1. **DOM automation:** add checkboxes to rendered ChatGPT rows, open each native row menu, click
   Archive/Delete, and for deletion click ChatGPT's confirmation button.
2. **Private web endpoints:** read `/api/auth/session`, page `/backend-api/conversations`, and PATCH
   `/backend-api/conversation/{id}` with `is_archived` or `is_visible`.

No reviewed listing or repository published evidence of written OpenAI permission. Several call an
undocumented interface the “native” or “official” API, but public source and developer statements
show that this wording does not necessarily mean OpenAI's documented public API.

## Examples

| Product | Public evidence | Implementation | Permission evidence |
|---|---|---|---|
| [ChatGPT Bulk Delete by qcrao](https://chromewebstore.google.com/detail/chatgpt-bulk-delete/effkgioceefcfaegehhfafjneeiabdjg) | Featured Chrome Web Store item, about 60,000 users at review time; [source is public](https://github.com/qcrao/bulk-delete-chatGPT) | Current source scans visible conversation links, adds checkboxes, dispatches pointer/click events to ChatGPT's row menu and confirmation control, and treats row disappearance as success. It does not use the private history endpoint for the operation. Its manifest also requests identity/email and talks to the publisher's payment worker | No public OpenAI permission or affiliation claim found |
| [ChatGPT bulk delete & export](https://github.com/Junyi-99/chatgpt-bulk-delete-export) | Public repository | README explicitly says it pages `/backend-api/conversations`, refreshes the web access token, and runs private archive/delete requests with concurrency five. It labels the interface “ChatGPT's private API” | No public permission statement found |
| [Bulk Delete ChatGPT History & Chat Cleaner](https://chromewebstore.google.com/detail/bulk-delete-chatgpt-histo/ebchdiehpgnonjcndecjkficmoaddnfe) | Chrome Web Store item and [public source](https://github.com/fineanmol/chatgpt-bulk-delete-manager) | Reads `/api/auth/session`, fetches history pages through `/backend-api/conversations` five at a time, fetches full conversation details for preview/export, and PATCHes private conversation routes | No public permission statement found |
| [ChatGPT Bulk Delete by hanm](https://chromewebstore.google.com/detail/chatgpt-bulk-delete/dpgbnmhjiggonokhcmnfjegegglnhfek) | Chrome Web Store item | Listing says it uses the active session and a “native ChatGPT API.” Source was not identified, so the exact calls cannot be independently verified | No public permission or OpenAI affiliation statement found |
| DeclutterGPT | Store-linked developer discussion | The developer initially described an “official API,” then [said publicly](https://www.reddit.com/r/OpenAI/comments/1jv9egz/i_got_tired_of_deleting_chatgpt_chats_one_by/) that there was no documentation and that they inspected and reproduced ChatGPT's own requests | This statement is evidence of an independently discovered integration; it does not prove whether later permission was obtained |

## Comparison with this repository

The current Chat Cleanup adapter is in the second family. Its policy exposure is therefore common
among private-endpoint competitors, rather than unique. It is more conservative operationally than
the reviewed public examples in several material ways:

- exact immutable review before action;
- pinned, Project, manual, and unknown-metadata protection;
- account/workspace binding;
- low concurrency and account-wide halt on rate limits;
- durable dispatched state and reconciliation before replay;
- result identity validation and explicit failure reporting;
- no analytics, payment service, advertising, or developer backend.

It also performs a full-detail verification GET after an action. That produces stronger destructive
operation safety but accesses more data than a simple DOM-only extension. The full-detail behavior
is disclosed to users and no message body is retained or sent to the developer.

## What Store presence does and does not show

A Chrome Web Store listing shows that Google accepted a submitted package under Google's review
process at that time. It does not publish or establish a license from OpenAI to use ChatGPT. A
Featured badge and a large install count are useful evidence that a DOM-based product can work and
that Google accepts the product category; they are not evidence that private ChatGPT endpoints are
authorized.

The practical market pattern appears to be that many independent publishers ship first and accept
the risk of endpoint breakage, account restrictions, Store removal, or an OpenAI objection. That
can explain the number of competing extensions without assuming that every publisher obtained
permission.

## Practical consequence

There are now two defensible product decisions:

- **Preserve the full product:** keep the hardened private adapter, make no claim that it is an
  official/public API, disclose the integration accurately, and treat publication as an explicit
  business risk unless OpenAI grants permission.
- **Match the lower-risk, proven Store pattern:** ship a DOM-only first version for visible rows and
  native menus. This removes session-token/private-endpoint behavior, but loses complete inventory,
  reliable age rules, Project completeness, durable server-state verification, and the current MVP
  promise. It also does not create a guaranteed exception to OpenAI's broad programmatic-extraction
  language.

Competitor behavior is useful market and enforcement evidence, but it does not change the text of
OpenAI's terms.
