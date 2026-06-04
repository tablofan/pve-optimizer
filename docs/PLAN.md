# PvE Optimizer — Build Plan

Implementation plan for the design captured in `CONTEXT.md` and `docs/adr/0001-0003`. Two artifacts:
a **Collector** userscript and a static **Calculator** page.

## Components

### A. Collector — Tampermonkey userscript (read-only, runs on the gameworld)

- `@match` the gameworld hosts (`*.travian.com`). Page-context `fetch`, session cookie only (no token;
  CSP is just `frame-ancestors 'self'`).
- **Free oases** — sweep `POST /api/v1/map/position` over a grid of windows covering −200..+200.
  Per tile: free oasis = title token `{k.fo}`; bonus from `text` tokens `{a.r1}=wood {a.r2}=clay
  {a.r3}=iron {a.r4}=crop`, each with a `%`; coords from `position`. Throttle ~0.5–1.5 s/call.
  (Oasis locations/types are permanent → cache; only free-vs-occupied drifts.)
- **Own villages** — `#sidebarBoxVillageList` → `data-did` + coordinates; detect account **tribe**.
- **Cavalry counts** — per village from `build.php?gid=16&tt=1` (or dorf3 Troops tab): `t1..t10`.
- **Current farm lists** — `build.php?id=39&gid=16&tt=99` → per list: owning village + target coords.
- **Export** one JSON (the data contract below) and hand off to the Calculator
  (localStorage key + open Calculator URL, or postMessage). Never writes to the game.

### B. Calculator — static `index.html` (sibling of `trade-route-calculator`)

- Import the JSON. Bundle a **cavalry data table** (from `Ash-Warden/.ai/documentation/troops_t46.json`):
  per tribe, the cavalry units (`type:"c"`) with `speed` (base fields/h) and `cap`; map `t1..t10` →
  unit via tribe (race indices: 0 Romans, 1 Teutons, 2 Gauls, 3 Nature, 4 Natars, 5 Egyptians,
  6 Huns, 7 Spartans, 8 Vikings).
  Note: those 0-based race indices are **internal** to `troops_t46.json`'s layout. The **wire** `tribe`
  field is a lowercase **slug** (`huns`, …); the collector maps the in-game Travian tribeId
  (1 Romans … 6 Egyptians, 7 Huns, 8 Spartans) to that slug.
  ⚠️ The local json has ≥1 stale value — Huns **Marksman is base 16, not 15** (verified ×3 vs
  Kirilloid `t4.fs/units.ts`). Re-derive the full cavalry table from
  `raw.githubusercontent.com/kirilloid/travian/master/src/model/t4.fs/units.ts` (`v` = velocity)
  rather than trusting the json, then sanity-check one route against the in-game rally-point ETA.
- **Per-village input table** (manual): TS level, speed-artefact multiplier (interval is global), plus
  read-only **Now** (Current usage: Σ cost over the village's existing farm-list targets that match a
  scanned free oasis — duplicates cost twice, lists with an unresolved village aren't counted, `—`
  until a cavalry type is selected; refreshed on interval/TS/artefact/selection edits and after a run)
  and **Plan** (used/budget from the last Optimise; `—` before one).
- **Controls**: pick ≤3 cavalry types — only `type:'c'` with `cap > 0` are candidates (carry-0
  cavalry = scouts, excluded in `cav()` and again in `buildInstance`); choose villages; 4-resource
  filter (oasis buckets by primary/non-crop bonus). Plan-diff status toggles (add/move/keep/remove)
  persist in `config.diffFilters`. No method line in the results — solver/cap diagnostics dropped,
  per-village usage lives in the village table.
- Compute the cost matrix → build + solve the ILP (`glpk.js`) → diff vs current farm lists → render
  the **Plan diff** table.

## Data contract (Collector → Calculator)

