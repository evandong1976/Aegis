# Icons

Source SVGs for the Aegis icon set, taken unmodified from [Lucide](https://lucide.dev)
v1.58.0 (`lucide-static`, ISC licence). Each file is 24×24 on a 2px grid with
`stroke="currentColor"`, round caps and round joins.

**Use the `Icon` component, not these files, inside the product.** `Icon` draws the same paths inline,
so a glyph takes its color from the text beside it. These files render here as flat images with no
inherited color: on this page they draw in `ink`, and anywhere you place one as an `<img>` you must
set its ink yourself — `ink` on `surface`, `accent` for an interactive glyph, or the matching status
token inside a badge or an alert.

They are kept for three jobs: exporting a glyph into a report or slide, handing one to a design tool,
and checking a path against the source when `PATHS` in `components/bundle.js` is edited. Keep the two
in step — a glyph added to the component is copied here, and nothing is redrawn by hand.

The set covers the product's nouns: protection (`shield`, `shield-check`, `shield-alert`, `lock`,
`key-round`), the estate (`database`, `globe`, `users`, `layout-dashboard`), findings (`bug`,
`scan-line`, `radar`, `file-search`, `activity`), and interface mechanics (`search`, `settings`,
`bell`, `check`, `x`, `info`, `circle-check`, `wifi-off`, `trending-up`, `trending-down`,
`arrow-right`).
