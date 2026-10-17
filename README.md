# Aegis

Aegis scans links and downloads. Every URL someone clicks and every file they download gets a
verdict — Malicious, Suspicious, Unknown or Clean — and anything dangerous is held, quarantined or
blocked before it reaches the person.

The interface is four screens: **Overview**, **Links**, **Downloads**, **Settings**.

## Layout

| Folder | What |
| --- | --- |
| `design-system/` | Tokens, fonts, the component bundle and the guidelines. Start at its README. |
| `screens/` | The four screens, built from those components. Open any `.html` in a browser. |
| `figma/` | What's needed to build the Figma file: variables, component and screen specs, reference renders. |

## `design-system/`

| Path | What |
| --- | --- |
| `README.md` | The brand book: voice, color, type, spacing, iconography. **Read this first.** |
| `tokens.json` | The source of truth for every token, in both themes. |
| `tokens.css` | **Generated** — run `node design-system/build-tokens.mjs` after any change to `tokens.json`. Never hand-edit. |
| `build-tokens.mjs` | The compiler. `--check` exits non-zero if `tokens.css` is stale, for CI or a pre-commit hook. |
| `components/bundle.js` | All components as one classic script assigning `window.Aegis`. Needs React 18 and ReactDOM 18 on `window`. |
| `components/bundle.css` | Component styles. Load after `tokens.css`. |
| `components/index.d.ts` | Props for every component. |
| `components/<Comp>/README.md` | When to use that component and the rules for it. |
| `components/<Comp>/preview.html` | A live example of that component. |
| `fonts/` | Sora, Manrope, JetBrains Mono as variable `woff2` files. |
| `assets/icons/` | The Lucide source SVGs (ISC). |

### Using it

```html
<link rel="stylesheet" href="design-system/tokens.css">
<link rel="stylesheet" href="design-system/components/bundle.css">
<script src="screens/vendor/react.js"></script>
<script src="screens/vendor/react-dom.js"></script>
<script src="design-system/components/bundle.js"></script>
```

Set the theme on the root element: `<html data-theme="dark">` for *Night ops* (the default and the
one to design in) or `data-theme="light"` for *Daylight*. Then:

```js
const { Card, StatTile, SeverityBadge, ThreatTable } = window.Aegis;
```

React is vendored in `screens/vendor/` so the screens open with no network. Swap in your own copy
or a CDN when this becomes a real app.

## Rules that are not negotiable

- Text pairs clear 4.5:1 and control borders 3:1 in **both** themes. Check a new color before using it.
- A verdict is never carried by color alone: `SeverityBadge` always keeps its icon and its word.
  Malicious is `critical`, Suspicious is `high`, Unknown is `medium`, Clean is `secure`, and that
  mapping lives in one place — `screens/shell.js`.
- Anything a machine produced — URLs, file names, hashes, sizes, timestamps — is set in the `mono` scale.
- Focus is a 2px `focus-ring` outline on every interactive element, and it is never removed.
