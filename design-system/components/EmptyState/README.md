# EmptyState

What a list shows when it is empty — which in this product is usually good news.

You provide `icon`, `title`, `description` and an `action` node. Place it inside a `Card` so it keeps
the panel's shape.

- Say what is true and why it is empty: "No active threats — every detection in this window has been
  resolved or suppressed."
- Say when it will next change ("The next sweep runs at 02:00 UTC"). An empty security view without a
  next step reads as a broken agent.
- The action is `secondary`, not `primary`: nothing is wrong, so nothing is urgent.
- A failed load is not an empty state. Use a `critical` `AlertBanner`.
