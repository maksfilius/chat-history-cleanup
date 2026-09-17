# Chat Cleanup mark

Two drawings, both built from primitives — rounded rectangles, triangles and a four-point
star. Nothing is traced from a raster, and nothing is upscaled.

| Source | Rasterises to | Detail |
| --- | --- | --- |
| `logo.svg` | 48px, 128px, and every in-product use | Tails, both sparkles |
| `logo-16.svg` | 16px and 32px | Drawn on the 16px pixel grid; no tails, one sparkle |

`logo.svg` is the master and the only one that ships: `public/branding/logo.svg` is a copy of
it, and the panel and landing both use that. `logo-16.svg` never ships — it exists so the
Chrome toolbar sizes are drawn for their own grid instead of shrunk from the master. 32px is
exactly twice the 16px grid, so 1x and 2x toolbars stay identical. Its bodies are 9x8 and 10x9, offset
by (+4, +5), with every fill edge on a whole pixel, so only the corner radii and the sparkle
are antialiased.

## Geometry

The approved geometry is encoded directly in the two canonical SVG drawings. Nothing is traced
from a raster. Two identical bubbles, each a 68x40 rounded rectangle (r=12) plus
a tail wedge, offset by exactly (+34, +32): charcoal behind and up-left, off-white in front and
down-right, each carrying two pill text bars. Two four-point sparkles sit in the wedge between
them. The master's ink spans x 2.5..123 and y 3..115 of the 128 canvas.

| Colour | Role |
| --- | --- |
| `#F4F3ED` warm off-white | Front bubble face, the back bubble's bars, and the keyline around both |
| `#202522` charcoal | Back bubble, the front bubble's outline, the front bubble's bars |
| `#C9F27B` lime | Both sparkles |

One icon serves every background. The front bubble's charcoal outline holds its off-white face
against white, and the off-white keyline holds the charcoal bubble against dark. On light
backgrounds the keyline is invisible. Each bubble is drawn twice, keyline first and then the
shape, so the keyline only ever lands outside the union of body and tail.

Flat fills only: no gradients, shadows, blur, filters or partial opacity, and the canvas is
transparent with no container. Strokes are used for the keyline and the front outline — they
rasterise as flat, fully opaque colour, which the export verifies pixel by pixel.

## Export

```sh
npm run build:branding
npm run package
```

The export uses local Chrome's SVG rasterizer, with remote requests blocked, to produce:

- `public/branding/logo.svg`, a byte-for-byte copy of the master.
- Transparent `public/icons/icon{16,32,48,128}.png`, each from the drawing for its size.
- `preview.png`, the review sheet: all four sizes on white, on the Chrome dark theme and on
  the dark product UI.

`npm run build:branding -- --check` verifies existing exports without rewriting them. Per size
it checks that both drawings use only the three brand colors and no gradient, filter or opacity;
that at least 60% of opaque pixels are *exactly* a brand color, the rest being edge blends
between two of them; that all three colors are present; that the corners stay clear; that the
drawing fills at least 30% of its canvas; and that the PNG matches its source SVG pixel for
pixel. Set `CHROME_BIN` if Chrome is installed outside the default macOS path.

Normal builds consume the checked-in exports; they do not require Chrome. The landing build
copies the SVG and the icon PNGs and updates its inline symbol. Chrome manifest paths are
unchanged.
