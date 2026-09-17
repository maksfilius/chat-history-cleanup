# OpenAI policy compatibility audit

Audit date: 2026-09-16. This is a product and engineering risk assessment for the current
release candidate, not a legal opinion. It records the published terms reviewed on this date and
the exact implementation behavior that matters for a public Chrome Web Store release.

## Decision

**Do not submit the current private-endpoint build publicly without written permission from
OpenAI or qualified legal advice accepting the risk.**

Publisher decision recorded 2026-09-16: keep the hardened private-endpoint build for initial market
validation and consciously accept this distribution risk. That product decision does not change
the policy analysis below. The Store copy must not call the interface official or public.

The safety, privacy, and rate-limit work in the extension materially protects users, but it does
not create an exception to OpenAI's restrictions on reverse engineering and programmatic data
extraction. There is no documented public API for managing a user's ChatGPT sidebar history.

## Published rules reviewed

- OpenAI's current [EU Terms of Use](https://openai.com/policies/eu-terms-of-use/) apply to
  individuals in the EEA, Switzerland, and the UK. They prohibit attempting to discover
  underlying service components, automatically or programmatically extracting data or Output,
  and circumventing rate limits, restrictions, or protective measures.
- The [Terms of Use for other regions](https://openai.com/policies/row-terms-of-use/) contain the
  same relevant restrictions.
- Business, Enterprise, and developer customers are covered by the
  [OpenAI Services Agreement](https://openai.com/policies/services-agreement/). Section 3.3
  prohibits reverse engineering, extracting data other than as permitted through the Services,
  and circumventing rate limits or protective measures.
- OpenAI's [Design Guidelines](https://openai.com/brand/) identify ChatGPT and GPT as OpenAI
  trademarks, prohibit implying endorsement, and prohibit OpenAI model names and the GPT brand in
  app or product names. The guidelines do not expressly say that every factual `for ChatGPT`
  compatibility reference is forbidden, but OpenAI can review and withdraw permission to use its
  marks.
- OpenAI documents user-driven [archive and delete controls](https://help.openai.com/en/articles/8809935)
  in ChatGPT, including Archive all and Delete all. It does not document selective bulk history
  actions for third-party clients.

Owning one's Input and Output does not separately authorize a way of accessing the Service that
the applicable terms restrict. User installation and confirmation also do not appear as stated
exceptions to the restrictions above.

## Code-to-policy mapping

| Extension behavior | Current implementation | Assessment | What can change |
|---|---|---|---|
| Obtain the active web session | `sessionContext()` reads `accessToken` and account ID from `/api/auth/session`, then constructs a bearer-authenticated client | **High risk.** This is an undocumented integration boundary and is necessary only because the public web API is not exposed for third-party use | A DOM-only build can remove token access. Written permission can explicitly cover the current method |
| Read the complete sidebar history | `listAll()`, `listPage()`, `listProjects()`, and `listProjectConversations()` page through undocumented `/backend-api/*` routes | **High risk.** This is automatic extraction of titles, dates, identifiers, protection flags, and Project membership | DOM-only can read only rendered rows and loses complete history, reliable dates, and Project coverage. An official export can provide an offline inventory but cannot perform live actions |
| Discover Project routes and response shapes | `api.ts` and `docs/chatgpt-integration.md` encode observed `gizmos/snorlax` routes, cursors, headers, and internal fields | **High risk.** The recorded network-observation process and reliance on internal components can be characterized as discovering underlying service components | Remove this integration in a DOM/manual edition, or obtain express approval for it |
| Archive or delete selected chats | `patch()` sends `is_archived:true` or `is_visible:false` to an undocumented conversation route | **High risk.** The actions are user initiated and mirror native actions, but the private write interface is neither documented nor permitted for third-party clients | DOM automation can invoke native menus, with substantial fragility and reduced safety. Written permission is the only path that preserves the current reliable ID-based batch behavior |
| Verify every result | `verify()` downloads the full conversation detail response and checks identity/archive state | **Highest data-access exposure.** The response can include complete messages even though the extension neither analyzes nor retains them | Removing verification reduces content access but breaks the strongest protection against ambiguous destructive writes. The listing is known to lag. A metadata-only verification endpoint would help, but none is documented |
| Retry and rate-limit handling | The queue uses low concurrency, honors `Retry-After`, halts after 429, persists progress, and never bypasses a restriction | **Mitigated, not eliminated.** The code does not circumvent a rate limit. Live research still triggered ChatGPT's protective history restriction, so the traffic itself can disrupt the user's access | Keep current behavior; lower request volume if architecture changes. Do not market this as proof that the integration is authorized |
| Local data handling | No backend, analytics, ads, or third-party transfer; consent and per-batch disclosure are implemented | **Good privacy posture.** It addresses user transparency and Chrome Web Store disclosure, but does not resolve OpenAI's access restrictions | Keep this architecture in every variant |
| Product name and presentation | Own logo, `Chat Cleanup: Bulk Delete for ChatGPT`, and an explicit independent/not-endorsed statement | **Moderate trademark review risk.** The own-brand hierarchy and disclaimer are helpful. The wording is not an OpenAI model name, but it still uses the ChatGPT mark in the title | Ask OpenAI to approve the title in the same permission request. Conservative fallback: use `Chat Cleanup` as the product name and mention ChatGPT compatibility in descriptive text |

## Why the public OpenAI API is not a replacement

The documented [Conversations API](https://developers.openai.com/api/reference/typescript/resources/conversations/methods/delete)
manages conversation objects created for API workflows. Its example identifiers are `conv_*`, and
deleting one does not delete its items. The extension targets ChatGPT web-history UUIDs and needs
archive/delete semantics for the ChatGPT sidebar. These are different resources.

No documented API, Apps SDK capability, or OAuth scope for listing, archiving, or selectively
deleting a user's chatgpt.com history was identified on 2026-09-16. A future official capability
should replace the private adapter if OpenAI publishes one.

## Viable release paths

### 1. Request written permission for the current architecture — recommended

Send the prepared request in `docs/openai-permission-request.md`. Ask OpenAI to confirm all of the
following in writing:

1. A user-installed Chrome extension may read the user's own history through the named same-origin
   routes and in-memory web-session token.
2. It may send user-confirmed archive/delete actions with the documented low concurrency and
   rate-limit behavior.
3. It may retrieve a selected conversation detail solely to verify the result, without storing or
   transmitting message content to the developer.
4. The proposed product title and compatibility wording are acceptable.

An answer covering only branding is not permission for the integration. An answer covering use of
the public API is also insufficient because this build does not use that API.

### 2. Build a DOM-only edition — reduced risk, reduced product

This can remove `/api/auth/session`, bearer-token handling, and all `/backend-api/*` calls. The
extension would inspect rendered sidebar rows and use ChatGPT's visible menus. It cannot currently
meet the MVP promise reliably:

- virtualized history means only mounted rows are available;
- reliable update dates and complete Project membership are unavailable;
- archive/delete menu ownership and delete confirmation must be re-researched;
- result verification and reload recovery become weaker;
- ChatGPT DOM changes can break selectors without notice.

DOM automation still programmatically reads and operates the Service, so it reduces the clearest
private-interface and token risks but does not guarantee compliance with the extraction rule.

### 3. Use an official data export for offline review — lower integration risk

The user can request the official ChatGPT data export, import `conversations.json` locally, and get
an offline cleanup checklist. Archive/delete would remain manual in ChatGPT. This avoids session
token access and private listing endpoints, but it handles much more message content, introduces an
export delay, and loses the main bulk-action value proposition. OpenAI's current
[export instructions](https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data)
say that consumer exports can take up to seven days and are not available for ChatGPT Business or
Enterprise accounts. Edu export availability depends on workspace settings.

#### Strict no-service-access architecture

This is the only code redesign identified in this audit that avoids both private ChatGPT endpoints
and programmatic reading of the live ChatGPT page:

1. Remove the `chatgpt.com` content script and host match from the manifest.
2. Open an extension-owned page where the user selects an official export ZIP or
   `conversations.json` file.
3. Parse it entirely in the browser, derive age/untitled candidates, and store no message bodies.
4. Show a review checklist and links for the user to open the corresponding chats.
5. Require the user to perform archive/delete through ChatGPT's documented native controls; do not
   click those controls, send authenticated requests, or inspect the resulting page.
6. Keep no network permissions, backend, analytics, session token, or ChatGPT account identifier.

This design preserves local analysis, deterministic filters, review, and protection lists. It does
not preserve automatic bulk actions, reliable result verification, instant inventory, or support
for every account type. It should therefore be treated as a different product promise rather than
an implementation swap.

### 4. Ship a manual selection assistant — smallest useful scope

The extension can highlight currently visible candidates and guide the user through ChatGPT's
native actions one chat at a time. It avoids private writes and ambiguous batch recovery. It cannot
promise hundreds of chats in minutes and may still perform programmatic DOM reading.

Private, unlisted, or beta Store visibility does not change the OpenAI terms that apply to use of
the Service. It can reduce distribution exposure, but it is not a policy resolution.

## Can the current product promise be retained while avoiding every identified restriction?

Not with a documented OpenAI interface available on the audit date. Selective automatic bulk
actions require either programmatic access to ChatGPT state or an official management API. DOM
automation removes the private token and endpoint details, but still programmatically reads and
operates the live Service and is technically less safe. Written OpenAI permission is the only
identified path that retains the current product behavior without relying on an unstated exception.

## Code changes that do not solve the central issue

- Lowering concurrency from two to one improves operational impact but does not authorize private
  endpoints or programmatic extraction.
- Removing the detail verification request reduces content exposure but leaves the full-history
  extraction and private writes, while making destructive recovery less reliable.
- Adding more user consent improves transparency but cannot waive OpenAI's contract terms.
- Changing the title removes a trademark question but not the integration question.

## Recommended sequence

1. Send the exact technical permission request and retain the response.
2. Do not submit the current ZIP publicly while the answer is absent or ambiguous.
3. In parallel, prototype only the two hardest DOM-only facts: complete-history discovery and a
   safely attributable native delete confirmation. Stop that path if either cannot be made safe.
4. If OpenAI grants permission, run the real-account regression checklist and proceed with the
   current release candidate under any conditions OpenAI specifies.
5. If OpenAI declines, use the DOM/manual or export-assisted product shape; do not merely rename
   the private endpoints.
