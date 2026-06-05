# Display-only plan diff; never write to the game

## Status

accepted

## Decision

The calculator **only displays** a plan diff — it never creates, edits, or sends farm lists in the
game. The collector reads the current farm lists; the calculator reconciles the optimizer's
assignment against them and shows, per oasis, **keep / add / move / remove** (removals tagged with a
reason), each row linking to the oasis on the in-game map. The player applies changes by hand.

Reconciliation is scoped to **free oases only**: a current farm-list target is in scope only if its
coordinates match a free oasis in the scan. Village targets and occupied-oasis targets in the lists
are ignored — never flagged, moved, or removed.

## Context

The userscript is technically capable of writing farm lists in-game (`Ash-Warden`'s
`add_to_farmlist.py` demonstrates it), so auto-apply was a real option. It was rejected: the user
wants a review-and-act report, not unattended mutation of their account. Farm lists also legitimately
contain non-oasis targets (player villages, occupied oases the player clears) that the optimizer knows
nothing about; touching them would be destructive.

## Consequences

- No risk of the tool corrupting farm lists or taking game actions; all writes are manual.
- The collector must read current farm-list targets (coordinates) but needs no write capability.
- Classifying a target as free-oasis vs village/occupied falls out of matching against the scanned
  free-oasis set — no extra scraping.
- If oasis data is stale (an oasis annexed since the last scan), that target is no longer in the
  free-oasis scan, so it silently falls out of scope (treated like any non-oasis target) rather than
  being flagged for removal. Periodic re-scans keep this current. (Removal reasons are therefore:
  over capacity / not optimal, excluded by the resource filter, or duplicate.)
- A future "apply in-game" mode remains possible but is intentionally out of scope; revisit only with
  explicit per-action confirmation.
