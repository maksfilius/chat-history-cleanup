# Chrome Web Store graphics

The 440×280 promotional tile is generated with `npm run build:store-assets` from the canonical
logo, with all network access blocked.

Store screenshots are deliberately not generated from the landing page. The three numbered PNGs
come from the production extension bundle running on `https://chatgpt.com/` in a fresh temporary
Chrome profile. The capture script intercepts only the extension's requests in its isolated world
and supplies fictional conversation metadata, so no publisher account or private history is used.

Regenerate them with `npm run capture:store-screenshots`. The command requires network access to
load the current public ChatGPT surface. It verifies the 1280×800 dimensions and fails if an email
address appears in the captured page text. Review every image before upload because the host page
can change independently of this repository.
