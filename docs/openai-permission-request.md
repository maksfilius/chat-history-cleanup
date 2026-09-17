# Draft permission request to OpenAI

Send this from the publisher's real identity. Replace the bracketed fields, attach no conversation
content or access credentials, and keep OpenAI's reply with the release records.

Suggested recipients:

- `legal@openai.com` for the service-access and terms question.
- `partnercomms@openai.com` for the product-name and trademark question.

OpenAI lists these contacts in its [Design Guidelines](https://openai.com/brand/). The same message
can also be submitted through the OpenAI Help Center so there is a support ticket.

## Subject

Permission request: local Chrome extension for selective ChatGPT history cleanup

## Message

Hello OpenAI team,

I am preparing an independent Chrome extension called **Chat Cleanup**. It lets a signed-in user
review conversations in their own ChatGPT history and explicitly select multiple conversations to
archive or delete. It is not affiliated with OpenAI and never deletes automatically.

Before publishing it, I am requesting written confirmation that the integration described below
is permitted under the applicable OpenAI terms and branding rules.

The extension currently runs as a Manifest V3 content script only on `https://chatgpt.com/*`. It:

- reads `/api/auth/session` and keeps the returned access token and active account ID in memory;
- uses that same-origin session to list the user's conversations and Projects through the
  ChatGPT web application's `/backend-api/*` routes;
- sends archive or delete changes only after the user reviews the exact titles and confirms the
  exact batch;
- uses at most one archive request or two delete requests concurrently, honors `Retry-After`, and
  stops the entire batch on a persistent HTTP 429;
- reads the selected conversation's detail response after an action solely to confirm its ID and
  archive/deletion state. That response may contain messages, but the extension does not inspect
  message text for product logic, persist it, or send it to me or any third party;
- has no backend, analytics, advertising, accounts, cloud sync, or external network destination;
- stores only consent state, protected conversation IDs, and unfinished batch recovery state in
  `chrome.storage.local`.

Could you please confirm whether OpenAI permits a public Chrome Web Store extension to use these
specific ChatGPT web-session routes for this user-initiated purpose? If permission requires a
different endpoint, OAuth flow, lower concurrency, removal of detail verification, partnership,
or other conditions, please identify the supported approach.

The Store title is **“Chat Cleanup — Bulk Archive & Delete”**, with my own logo. ChatGPT is named
only where needed to describe compatibility and the extension includes the prominent statement:
“Chat Cleanup is an independent extension and is not affiliated with or endorsed by OpenAI.”
Please confirm whether these descriptive compatibility references are acceptable.

Repository or review-build URL: [URL]
Privacy policy URL: [URL]
Publisher legal name: [NAME]
Publisher contact: [EMAIL]

Thank you,

[NAME]

## A sufficient reply should cover

- Programmatic reading of the user's ChatGPT web history.
- Use of `/api/auth/session` and the private `/backend-api/*` routes.
- User-confirmed archive/delete writes.
- Full-detail result verification.
- Descriptive ChatGPT compatibility references in the Store listing and product documentation.

A generic reply about the public OpenAI API, user ownership of content, or brand styling does not
answer the private ChatGPT integration question.