```json
{
  "server": "https://tsXX.x3...travian.com",
  "tribe": "huns",
  "mapRadius": 200,
  "scannedAt": "<iso>",
  "villages": [{ "did": 12345, "name": "A001", "x": -18, "y": -93, "troops": { "t1": 0, "...": 0, "t10": 0 } }],
  "oases":    [{ "x": -20, "y": -90, "bonuses": [{ "res": "clay", "pct": 25 }, { "res": "crop", "pct": 25 }] }],
  "farmLists":[{ "listId": 1, "name": "A001 oases", "villageDid": 12345, "targets": [{ "x": -20, "y": -90 }] }]
}
```

The collector can also **Download oases** as an oases-only subset of this contract —
`{ "pve":"oases", "oases":[…], "server":…, "mapRadius":…, "scannedAt":… }` — which the calculator's
Import **merges** (replaces oases, keeps villages / farm-lists / troops / per-village config / skips),
rather than the full replace that a complete dataset triggers.

## Travel / cost model

- `spd_fpm = slowest_selected_base × 2 × artefact[v] / 60` (fields per minute; **×2 = speed-server
  rule, not ×3**).
- `dist(o,v)` = torus-Euclidean on −200..+200: `dx = min(|Δx|, 401−|Δx|)`, likewise `dy`,
  `dist = √(dx²+dy²)` (kept as a float — matches in-game ETA precision; not rounded).
- `tt = min(dist,20)/spd_fpm + max(dist−20,0)/(spd_fpm × (1 + 0.2·TS[v]))` minutes (TS only beyond 20
  fields; artefact already in `spd_fpm` applies whole trip; no hero/boots).
- `cost(o,v) = ceil(2·tt / interval)` rainbows; feasible iff `cost ≤ budget[v]`. `interval` is one
  **global** value entered in the UI in **seconds**; it is divided by 60 (→ minutes) at the
  `gatherCfg` boundary so the optimizer's cost model stays in minutes. (Was: per-village, minutes.)
- `budget[v] = min` over selected cavalry types of that village's count.
- **Travel cap** (`cfg.maxTravelMin`, one **global** value in **minutes**, 0/null = none, default 30):
  pairs with `tt > cap` are dropped in `buildInstance` before solving; a pair that fails the budget
  test is pruned as unaffordable regardless of the cap (so diff reasons can name the knob that
  actually binds). Rationale (measured on a real 16,648-oasis world at interval 190 s): without the
  cap every oasis is affordable to a large village (cost ≈ 1.46×dist ≤ 355 ≪ budget 613), so the
  solver may assign farms up to **243 fields** away — and the pair count (51,007) swamps any exact
  method. With a 30 min cap: 248 pairs, max dist ~13 fields, same farm count (150 — the count gain
  over the old greedy comes from the best-of-two construction below, not the cap; the cap's payoff
  is sane assignments and a tractable instance).
- **Skip** (global opt-out): coords in `cfg.skipped` are dropped from the candidate set in
  `buildInstance`, so they are never assigned; `planDiff` is also given the skip set so a
  currently-farmed skipped target is tagged `remove (skipped)` rather than misread as resource-filtered.

## Optimizer (exact GAP ILP)

