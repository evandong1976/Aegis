# ScoreRing

A 0–100 posture score as a ring, for the one headline number a security view is organised around.

You provide `value`, a short `label`, and optionally `size` (default 168) and `strokeWidth`. The track
is `surface-overlay`, the bar is `accent` with `glow-sm` behind it, and the number is `metric-xl` in
`ink`. The component writes its own accessible name ("Posture: 86 of 100"), so do not wrap it in
another label.

- Never color the ring by band (red under 50, green over 80). The number and its label carry the
  meaning; a colored ring would duplicate severity encoding that belongs to `SeverityBadge`.
- One ring per view. Smaller rings (132, 104) are for the breakdown beside it.
- Round to a whole number before passing it. The ring clamps to 0–100.
