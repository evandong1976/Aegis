# What is in the Figma file

*Aegis — Demo path* · https://www.figma.com/design/WrLGMPAzH8nZ8zjd2hJ9Kb · page **Demo path**

## Foundations

| Collection | Modes | Holds |
| --- | --- | --- |
| Aegis Color | Night ops | 41 colour variables — 11 palette swatches sampled from the reference image, 30 semantic (`ground`, `surface`, `ink`, `accent`, the four verdict pairs, five chart series) |
| Aegis Spacing | Value | `space-1` … `space-16` |
| Aegis Radius | Value | `radius-xs` … `radius-pill` |

15 text styles (Display, Heading, Text, Data) in Sora, Manrope and JetBrains Mono. 4 effect styles
(`glow-sm`, `glow-md`, `elev-card`, `inset-edge`). Every variable carries its `var(--token)` code
syntax, so Dev Mode hands a developer the same name the CSS uses.

**Daylight is missing on purpose.** This Figma plan allows one mode per collection. The light values
are in `design-system/tokens.json` and `variables.json`; on a paid plan add a `Daylight` mode and
load them from there rather than retyping them.

## Components

| Set | Variants |
| --- | --- |
| VerdictBadge | Malicious · Suspicious · Unknown · Clean |
| Button | Primary · Secondary · Ghost · Danger |
| StatusDot | Ok · Degraded · Down |
| ScanStep | Done · Active · Pending |
| TimelineStep | Danger · Warning |
| CodeLine | Normal · Flagged |

Each set carries a description explaining when to use it. Instances are used throughout the three
frames — nothing is a flattened picture.

## Screens — demo path

| Frame | Size | What it shows |
| --- | --- | --- |
| Mini panel | 360 × 480 | Status and the four service dots, this page's link counts with the phishing link named, a live scan with its steps, recent verdicts, and the pause / open actions. Matches `MEGA_PROMPT.md` §5.8. |
| Report | 1040 × 1038 | The verdict header with risk score and actions, the "what would have happened" timeline, code evidence with flagged lines naming their finding, indicators, capabilities, which checks ran, and the sandbox footer. Matches §5.7's Report tab. |
| Click guard | 1280 × 820 | The in-page overlay on a blocked click: what the link said against where it actually goes, the reasons, and back / inspect / continue. |

## Not built yet

The rest of `MEGA_PROMPT.md` §5.7: the Scans, Accuracy, Messages and Settings tabs, the tray menu,
the extension's link outlines and scam-text banner, and first-run setup. The components and
variables above cover most of what those need; `components.md` has specs for nine further components
(Card, StatTile, ScoreRing, ThreatTable, AlertBanner, Field, SearchField, Toggle, Meter) that exist
in code but not yet in Figma.
