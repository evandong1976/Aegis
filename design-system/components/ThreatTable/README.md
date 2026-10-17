# ThreatTable

The verdict list: a dense table where a verdict, a URL or file name and raw scan values sit side by
side. It carries every queue in the product — clicked links, downloaded files, the overview's latest
verdicts.

You provide `columns` and `rows`. A column is `{key, header, mono, nowrap, align}`; `mono` sets the cell
in the `mono` style for IPs, hashes, ports and timestamps, `nowrap` keeps a cell on one line, and
`align: 'right'` is for times and counts. A row is a plain object keyed by the columns' `key`, and a
cell value may be a node — pass a `<SeverityBadge>` for the verdict column.

- Headers are the `label` style on `surface-raised`; rows hover to `surface-raised`.
- Verdict first, then the URL or file it is about, then why, who and where, then time on the right.
- Six or seven columns is the ceiling at a half-width card. Past that the non-wrapping columns push
  the table into a horizontal scroll — drop a column instead.
- Never truncate an IP, hash or asset name with an ellipsis. Mono cells hold one line already; mark a
  hostname column `nowrap` so it widens the column instead of breaking the name in half.
- Sort newest first by default, and keep sort within verdict when the user sorts by verdict.
