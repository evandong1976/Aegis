# Tabs

Filters one list in place — open, investigating, resolved, suppressed.

You provide `items` (`{label, value, count}`), the current `value` and `onChange`. The set is a pill
on `surface-raised`; the active tab fills `accent` with `on-accent` text. Counts are numbers and may be
omitted on a tab that is never counted.

- Tabs filter; they never navigate to a different page. Use `NavRail` for that.
- Two to five tabs. Beyond five, use a select.
- The first tab is the default working state ("Open"), not "All".
- Keep the list's sort and column set stable as the tab changes, so only the rows change.
