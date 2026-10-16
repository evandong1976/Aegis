# Meter

A horizontal bar for coverage and compliance percentages — the things that should be at 100 and are not.

You provide `label`, `value` (0–100), an optional `display` string for the right-hand readout (so you
can show "12 hosts" while the bar shows 12%), and `tone` (`success`, `warning`, `danger`) when the
number itself carries a verdict. With no tone the bar is `accent`.

- The readout is in the `mono` style so a column of meters aligns.
- The track is 8px on `surface-overlay`; the bar never gets a gradient.
- The bar carries `role="img"` with the value in its label, so it is not read as an interactive slider.
- Use `Meter` for a share of a whole. For a count over time, use `StatTile` with `points`.
