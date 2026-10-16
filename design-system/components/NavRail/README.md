# NavRail

Primary navigation down the left of the app: `surface`, `radius-xl`, 236px wide.

You provide `brand` and `items` — each `{label, icon, href, active, count}`. The active item fills with
`accent-soft` and colors its text and icon `accent`; its count chip inverts to `accent` on `on-accent`.
Counts are strings so you can abbreviate ("1.2k"); they are open items needing attention, not totals.

- Keep to eight items. More means the product needs a section break, not a longer rail.
- Order by investigation flow: Overview, Threats, Assets, Identity, Vulnerabilities, Network, then
  Reports and Settings at the bottom.
- The rail sets `aria-current="page"` on the active item. Give it an `aria-label` if a second nav
  exists on the page.
