# Field

A labelled text input with its hint and error in one block.

You provide `label` and any native input props (`type`, `value`, `defaultValue`, `placeholder`,
`disabled`, `onChange`); everything unrecognised passes through to the `<input>`. `icon` puts a glyph
inside the control's left edge, `hint` explains the field below it, and `error` replaces the hint, turns
the border `danger` and sets `aria-invalid`.

- The label is always visible. A placeholder is never the label.
- Hints say what the value does ("Shown on every exported report"), not what to type.
- Errors name the cause and the fix: "This key was revoked on 4 Oct." Never "Invalid input".
- The input sits on `surface-raised` with a `border-strong` edge — the border carries the control's
  shape at 3:1, so the fill alone is never the boundary.
