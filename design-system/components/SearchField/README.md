# SearchField

Global search for the app header: find an asset, an IP, a CVE or a user from anywhere.

You provide the native input props and optionally `shortcut` (rendered as a `kbd` chip at the right
edge — use `⌘K` on macOS, `Ctrl K` elsewhere, and actually bind it). The placeholder names what is
searchable rather than saying "Search": the default is "Search assets, IPs, CVEs".

- Pill radius, `space-10` of left padding for the glyph, room at the right for the shortcut chip.
- Results open in an overlay on `surface-overlay`, grouped by kind, severity badges intact.
- Debounce queries at 150ms; never search per keystroke against the detection index.
