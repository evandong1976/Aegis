# Component specs for Figma

One entry per component in `design-system/components/`. Each is a variant set. Bind every fill,
stroke, radius and gap to a variable from `variables.json` — the hex values in the code are there
to be read, not retyped.

Auto layout everywhere. A component that holds text sets that text to a text style, never to a
loose font size.

---

## Button — `Actions`

| Property | Values |
| --- | --- |
| `Variant` | Primary, Secondary, Ghost, Danger |
| `Size` | Sm, Md, Lg |
| `State` | Default, Hover, Pressed, Focus, Disabled |
| `Icon` | None, Leading, Trailing, Both (boolean pair is fine) |

Padding: Sm `6px / space-4`, Md `10px / space-5`, Lg `13px / space-6`. Gap `space-2`, corner
`radius-pill`, text style `Text/body-sm` at weight 700.
Primary fill `accent`, text `on-accent`, effect `glow-sm`; Hover `accent-hover`, Pressed
`accent-pressed`. Secondary fill `surface-raised`, stroke `border-strong`, text `ink`. Ghost is
transparent with `ink-muted`, hovering to `accent-soft` + `accent`. Danger starts as `danger-bg`
with a `danger` stroke and `danger` text, and fills `danger` with `on-brand` text on hover.
Focus adds a 2px `focus-ring` outline at 2px offset — on every variant.
Disabled is 45% opacity.

## SeverityBadge — `Status`

| Property | Values |
| --- | --- |
| `Level` | Critical, High, Medium, Low, Secure |
| `Subtle` | True, False (False = bordered) |

Padding `4px space-3 4px space-2`, gap `space-1`, corner `radius-pill`, text style `Text/label`
at 12px/700 uppercase with `0.04em` tracking. Icon 13px at stroke 2.
Fills and strokes: Critical `danger-bg` / `danger`, High `warning-bg` / `warning`, Medium
`info-bg` / `info`, Low `surface-overlay` / `border-strong` with `ink-muted` text, Secure
`success-bg` / `success`. Icons: shield-alert, alert, info, activity, circle-check.
`Subtle = True` drops the stroke only. The icon and the word stay in every variant — that pairing
is what makes severity readable without color.

## Card — `Surfaces`

| Property | Values |
| --- | --- |
| `Header` | None, Title, Title + Action |
| `Highlight` | True, False |

Fill `surface`, stroke `border`, corner `radius-lg`, padding `space-6`, effects `elev-card` +
`inset-edge`. Header gap `space-5` to the body; eyebrow in `Text/label`, title in
`Heading/heading-md`, description in `Text/body-sm` on `ink-muted`.
`Highlight = True` swaps the stroke to `accent` and the effect to `glow-md`. Slot the body as a
content property.

## StatTile — `Data`

| Property | Values |
| --- | --- |
| `Delta` | None, Positive, Negative, Flat |
| `Sparkline` | True, False |
| `Unit` | True, False |

Fill `surface`, stroke `border`, corner `radius-lg`, padding `space-5 space-6`, effect
`inset-edge`. Label `Text/label` on `ink-subtle`; value `Data/metric-xl` on `ink`; unit 20px on
`ink-subtle`. Icon 16px in `accent`, top right.
Delta chip: `radius-pill`, `2px space-2`, 12px/700 — Positive `success-bg` / `success`, Negative
`danger-bg` / `danger`, Flat `surface-overlay` / `ink-muted`, with a trend-up or trend-down icon
at 13px. Sparkline is a 104×32 `accent` line over an `accent-soft` fill, right-aligned.

## ScoreRing — `Data`

| Property | Values |
| --- | --- |
| `Size` | 168, 132, 104 |

Track `surface-overlay`, bar `accent` with round caps and `glow-sm`. Stroke width 12 / 10 / 8 by
size. Value `Data/metric-xl` on `ink`, label `Text/label` on `ink-subtle`, both centred.
Expose the value as a text property; the arc is drawn to match, not animated. Never recolor the
ring by band — the number carries the meaning.

## ThreatTable — `Data`

Build a `Row` component and a `Header` component, then compose the table.

| `Row` property | Values |
| --- | --- |
| `State` | Default, Hover |
| `Severity` | Critical, High, Medium, Low, Secure |

Header: fill `surface-raised`, bottom stroke `border`, padding `space-3 space-5`, `Text/label` on
`ink-subtle`. Row: padding `space-4 space-5`, bottom stroke `border`, `Text/body-sm` on `ink`;
Hover fills `surface-raised`. Mono cells use `Data/mono` on `ink-muted` and never wrap. Wrapper:
`surface`, stroke `border`, corner `radius-lg`, clipped.

## AlertBanner — `Status`

| Property | Values |
| --- | --- |
| `Tone` | Critical, Warning, Info, Success |
| `Action` | True, False |

