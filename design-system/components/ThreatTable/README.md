# ThreatTable

The detection list: a dense table where severity, asset and raw network values sit side by side.

You provide `columns` and `rows`. A column is `{key, header, mono, align}`; `mono` sets the cell in the
`mono` style for IPs, hashes, ports and timestamps, and `align: 'right'` is for times and counts. A row
is a plain object keyed by the columns' `key`, and a cell value may be a node — pass a
`<SeverityBadge>` for the severity column.

- Headers are the `label` style on `surface-raised`; rows hover to `surface-raised`.
- Severity first, then what happened, then where, then the raw value, then time on the right.
- Never truncate an IP, hash or asset name with an ellipsis: wrap the cell or widen the column.
- Sort newest first by default, and keep sort within severity when the user sorts by severity.
