# Aegis

Security operations product — threat monitoring, asset inventory, identity posture and incident
response.

## `design-system/`

The Aegis design system: tokens, fonts, the component bundle and the guidelines that go with them.
It is also published as a browsable design system artifact, and the two are kept in step — change a
value here and in the artifact together.

| Path | What |
| --- | --- |
| `design-system/README.md` | The brand book: voice, color, type, spacing, iconography. **Read this first.** |
| `design-system/tokens.json` | The source of truth for every token, in both themes. |
| `design-system/tokens.css` | Generated from `tokens.json`: custom properties, `@font-face`, the type-scale classes. |
| `design-system/components/bundle.js` | All components as one classic script assigning `window.Aegis`. Needs React 18 and ReactDOM 18 on `window`. |
| `design-system/components/bundle.css` | Component styles. Load after `tokens.css`. |
| `design-system/components/index.d.ts` | Props for every component. |
| `design-system/components/<Comp>/README.md` | When to use that component and the rules for it. |
| `design-system/components/<Comp>/preview.html` | A live example of that component. |
| `design-system/fonts/` | Sora, Manrope, JetBrains Mono as variable `woff2` files. |
| `design-system/assets/icons/` | The Lucide source SVGs (ISC). |

### Using it

```html
<link rel="stylesheet" href="design-system/tokens.css">
<link rel="stylesheet" href="design-system/components/bundle.css">
<script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
<script src="design-system/components/bundle.js"></script>
```

Set the theme on the root element: `<html data-theme="dark">` for *Night ops* (the default and the
one to design in) or `data-theme="light"` for *Daylight*. Then:

```js
const { Card, StatTile, SeverityBadge, ThreatTable } = window.Aegis;
```

`tokens.css` is generated — edit `tokens.json` and regenerate, never the CSS by hand.

### Rules that are not negotiable

- Text pairs clear 4.5:1 and control borders 3:1 in **both** themes. Check a new color before using it.
- Severity is never carried by color alone: `SeverityBadge` always keeps its icon and its word.
- Anything a machine produced — IPs, hashes, ports, timestamps, keys — is set in the `mono` scale.
- Focus is a 2px `focus-ring` outline on every interactive element, and it is never removed.