Padding `space-4 space-5`, gap `space-3`, corner `radius-md`, 1px stroke. Fill and stroke per
tone: `danger-bg`/`danger`, `warning-bg`/`warning`, `info-bg`/`info`, `success-bg`/`success`;
the icon takes the stroke color at 18px. Title 14px/700 on `ink`, body `Text/body-sm` on
`ink-muted`.

## Field — `Forms`

| Property | Values |
| --- | --- |
| `State` | Default, Hover, Focus, Error, Disabled |
| `Icon` | True, False |
| `Helper` | None, Hint, Error |

Label 13px/700 on `ink` with `space-2` beneath. Input: fill `surface-raised`, stroke
`border-strong`, corner `radius-md`, padding `11px space-4` (left `42px` with an icon), text 14px
on `ink`, placeholder `ink-subtle`. Hover strokes `accent`; Focus adds the `focus-ring` outline;
Error strokes `danger` and sets the helper to `danger` with a 13px alert icon; Disabled is 45%
opacity on the whole group.

## SearchField — `Forms`

| Property | Values |
| --- | --- |
| `State` | Default, Focus, Filled |
| `Shortcut` | True, False |

Same input shell at `radius-pill`, left padding `42px` for the 16px glyph, right padding `56px`.
Shortcut chip: `surface-overlay`, `border`, `radius-xs`, `Data/mono-sm` on `ink-subtle`.

## Toggle — `Forms`

| Property | Values |
| --- | --- |
| `Checked` | True, False |
| `State` | Default, Focus, Disabled |

Track 44×26, `radius-pill`: off is `surface-overlay` with a `border-strong` stroke and an
`ink-subtle` 18px thumb; on is `accent` filled and stroked with an `on-accent` thumb pushed 18px
right. Label 14px on `ink`, gap `space-3`. Label the setting, never the state.

## NavRail — `Navigation`

Build an `Item` component, then the rail.

| `Item` property | Values |
| --- | --- |
| `State` | Default, Hover, Active |
| `Count` | True, False |

Item: padding `10px space-3`, gap `space-3`, corner `radius-md`, icon 18px, label 14px/600 on
`ink-muted`. Hover fills `surface-raised` with `ink`. Active fills `accent-soft` with `accent`,
and its count chip inverts to `accent` / `on-accent`. Count chip otherwise `surface-overlay` /
`ink-muted` in `Data/mono-sm` at `radius-pill`.
Rail: width 236, fill `surface`, stroke `border`, corner `radius-xl`, padding `space-5 space-4`,
effects `elev-card` + `inset-edge`. Brand row in `Heading/heading-md` on `accent` with a
shield-check glyph.

## Tabs — `Navigation`

| `Tab` property | Values |
| --- | --- |
| `State` | Default, Hover, Active, Focus |
| `Count` | True, False |

Set: `surface-raised`, stroke `border`, `radius-pill`, padding `space-1`, gap `space-1`. Tab:
`7px space-4`, `radius-pill`, 13px/700 on `ink-muted`; Active fills `accent` with `on-accent` and
flips its count chip to `on-accent` / `accent`.

## Meter — `Data`

| Property | Values |
| --- | --- |
| `Tone` | Accent, Success, Warning, Danger |

Label 13px on `ink-muted`, readout `Data/mono` on `ink`, `space-2` above the track. Track 8px,
`radius-pill`, `surface-overlay`; bar `radius-pill` in `accent`, `success`, `warning` or
`danger`. No gradients.

## LogStream — `Data`

| `Line` property | Values |
| --- | --- |
| `Level` | None, Block, Warn, Allow |

Container: fill `ground`, stroke `border`, `radius-md`, padding `space-4`, 2px between lines —
the one place `ground` sits on top of `surface`. Line: `Data/mono-sm`, gap `space-3`; time on
`ink-subtle`, level in a 56px column uppercase, text on `ink-muted`. Block/Warn/Allow color both
the level and the text `danger` / `warning` / `success`. Lines wrap; they never truncate.

## EmptyState — `Surfaces`

Padding `space-12 space-8`, centred. Icon badge 56px circle in `accent-soft` with a 26px `accent`
glyph, `space-5` beneath. Title `Heading/heading-md`, body `Text/body-sm` on `ink-muted` at a
44ch measure, action `space-5` below as a Secondary button.

## Icon — `Foundations`

| Property | Values |
| --- | --- |
| `Name` | the 26 names in `design-system/assets/icons/` |
| `Size` | 13, 16, 18, 20, 26 |

24×24 frame, 2px grid, round caps and joins, stroke 1.75 (2 at 13–16px). Draw the stroke with a
variable so an instance recolors with its context. Source SVGs are in
`design-system/assets/icons/` — import those rather than redrawing.
