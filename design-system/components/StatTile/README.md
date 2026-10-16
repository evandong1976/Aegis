# StatTile

One number with its movement, for the row of tiles at the top of a dashboard.

You provide `label`, `value`, optional `unit`, `icon`, `caption` and `points` (an array of numbers for
the sparkline). Movement needs two props: `direction` (`up` or `down`) says which way the number went,
and `intent` (`good` or `bad`) says which direction is good for this metric. The tile colors the delta
from the two together — blocked threats rising is `success`, unmonitored assets rising is `danger` —
so never hard-code a color for a delta.

- `metric-xl` for the value, `label` for the caption above it. Four tiles per row at desktop width.
- `points` draws a 104×32 sparkline in `accent` over `accent-soft`. Six to twelve points; it is a
  shape, not a chart, so it carries no axis and no tooltip.
- A metric with no meaningful movement omits `delta` rather than showing "0%".
