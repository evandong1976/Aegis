# Toggle

A switch for a setting that takes effect immediately — not a checkbox, which waits for a save.

You provide `checked`, `onChange` and `label`. It renders as `role="switch"` with `aria-checked`, so
the state is announced; the label is part of the control and clicking it toggles.

- On is `accent` with an `on-accent` thumb; off is `surface-overlay` with a `border-strong` edge.
- Label the setting, not the state: "Auto-block repeat offenders", never "Auto-block: on".
- A toggle that enforces policy and cannot be changed is `disabled` with the reason in its label
  ("Audit logging (required by policy)").
- A setting that needs confirmation — anything that stops traffic — is a Button, not a toggle.