- Binary `x[o,v]` per feasible pair. `maximize Σ x[o,v] − ε·Σ cost[o,v]·x[o,v]`.
- `Σ_v x[o,v] ≤ 1` (oasis ≤ 1 village); `Σ_o cost[o,v]·x[o,v] ≤ budget[v]`.
- **Best-of-two greedy** is the workhorse (`bestGreedy`): (a) per-oasis cheapest-first (`greedy`) and
  (b) global cheapest-pair packing (`greedyPairs` — all pairs sorted by (cost, dist), assign while
  the oasis is free and budget remains), keeping the better by (count, then movements). (b) fixes
  (a)'s budget-burn cascade: an oasis whose cheap village is full immediately takes an expensive
  fallback pair, stranding later cheap-only oases. Neither strictly dominates (rare ±1 cases both
  ways — fuzz-verified), hence best-of-both. Benchmarked vs LP bounds on the real 16,648-oasis world
  (5-algorithm bake-off: regret-greedy, local-search, Lagrangian, custom B&B, pair-packing): pair
  packing matched the heavy local-search/Lagrangian counts on every config at a fraction of the time
  (51k pairs: 150/151-bound in ~80 ms; 222k pairs: 609 in ~340 ms; capped configs are degree-1 ⇒
  greedy provably count-optimal, the LP bound's +1 is a fractional artefact).
- Solve with `jsLPSolver` (pure JS, CDN `<script>`; was `glpk.js` in the original design). The greedy
  is the incumbent; the ILP is attempted only at ≤ `maxExactPairs` (**50**) pairs and is **timeboxed**
  via `model.timeout` (`opts.exactTimeoutMs`, default 10 s — measured: B&B time explodes past ~50
  pairs on loose-budget instances, e.g. 49 pairs = 36 ms, 62 pairs = 15 s, 78 pairs > 5 min). A
  timed-out run returns the best incumbent, used only if it beats greedy and labelled not provably
  optimal. `solveExact` **feasibility-checks** the decoded assignment (budgets) — a timeout with no
  integral incumbent leaks the fractional LP relaxation, which rounds to budget violations (seen:
  622/613).
- **Outgoing-movement estimate** = `Σ cost` over assigned oases; flag against the 20,000 cap.

## Plan diff (display only)

- Match current farm-list targets to scanned free oases by coordinates; **only free oases are in
  scope** (village / occupied-oasis targets ignored).
- Per oasis: **keep / add / move / remove**; removals reason-tagged (over capacity, excluded by the
  resource filter, **out of range** — no feasible pair left: beyond the travel cap or over every
  budget —, duplicate, or **skipped**). A current target that is no longer a free oasis
  (annexed) or is a village is silently ignored — the collector only emits free oases, so such
  targets fall out of scope rather than being flagged. Each row links to `…/karte.php?x=&y=`.
- **Grouped by village** in the UI: keep/move/remove under the oasis's *current* holder, add under its
  destination; a move stays under its current village tagged `→ destination` (shown once, **not**
  mirrored under the destination — each group is the current contents of that village's list). Empty
  groups hidden; groups ordered as the in-game village sidebar. Skipped oases that are *not* currently
  farmed list under "Skipped, not farmed"; every skip row has an **unskip** control.

## Build order

1. Cavalry data module (table + tribe/`tN` mapping) — feeds everything.
2. Calculator skeleton: JSON import, per-village table, controls (against mock data).
3. Travel/cost + torus distance; unit-test against known in-game ETAs and the Excel.
4. ILP integration (`glpk.js`) + greedy fallback + movement estimate.
5. Plan-diff logic + table UI + map links.
6. Collector userscript: oasis sweep → villages/troops → farm lists → export + handoff.
7. End-to-end on a live world; tune throttle and validate token/selector parsing.

## Verified facts

- **Cavalry base speeds (fields/h, 1×)** — Huns: Spotter 19, Steppe Rider 16, Marksman 16, Marauder 14.
  Egyptians: Sopdu 16, Anhur 15, Resheph 10. Anchor: Gauls Theutates Thunder 19. (3 independent
  sources, high confidence. The local `troops_t46.json` had Marksman as 15 — use 16.)
- **Speed-server multiplier** — fixed **×2** on all speed worlds (x3/x5 alike), confirmed high.

## Open data items (validate at build time on a live world)

- Re-derive the full per-tribe cavalry table from Kirilloid `t4.fs/units.ts` (json is partly stale).
- Exact `/api/v1/map/position` tile token format on the current patch.
- Farm-list (`tt=99`) DOM/endpoint selectors; troop-table (`gid=16&tt=1`) parse.
- Map radius auto-detect (default 200).
