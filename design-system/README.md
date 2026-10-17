Aegis is the design system for a link and download scanner: it checks every URL someone clicks and
every file they download, returns a verdict, and holds or blocks what looks dangerous. The interface
is four screens — Overview, Links, Downloads, Settings — read by people watching a queue of verdicts
on a dark screen for hours, so the system spends its brightness carefully: one luminous cyan against
deep navy, and nothing else that glows.

The palette comes from a single reference image: deep navy grounds, electric blue circuitry, and one
cyan highlight where a hand touches the interface. `Night ops` (dark) is the primary theme and the one
to design in; `Daylight` (light) exists for printed reports, shared screens and bright rooms, and
every token carries a value for both.

## Content fundamentals

Write like an analyst briefing another analyst at 2am: specific, calm, and never dramatic about a
problem that is not one.

- **State what is true, then what to do.** "Active intrusion on auth-gateway-01" before "Isolate host".
  Never lead with the product's activity ("We detected…"): lead with the finding.
- **Always name the specifics.** URL, file, user, rule, time, count. "Fourteen mails since 13:40 carry
  links to login-northwlnd-io.sbs, registered two days ago" is the message; "Suspicious activity
  detected" is not.
- **A verdict is one of four words** — Malicious, Suspicious, Unknown, Clean — and they map onto the
  severity levels `critical`, `high`, `medium` and `secure`. Never invent a fifth, and never show a
  verdict as a colour alone.
- **Second person for actions the user takes, no first person for the system.** "Rotate this key", not
  "We recommend that we rotate". The product does not say "I".
- **Sentence case everywhere** except the `label` style, which is uppercase by rule, and acronyms,
  which keep their case: CVE, MFA, TLS, SOC, IP, CIDR.
- **No alarm language.** No "URGENT", no exclamation marks, no red where a severity badge already says
  critical. Severity is a field, not a tone of voice.
- **Empty is good news, and says why.** "Nothing held — every link and file in this window came back
  clean. Verdicts usually land in about a second."
- **Numbers keep their units and their basis.** "14 min mean time to respond, vs. last week", not "14".
- **No emoji.** Status is carried by `SeverityBadge` and the icon set.

## Visual foundations

**Color.** `ground` is the page, `surface` is every card, `surface-raised` is an input or a hovered
row, `surface-overlay` is a menu or a toggle track. Text is `ink`, dropping to `ink-muted` for
descriptions and `ink-subtle` for eyebrows, axis labels and timestamps. `accent` is the single
interactive color: links, active nav, primary buttons, focus, progress. Anything on an `accent` fill
uses `on-accent` — dark ink on cyan, never white. `brand` is the electric blue, reserved for large
brand surfaces, illustration and the cover; it is not a button color. Status is `danger`, `warning`,
`info` and `success` over their `*-bg` fills, and a status color never appears without its word and
icon beside it — `success` is a teal rather than a green so that it separates from `danger` by
lightness, not only by hue. The `navy-*`, `blue-*` and `cyan-*` tokens are the sampled source palette:
reference swatches and illustration fills, not UI colors — reach for the semantic token instead.

**Type.** Sora is the display face, for page titles, card titles and every number that matters
(`metric-xl`, `metric-md`). Manrope sets all running text, labels and controls. JetBrains Mono sets
anything a machine produced — URLs, file names, hashes, sizes, timestamps in tables, API keys, log
lines — and that rule is absolute: a hand-typed URL in body text still goes in `mono`, so values stay
scannable in a column. The `label` style is the only uppercase text in the system.

**Spacing and layout.** The scale is a 4px grid: `space-1` through `space-16`. Cards pad at `space-6`,
grids gap at `space-5`, page gutters are `space-8`. Dashboards are bento grids of `Card` and
`StatTile` on `ground`; the verdict list is full width below them. One `Card` per view may carry
`highlight`.

**Borders, shadows and radii.** `border` is decorative — card edges, row dividers. `border-strong`
carries the shape of a control, so inputs, secondary buttons and toggles use it and clear 3:1 in both
themes. Radii climb from `radius-xs` on code chips to `radius-xl` on the nav rail and modals; buttons,
badges and toggles are `radius-pill`. Elevation is `elev-card` plus `inset-edge` — a hairline of light
on the top edge that gives panels their glass feel. The glow tokens (`glow-sm`, `glow-md`) are the
system's one indulgence and are spent only on the primary button, the score ring and the single
highlighted card; in `Daylight` they compile to ordinary shadows.

**States.** Focus is a 2px `focus-ring` outline at 2px offset on every interactive element, and it is
never removed. Hover lifts a surface one step (`surface` → `surface-raised`). Disabled drops opacity to
45% and keeps the cursor as `not-allowed`. Loading shows the skeleton of the content, never a spinner
over a populated view.

**Data visualisation.** Series run `chart-1` to `chart-5`, which differ in lightness as well as hue in
both themes; `chart-1` is the hero series. Sparklines inside `StatTile` are shape only — no axis, no
tooltip. A chart never encodes severity by color alone: label the series.

**Motion.** 150ms ease on color and transform, and nothing else. No entrance animation on data, no
pulsing on a malicious badge: a queue that moves while being read costs the reader the thing they
were reading.

## Iconography

The icon set is [Lucide](https://lucide.dev) (ISC licence) at 24×24 on a 2px grid, round caps and
joins. Use the `Icon` component, which draws the paths inline so they inherit `currentColor` — the SVG
files in `assets/Icons/` are the source copies and render as flat images, so they take their ink from
the group's README rather than from surrounding text. Sizes: 20px beside body text, 16–18px in dense
rows, 13px in badges, 26px in an empty state. Icons are decorative and `aria-hidden`; the text beside
them carries the meaning, and an icon-only button needs an `aria-label`. When a screen needs a glyph
that is not in the set, take it from Lucide rather than drawing one, add its paths to `PATHS` in
`components/bundle.js`, and copy the source SVG into `assets/Icons/`.

## Using the components

Everything is in `components/bundle.js` as `window.Aegis`, styled by `components/bundle.css` over the
compiled `tokens.css`. `Button`, `SeverityBadge`, `Card`, `StatTile`, `ScoreRing`, `ThreatTable`,
`AlertBanner`, `Field`, `SearchField`, `Toggle`, `NavRail`, `Tabs`, `Meter`, `LogStream`, `EmptyState`
and `Icon` each have their own README with the rules for that component — read it before using one.
