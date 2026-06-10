# PvP rebalancer: keep-biased reassignment over role-partitioned villages

## Status

accepted

## Decision

Add a **PvP optimizer** to the calculator that reassigns the existing **PvP farms** — every current
farm-list entry whose target is not a free oasis (player villages and occupied oases alike) — among
the player's villages. Its shape:

- **The farm set is fixed.** A PvP farm is a farm-list *entry* (target + its configured send); the
  optimizer decides *who* holds each entry, never *whether* it is farmed. The same target in two
  lists is two farms, each reassigned independently — double-farming is intentional, never merged
  or flagged as a duplicate.
- **Sends are data, not decisions.** Each entry's troop composition is parsed from the farm-list
  page as-is and never resized. All `t1..t10` unit types count (infantry included); the hero is
  dropped from a comp with a warning (there is one of him, and his speed depends on untracked gear).
  Travel speed = slowest unit in the entry's send.
- **Same in-flight cost physics as oases**: an entry ties up `send × ceil(2 × travel / interval)`
  of each unit type, against per-type village stocks (not the cavalry-rainbow min).
- **Objective: minimum total travel, keep-biased.** A global re-solve, but a farm stays with its
  current village unless the move is forced by an overload or saves ≥ 2 minutes one-way (fixed
  constant, no knob) — no churn for marginal gains.
- **Budgets are soft for staying, hard for moving**: a farm may remain with an over-committed
  current village (the current state being infeasible is the tool's main use case), but a move
  never creates or worsens a shortfall. Residual shortfalls are reported per village × unit type.
- **Villages are role-partitioned** — `role ∈ {pve, pvp, off}`, persisted per village, replacing
  the boolean `inc`. The oasis optimizer plans only from PvE-role villages; the PvP optimizer only
  from PvP-role villages. Defaults derive once from the current lists (free-oasis targets → PvE;
  PvP farms → PvP; both → PvE + conflict warning) — but only on **evidence**: an oasis scan must
  exist and the village must show farms in some list. A farm-less village *displays* as off without
  being pinned (collector pages arrive in any order — deriving "off" from a not-yet-sent farm-list
  page would lock every village out), so **off** is stored only by explicit player choice. The
  stored choice then wins, and a stored role contradicted by the lists (off included) is warned
  about, never silently re-derived. A both-kind village's PvP farms are frozen (not rebalanced)
  until resolved; entries in lists whose owning village is unresolved are likewise excluded with a
  warning.
- **Display-only diff, keep / move only** (per ADR-0003's ethos) — nothing is ever added or removed.

## Context

The farm lists already contain the player's PvP farms with hand-tuned sends; what drifts out of
shape is *which village holds them* — troops get spent, new villages settle, lists accrete. The
motivating case: village A holds more farms than its troops can sustain while village B idles, and
the farms nearest B should move first.

The shared-troop-pool question (both optimizers drawing on the same units) dissolved by adopting
the player's actual practice: **a village farms oases or players, never both**. Role-partitioning
makes that practice a first-class, visible rule and keeps the two plans jointly feasible with no
budget coupling. It also resolves the empty-village contention — a fresh village with idle troops
is claimed by neither side until its role is set explicitly.

## Considered options

- **Joint solve** (one model assigning oases and PvP farms together) — rejected: couples two
  objectives (max oasis count vs min PvP travel) that would need an explicit exchange rate,
  complicates both diffs, and the role partition removes the need.
- **Repair-only rebalancing** (fix overloads with minimal moves, nothing else) — rejected: never
  improves a feasible-but-bad layout, e.g. a cluster farmed from 25 minutes away while a village
  6 minutes away idles. Keep-bias on a global re-solve gives the same low churn without that blind
  spot.
- **Pure global re-solve** — rejected: proposes marginal moves a player applying changes by hand
  would never bother with.
- **Tile identity + duplicate removal** (as the oasis side does) — rejected: double-farming a fat
  target is a real tactic, and with fixed sends there is no principled merge of two different comps.
- **Shared pool with priority** (PvP demand reserved first, oases get the residue) — rejected in
  favour of role-partitioning: simpler, matches actual play, and avoids cross-tab plan staleness.

## Consequences

- The farm-list parser must capture per-entry send compositions (today: coordinates only) — new
  selectors to `VALIDATE LIVE`; the data contract's `targets` entries grow a per-unit comp.
- `config.perVillage[did].inc` migrates to `role` under the same evidence rule: `inc:false` →
  `pvp` if the village holds PvP farms (even alongside oasis farms — the player had already opted
  it out of oasis farming), else `off`; unset → the derived defaults above. **Empty villages now
  default to off** — a deliberate behaviour change: a troops-only village no longer receives oasis
  assignments until its role is set to PvE.
- The min-cost fixed-set formulation is a second solver shape beside the max-cardinality GAP;
  greedy machinery is reusable, but the objective, keep-bias, and soft-keep feasibility rules
  differ.
- The hero, both-kind villages, and unresolved lists all degrade to visible warnings — never
  silent drops.
