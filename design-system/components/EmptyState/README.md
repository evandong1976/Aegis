# EmptyState

What a list shows when it is empty — which in this product is usually good news.

You provide `icon`, `title`, `description` and an `action` node. Place it inside a `Card` so it keeps
the panel's shape.

- Say what is true and why it is empty: "Nothing held — every link and file in this window came back
  clean."
- Say when it will next change ("Verdicts usually land in about a second"). An empty security view
  without a next step reads as a scanner that has stopped running.
- The action is `secondary`, not `primary`: nothing is wrong, so nothing is urgent.
- A failed load is not an empty state. Use a `critical` `AlertBanner`.
