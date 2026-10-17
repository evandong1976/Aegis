# Screen specs for Figma

Four frames, one page per screen, each **1440 × auto** on `ground` in the `Night ops` mode. The
rendered source of each is `../screens/<name>.html`; `reference/<name>.png` is that file rendered at
1440px.

Aegis scans links and downloads: every URL someone clicks and every file they download gets a
verdict, and dangerous ones are held or blocked. The whole interface is the queue of those verdicts
and the policy behind them.

## Verdicts

Four words, mapped onto the system's severity levels. Build the badge once per verdict and instance
it everywhere — no screen invents its own.

| Verdict | Level | Reads as |
| --- | --- | --- |
| Malicious | `critical` | blocked or quarantined outright |
| Suspicious | `high` | held, waiting on a person |
| Unknown | `medium` | allowed but flagged — newly registered, unresolved |
| Clean | `secure` | delivered |

## The shell, shared by all four

Page frame: horizontal auto layout, padding `space-5`, gap `space-5`, `ground` fill.

- **Left** — a `NavRail` instance, 236 wide, pinned top. Four items: Overview, Links (46),
  Downloads (37), Settings. Counts are what is waiting on a person, never totals scanned. Exactly
  one item is `Active`, and it is the screen you are on.
- **Right** — a vertical auto-layout column, `space-5` gap, filling the rest.
  - **Top bar**: eyebrow in `Text/label` over the title in `Display/display-md`; a `SearchField`
    (420 max, placeholder "Search URLs, files or hashes", `⌘K`) pushed right; a ghost bell button;
    an account chip — `surface` fill, `border` stroke, `radius-pill`, 26px `accent-soft` avatar
    with `Data/mono-sm` initials.
  - **Body**: the sections below.

Grids: `grid--4` four equal columns, `grid--2` two, `grid--split` 2fr + 1fr, `grid--hero` 300px +
the rest. Gap is always `space-5`.

---

## 1. Overview — "What got through today"

1. `AlertBanner` / Critical about a live phishing campaign, with a Danger button action.
2. `grid--hero`: a `Card` / Highlight holding a 168 `ScoreRing` at 92 labelled Coverage, with one
   muted line under it; then a `grid--2` of four `StatTile`s — Links scanned (positive delta,
   sparkline), Links blocked (negative), Files scanned, Files quarantined (negative, sparkline).
3. `grid--split`: a `Card` holding a five-row `ThreatTable` — Verdict, URL or file (mono), Seen in,
   User, Scanned — beside a `Card` of four coverage `Meter`s.
4. Full-width `Card` holding a five-line `LogStream` of raw scan events.

## 2. Links — "URL verdicts"

1. `grid--4` of `StatTile`s: Scanned today, Blocked, Awaiting review, Median verdict time.
2. One `Card` filling the width, header carrying a Secondary and a Primary button. Inside: a row
   with `Tabs` (Awaiting review 46, Blocked 212, Allowed, Allowlisted) left and a 320px
   `SearchField` right; then a seven-row `ThreatTable` — Verdict, URL (mono), Reason, User,
   Clicked in, Scanned, Action.

## 3. Downloads — "File verdicts"

1. `grid--4` of `StatTile`s: Files scanned, Quarantined, Blocked by policy, Detonated.
2. Full-width `Card`: `Tabs` (Quarantined 37, Held 14, Delivered, All) with a 280px `SearchField`,
   then a six-row `ThreatTable` — Verdict, File (mono), Kind, Size, User, Scanned, Action. Full
   width because seven non-wrapping columns do not fit a half-width card.
3. `grid--2`: a `Card` of four `Meter`s (which engine caught it) and a `Card` with a four-column
   bar chart by file type.

## 4. Settings — "Workspace"

1. `grid--2`: a `Card` of three `Field`s (one disabled); a `Card` of two `Field`s — one in Error —
   over a Primary and a Ghost button.
2. `grid--2`: a `Card` of five divided policy rows, each a label plus a 12px `ink-subtle` line with
   a `Toggle` right-aligned (the last Disabled); beside it a `Card` with a key/value list of where
   Aegis is watching, and a Warning `AlertBanner` beneath it.

---

## Checks before calling a frame done

- Every fill, stroke, radius and gap resolves to a variable. Select any layer and the paint reads
  as a token name, not a hex.
- Switching the page to `Daylight` leaves every frame legible, with no layer that vanishes into its
  background.
- Nothing is a flattened screenshot — each section is instances of the components in
  `components.md`.
- Every verdict badge keeps its icon and its word.
- The active nav item matches the screen, and no two screens share an active item.
