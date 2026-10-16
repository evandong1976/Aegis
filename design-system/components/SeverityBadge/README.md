# SeverityBadge

States a finding's severity as a word, an icon and a color together — never color alone.

The five levels are fixed: `critical`, `high`, `medium`, `low`, `secure`. They map to `danger`,
`warning`, `info`, a neutral `surface-overlay`, and `success`. `secure` is a teal rather than a green
so it separates from `critical` by lightness as well as hue, which keeps the pair readable for
red–green color blindness. Do not invent a sixth level or re-point one at another token.

Pass `level` and nothing else to get the standard label. Children replace the label when the badge is
carrying an identifier instead (`<SeverityBadge level="critical">CVE-2026-4417</SeverityBadge>`); the
icon stays, so severity is still legible. `subtle` drops the border for dense table cells where the
outline would add noise — only inside a row, never on its own.

- Every badge keeps its icon. A badge stripped to color alone fails the system's color rules.
- Sort by severity, not alphabetically, wherever badges appear in a list.
