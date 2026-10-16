# Button

The only clickable control that commits an action; everything else is a link or a `Tabs` item.

Use `primary` for the one action that moves the investigation forward on a view — never two in the
same card. `secondary` carries the alternatives beside it. `ghost` is for toolbar and card-header
actions where a filled button would compete with the data. `danger` is for actions that cut a host
off, delete evidence or revoke access: it starts as an outline in `danger` on `danger-bg` and only
fills on hover, so it never reads as the default.

You provide the label and the handler. Keep labels to a verb and a noun ("Run scan", "Isolate host");
never "OK", never a lone "Submit". Pass `icon` for the leading glyph and `iconEnd` only for direction
(`arrow`). Sizes: `sm` in table rows and card headers, `md` everywhere, `lg` only in empty states and
onboarding.

- Fill is `accent` with `on-accent` text — dark ink on cyan, never white.
- `glow-sm` sits under the primary fill; in the light theme that token is a hairline shadow instead.
- Focus shows `focus-ring` at 2px with a 2px offset. Do not remove it.
- A destructive action always confirms in a dialog; the button alone never deletes.
