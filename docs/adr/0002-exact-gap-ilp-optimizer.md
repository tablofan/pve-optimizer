# Solve the oasis assignment as an exact GAP integer program

## Status

accepted

## Decision

Model oasis assignment as a max-cardinality **Generalized Assignment Problem** and solve it to proven
optimality with an in-browser MILP solver (`glpk.js`, GLPK compiled to WASM, loaded as a `<script>`
in the static calculator — no build step). Pure-JS `jsLPSolver` is the fallback library if the WASM
asset is undesirable; a greedy cheapest-first heuristic is the runtime fallback if the solver exceeds
a time budget on a pathological instance.

> **Update (as shipped):** the WASM asset was deemed undesirable, so the calculator loads the pure-JS
> `javascript-lp-solver` (`javascript-lp-solver@0.4.24`, from CDN) as its only ILP solver — there is
> no `glpk.js`/WASM. The greedy cheapest-first heuristic remains the runtime fallback, and also runs
> when the CDN script fails to load (e.g. offline).

Formulation (binary `x[o,v]` per feasible oasis-village pair):

- maximize `Σ x[o,v] − ε·Σ cost[o,v]·x[o,v]` (max oases farmed; tie-break to the cheapest packing)
- `Σ_v x[o,v] ≤ 1` for each oasis (an oasis is farmed by at most one village)
- `Σ_o cost[o,v]·x[o,v] ≤ budget[v]` for each village (rainbow capacity)
- `cost[o,v] = ceil(2 × travel_time(o,v) / interval)`, `budget[v] = min(selected cavalry counts)`

## Context

The user explicitly chose an exact optimum over a greedy heuristic. There is **no reachability cap**:
every free oasis is a candidate for every selected village. Infeasible pairs (`cost > budget`) are
pruned, which — because cost grows with distance — naturally bounds the candidate set without a
user-facing range limit. The 20,000 outgoing-movement game limit is displayed (total = `Σ cost` of
assigned oases), not optimized against.

## Consequences

- Max-cardinality GAP is **NP-hard** in the worst case (reduces from multiple knapsack), so exact
  solving is not worst-case polynomial. It is tractable here because (a) the number of villages `m`
  is small (≤ ~30) and (b) the GAP LP-relaxation is tight — a basic LP solution leaves at most ~`m`
  oases fractional (bounded by the count of capacity constraints), so branch-and-bound explores a
  shallow tree. Expected solve time is sub-second to a few seconds for realistic instances.
- The dominant wall-clock cost is the collector's map scan (throttled API calls, minutes), not the
  optimization (seconds).
- Without a range cap, large budgets + a whole-map scan can inflate the variable count; mitigated by
  feasibility pruning, a solver time limit returning the best incumbent + optimality gap, and the
  greedy fallback.
- Had the per-oasis cost been uniform, the problem would collapse to bipartite b-matching (solvable
  exactly in polynomial time via max-flow); it is the distance-dependent integer costs that make it
  a genuine GAP.
