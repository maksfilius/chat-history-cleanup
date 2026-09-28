# Public site

Deployed by `.github/workflows/pages.yml` on every push to `main` that touches `pages/`,
`landing/`, `src/` or `public/`.

| Path        | Source                                                        |
| ----------- | ------------------------------------------------------------- |
| `/`         | `pages/index.html` — the marketing landing page                |
| `/privacy/` | `pages/privacy/index.html` — the Chrome Web Store privacy URL  |
| `/demo/`    | built from `landing/` by `npm run build:landing`               |

The landing page is a single self-contained file with inlined CSS and a short script at the end
for the scroll reveals. Open `pages/index.html` directly in a browser to preview it.

Both scroll effects are pure CSS `position: sticky`, and both need an unclipped ancestor chain —
do not put `overflow` back on `body`:

- **Hero** — `.hero-grid` pins, so the capture slides up over the headline and releases when
  `.hero .wrap` ends.
- **Steps** — `.step-text` pins inside its grid area (≥ 880px only), so the copy travels from the
  top of the panel to its bottom while the panel scrolls normally.

Both are wrapped in `prefers-reduced-motion: no-preference`.

## Store link

The header, hero, final CTA and structured data point to the published Chrome Web Store listing:
`https://chromewebstore.google.com/detail/chat-cleanup-%E2%80%94-bulk-archi/ldaeofnbfjlljghcfflkalndgfkdeahi`.

## Custom domain

Three absolute URLs are marked in `index.html` (`canonical`, `og:url`, `og:image`); update them,
the `url` in the JSON-LD block, `robots.txt` and `sitemap.xml`, then add a `CNAME` file here.

## Screenshots

`assets/shot-*.png` are full 1280×800 captures of the production bundle on the real chatgpt.com
surface, taken with fictional metadata in a disposable Chrome profile. Regenerate them with:

```bash
npm run build:extension
CAPTURE_OUT=pages/assets CAPTURE_NO_CAPTION=1 node scripts/capture-store-screenshots.mjs
# then rename 01/02/03-*.png to shot-select.png / shot-review.png / shot-done.png
```

`CAPTURE_NO_CAPTION` drops the marketing caption card the Chrome Web Store assets carry; without
it the same script still writes the store versions to `docs/store/assets`.

The step close-ups are not separate files — `.panel` in `index.html` is a CSS window onto the same
capture, positioned with `background-size` / `background-position`. If the panel moves on screen,
adjust those two percentages rather than cropping new images.
