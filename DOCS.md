# Farm Optimizer

A browser tool for planning farming in Travian (x3 speed, T4.6). Hosted at
<https://tablofan.github.io/farm-optimizer/> (GitHub Pages, repo root — the collector defaults to
it; install the collector from
<https://tablofan.github.io/farm-optimizer/collector.user.js>). Two optimizers share one dataset:

- **Oasis optimizer** — maximizes the total number of free oases farmed across your Role-pve
  villages: each oasis assigned to at most one village, within each village's cavalry capacity.
- **PvP optimizer** — reassigns your *existing* PvP farms (farm-list entries whose target is not a
  free oasis, with their configured sends) among your Role-pvp villages, minimizing total travel.
  It never adds or drops a farm.

Every village has a **Role** (pve / pvp / off) — exactly one optimizer may plan from it, so the two
plans never compete for the same troops. (The tool was named "PvE Optimizer" before the PvP side
existed; the repo slug may lag.)

See `CONTEXT.md` for the domain glossary, `docs/adr/` for architecture decisions (ADR-0004 covers
the PvP rebalancer), and `docs/PLAN.md` for the build plan / data contract.

## Two parts

1. **Collector** (`collector.user.js`) — a Tampermonkey userscript on the gameworld, read-only.
   **Scan oases** (sweep `POST /api/v1/map/position` — the only way to enumerate the whole map's
   free oases; the scan is stamped with a `scannedAt` time), then either **Send oases** /
   **Send page** (`postMessage` to the calculator) or **Download oases** (save the scan as a portable
   `{pve:'oases', …, scannedAt}` JSON file — oases are permanent for the world's life, so this
   survives a localStorage clear / new machine). It does *no* parsing — the page HTML carries
   villages / farm-lists / troops, and the calculator parses it. (Parsing lives in the calculator so
   selectors can be fixed by redeploying the page, with no userscript reinstall.) Never writes to the game.
