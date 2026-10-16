# Icon

The system's icon set, drawn inline so icons inherit color from the text around them.

You provide `name` (one of `Aegis.iconNames`), `size` (default 20) and `strokeWidth` (default 1.75,
raised to 2 inside badges and small chips). Icons render at 24×24 on a 2px grid with round caps and
joins, and are always `aria-hidden` — the text beside them carries the meaning.

The paths are the Lucide set (ISC licence), kept at `assets/Icons/` as source SVGs too. When a screen
needs a glyph that is not here, take it from Lucide rather than drawing one, add it to `PATHS` in
`components/bundle.js`, and copy the SVG into `assets/Icons/`.

- 20px beside body text, 16–18px in dense rows, 13px inside badges, 26px in an empty state.
- Never place an icon alone as a control without an `aria-label` on the button around it.
- Do not recolor an icon away from its text; the one exception is `StatTile`, whose icon is `accent`.
