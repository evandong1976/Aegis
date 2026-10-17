# NavRail

Primary navigation down the left of the app: `surface`, `radius-xl`, 236px wide.

You provide `brand` and `items` — each `{label, icon, href, active, count}`. The active item fills with
`accent-soft` and colors its text and icon `accent`; its count chip inverts to `accent` on `on-accent`.
Counts are strings so you can abbreviate ("1.2k"); they are open items needing attention, not totals.

- Keep to eight items. More means the product needs a section break, not a longer rail.
- The product's nav is Overview, Links, Downloads, then Settings at the bottom. Counts are the items
  waiting on a person — links held at the click, files in quarantine — never totals scanned.
- The rail sets `aria-current="page"` on the active item. Give it an `aria-label` if a second nav
  exists on the page.
