# LogStream

Raw scan events in the mono scale, for the overview's scan log and the detail panel under a verdict.

You provide `lines` — each `{time, level, text}`. Levels are `block`, `warn` and `allow`, colored
`danger`, `warning` and `success`; the level word is printed, so the color is reinforcement, not the
only signal. The stream sits on `ground` inside a card, which is the one place `ground` appears above
`surface`.

- Keep the raw text raw: URLs, file names, engine and rule names, and key=value pairs exactly as logged.
- Times are `HH:MM:SS` in the viewer's zone, with the date in the panel header, not on every line.
- Cap at around 200 lines and link out to the full log; this is a preview, not a log viewer.
- Never truncate a line mid-token. Wrap it.
