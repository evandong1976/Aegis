# Figma

The Figma file and the record of how it maps back to this repo.

**File:** *Aegis — Demo path* · https://www.figma.com/design/WrLGMPAzH8nZ8zjd2hJ9Kb
Two sections: **Components** (six variant sets) and **Screens — demo path** (mini panel, Report,
click-guard overlay). Built from `tokens.json`; every fill, stroke, radius and gap is a bound
variable.

**One known gap:** the Figma plan on this account allows a single mode per variable collection, so
*Aegis Color* carries **Night ops** only. Daylight values still live in `tokens.json` and
`variables.json` — on a paid plan, add a second mode and load them in.
`design-system/tokens.json` stays the source of truth: it feeds both the code and the Figma
variables, and the file here is regenerated from it rather than edited by hand. Aegis scans links
and downloads — four screens, and a verdict on every URL clicked and file downloaded.

| File | What it is |
| --- | --- |
| `variables.json` | Every token as Figma variable collections, text styles and effect styles. Generated from `design-system/tokens.json`. |
| `components.md` | The 16 components as Figma component specs: variant properties, their values, and which variable binds to which property. |
| `screens.md` | The 4 screens as frame specs: size, section order, and which component each section is built from. |
| `reference/*.png` | The screens rendered from the real code at 1440px, as a visual reference while building. |

## Build order

Variables first, then components, then screens. A screen assembled before its components exist
becomes a pile of rectangles that no longer tracks the system.

1. **Variables** — `variables.json` defines three collections. *Aegis Color* carries two modes,
   `Night ops` (default) and `Daylight`; *Aegis Spacing* and *Aegis Radius* are single-mode
   numbers. Create the collections and modes first, then the variables, then bind `codeSyntax`
   so Dev Mode shows the same `var(--token)` the code uses.
2. **Text and effect styles** — the 15 text styles in `variables.json` map one-to-one to the type
   scale. The `label` style is uppercase by rule. The four effect styles carry per-mode values:
   the glows are cyan in Night ops and plain shadows in Daylight.
3. **Fonts** — Sora, Manrope and JetBrains Mono. The variable `woff2` files are in
   `design-system/fonts/`; install them locally, or use the Google Fonts versions of the same
   three families so weights match.
4. **Components** — build from `components.md`, each as a variant set with its properties. Bind
   fills, strokes, corner radius and spacing to variables; never type a hex into a layer.
5. **Screens** — assemble from `screens.md` using instances of those components. Check each frame
   against its `reference/*.png`.

## Rules that carry over from the code

- Nothing is hard-coded. Every fill, stroke, radius and gap is a bound variable, so switching the
  page to `Daylight` restyles the whole file.
- Severity is never carried by color alone — every verdict badge keeps its icon and its word. The
  four verdicts map onto severity levels; `screens.md` has the table.
- Machine output (URLs, file names, hashes, sizes, timestamps) is set in the `mono` styles.
- Each interactive component needs a `Focus` variant showing the 2px `focus-ring` outline.
- Text must clear 4.5:1 on its background in **both** modes. The token values already do; a new
  color invented in Figma has to be checked before it goes in.

## Code Connect

Not set up yet — it needs the component node IDs that only exist once the file is built. After the
components are in place, map each one to `design-system/components/<Comp>/` so Dev Mode hands
developers the real component instead of generated CSS. Props to expose are in
`design-system/components/index.d.ts`.
