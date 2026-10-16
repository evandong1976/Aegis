# Card

The panel every dashboard view is assembled from: `surface` on `ground`, `radius-lg`, one hairline
`border`, `elev-card` with `inset-edge` for the lit top edge.

You provide `title`, optional `eyebrow` (set in the `label` style, uppercase) and `description`, an
`action` node for the top-right corner, and the body as children. The header only renders when there
is a title or an action.

`highlight` swaps the resting shadow for `glow-md` and the border for `accent`. Use it for the single
item on a view that needs attention now — an active intrusion, a failing control. Two glowing cards on
one screen means neither reads as urgent.

- Body padding is `space-6`; cards in a grid sit on a `space-5` gap.
- Put a `SeverityBadge` in `action` when the card is about one finding.
- Do not nest a Card inside a Card. Use a bordered `surface-raised` block instead.