2. **Calculator** (`index.html`) — a static page that **accumulates** sent data (oases + each sent
   page) and **persists** it in localStorage, presented in five tabs:
   - **Data & villages** — import (saved page `.htm`, an **oases-only file** — merged in, keeping
     villages/lists/config/skips — or a full JSON dataset, which replaces), the **one global sending
     interval (seconds)**, and the village table: per-village **Role** (pve / pvp / off — defaults
     derive once from the current lists: oasis farms → pve, PvP farms → pvp, both → pve + a conflict
     chip, empty → off; your stored choice then wins), TS / artefact, **editable troop counts** for
     every unit type (fallback when a troops page isn't sent), plus **Now** (current usage — rainbows
     the existing farm lists tie up, free-oasis targets only) and **Plan** (used/budget under the
     last Optimise) columns.
   - **Oasis Optimizer** — pick ≤3 cavalry types (carry-0 cavalry — scouts — are excluded; the
     picker shows speed only), filter by resource, Optimise. Shows a **display-only plan diff
     grouped by village** (keep / add / move / remove; the status toggles persist; a move stays
     under its *current* village tagged `→ destination`), lets you **skip** individual oases (a
     global opt-out — re-Optimise excludes them; persisted), each oasis linking to the in-game map.
   - **Oasis browser** — the free oases around any one village (inclusive distance band,
     nearest-first, its own resource filter, current farm-list membership) — independent of the
     optimizers, needs no cavalry counts.
   - **PvP Optimizer** — Rebalance reassigns the existing PvP farms among Role-pvp villages
     (keep / move only), with a per-village × per-unit-type **used/stock** table, shortfall
     highlighting, and warnings for entries it must exclude (unresolved list owner, frozen —
     holder not Role-pvp —, or no readable send comp).
   - **Movement planner** — "what would it take?": the oasis optimizer re-run with every Role-pve
     village's capacity replaced by one uniform hypothetical **Movement budget** (outgoing
     movements per village — a ceiling, never exceeded; troop stocks play no part in the solve).
     Reports per village the movements consumed = the stock of **each** selected cavalry type
     needed, with a **to-train** gap vs today's stock, plus the assignment grouped by village
     (farm-list membership shown per oasis as info — no plan diff) and leftovers as a summary
     count. It carries its **own** cavalry picker (seeded from the optimizer's selection) and
     resource filter, so hypotheticals never reconfigure the real plan.

   *Why send the page, not the map?* Villages/farm-lists/troops all live on one rendered page each
   (Send page captures them). The **map** doesn't: it renders as raster image tiles with no per-tile
   data, and only the visible viewport is ever loaded — so all free oases can only come from the API
   sweep. Expand the farm lists you want before sending (collapsed lists don't render their rows).

## Files

| File | Purpose |
|------|---------|
| `index.html` | Calculator UI + wiring (tabs, imports, both optimizers, plan diffs, roles). |
| `optimizer.js` | Pure core logic — torus distance, travel/cost model, greedy + exact-ILP oasis solver, PvP rebalancer, plan diff, oasis-browser query. Loadable in browser and Node. |
| `cavalry.js` | Per-tribe unit table (name / type / speed / carry), `t1..t10` slot mapping. |
| `collector.user.js` | Tampermonkey collector userscript. |
| `sample-data.json` | Sample dataset to try the calculator without the game. |
| `test.js` | Node unit tests for `optimizer.js` (`node test.js`). |
| `CONTEXT.md` · `docs/adr/` · `docs/PLAN.md` | Glossary · decisions · build plan + data contract. |

## How it works

- **Cavalry model (oasis side)** — a "rainbow" = 1 of each selected cavalry type; a village's budget
  = `min` over the selected types' counts; an oasis costs `ceil(2 × travel / interval)` rainbows (the
  **interval is entered in seconds** in the UI and converted to minutes for the cost model). The
  slowest selected unit sets travel speed (base ×2 for the speed server, ×artefact whole-trip,
  +20%/TS level beyond 20 fields). Distance is Euclidean on the wrapping −200..+200 map.
- **Oasis optimizer** — a max-cardinality Generalized Assignment Problem over Role-pve villages.
  There is **no reachability/travel cap** (see the ADR-0002 update — a 30 min cap existed briefly
  and was removed): budget feasibility alone prunes pairs, and max-cardinality only takes a far
  oasis when it adds a farm without displacing one. The workhorse is a **best-of-two greedy**:
  per-oasis cheapest-first *and* global cheapest-pair packing (sort all pairs by cost, assign while
  oasis free + budget left), keeping the better result — pair packing fixes the budget-burn cascade
  where an oasis whose cheap village is full immediately grabs an expensive fallback (benchmarked on
  a real 16,648-oasis world: +20 oases on the real account, +202 on a synthetic 20-village one; the
  51k-pair uncapped instance solves in ~80 ms). If every reachable oasis is placed the result is
  flagged optimal; otherwise the exact ILP is tried only at ≤50 pairs (`jsLPSolver`, CDN — its
  branch-and-bound cliffs at ~60 pairs: 62 pairs = 15 s, 78 pairs > 5 min), **timeboxed (10 s)**,
  its result *feasibility-checked* (a timeout can leak the fractional LP relaxation, which rounds
  to budget violations) and kept only if it beats greedy. The plan shows the **outgoing-movement**
  estimate (= Σ rainbow cost) against the 20,000 game cap.
- **PvP rebalancer** (ADR-0004) — the farm set is fixed (every farm-list entry whose target isn't a
  free oasis, with its parsed send comp); only *who holds each entry* changes. All unit types count
  (infantry included; the hero is ignored): a farm ties up `comp × ceil(2 × travel / interval)` of
  each type it sends, against the holder's per-type stocks; the slowest unit in the send sets its
  speed. Two phases **alternating to a joint fixpoint**: **overload repair** (while a village is
  over stock, move the farm closest to a receiving village that can absorb it) and **keep-biased
  improvement** (a farm moves only if it saves ≥ 2 min one-way — fixed, no knob); alternation
  matters because an improvement move can free exactly the receiver capacity a stuck repair
  needed. Budgets are **soft for staying, hard for moving**: the
  current state may be over budget (that's the main use case) and shows as per-type shortfalls, but
  a proposed move never creates or worsens one.

## Develop / test

```sh
node test.js                 # unit tests for the core logic
python3 -m http.server 8731  # then open http://localhost:8731/index.html, click "Load sample data"
# headless e2e (needs Chrome): serves the calculator, posts sample data, checks the UI
google-chrome --headless=new --disable-gpu --virtual-time-budget=10000 \
  --dump-dom http://localhost:8731/smoke-test.html | grep -E 'SMOKE-(OK|FAIL)'
```

(Open via a local server so `fetch('sample-data.json')` works; or use "Import JSON file".)

## Status

Calculator + core logic built and tested (Node unit tests + headless-browser end-to-end), including
the PvP rebalancer. The live DOM/endpoint parsers are written from documented selectors and marked
`VALIDATE LIVE` — confirm them against a logged-in gameworld (build-plan step 7). The newest of
these is the **per-entry send comp** parse in the farm-list slot rows (unit icons + counts), which
the PvP side budgets with — unvalidated entries degrade to a "no readable comp" warning, never a
silent wrong plan.
