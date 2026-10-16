# AlertBanner

A message about the state of the system, placed at the top of the view it concerns.

Tones are `critical`, `warning`, `info` and `success`, each with a fixed icon and a `*-bg` fill with a
matching border. `critical` renders with `role="alert"`; the rest are `role="status"`, so a critical
banner interrupts a screen reader and the others do not.

You provide `title` (one line, the finding itself), children (one or two sentences of detail with the
specifics — host, address, time) and an optional `action` node. Put the remedy in the action, not in
the prose.

- The title says what is true, not what the product did: "Active intrusion on auth-gateway-01".
- One banner at a time. More than one competing message belongs in the threat list.
- A banner is dismissible only if it is `info` or `success`; critical and warning stay until the
  underlying state changes.
