# PvE Optimizer

A browser tool for optimizing **oasis farming** in Travian (x3 speed, T4.6). It maximizes the total
number of free oases farmed across your villages — each oasis assigned to at most one village, within
each village's cavalry capacity.

See `CONTEXT.md` for the domain glossary, `docs/adr/` for architecture decisions, and `docs/PLAN.md`
for the build plan / data contract.

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
   page) and **persists** it in localStorage. It parses villages / farm-lists / troops from sent
   pages, lets you pick ≤3 cavalry types (carry-0 cavalry — scouts — are excluded; the picker shows
   speed only), set **one global sending interval (seconds)** and **travel cap (max one-way minutes,
   0 = none)** + per-village TS / artefact (all persisted), **edit troop counts** (fallback when a
   troops page isn't sent), filter by resource, and Optimise. The village table shows per-village
   **Now** (current usage — rainbows the existing farm lists tie up, free-oasis targets only) and
   **Plan** (used/budget under the last run) columns. Shows a **display-only plan diff grouped by village**
   (keep / add / move / remove; the status toggles persist; a move stays under its *current* village tagged `→ destination`), lets
   you **skip** individual oases (a global opt-out — re-Optimise excludes them; persisted), each oasis
   linking to the in-game map. Import accepts a saved page (`.htm`), an **oases-only file** (merged in,
   keeping villages/lists/config/skips), or a full JSON dataset (replaces).

   *Why send the page, not the map?* Villages/farm-lists/troops all live on one rendered page each
   (Send page captures them). The **map** doesn't: it renders as raster image tiles with no per-tile
   data, and only the visible viewport is ever loaded — so all free oases can only come from the API
   sweep. Expand the farm lists you want before sending (collapsed lists don't render their rows).

## Files

| File | Purpose |
|------|---------|
| `index.html` | Calculator UI + wiring (imports the data, runs the optimizer, renders the plan diff). |
| `optimizer.js` | Pure core logic — torus distance, travel/cost model, greedy + exact-ILP solver, plan diff. Loadable in browser and Node. |
| `cavalry.js` | Per-tribe unit table (name / type / speed / carry), `t1..t10` slot mapping. |
| `collector.user.js` | Tampermonkey collector userscript. |
| `sample-data.json` | Sample dataset to try the calculator without the game. |
| `test.js` | Node unit tests for `optimizer.js` (`node test.js`). |
| `CONTEXT.md` · `docs/adr/` · `docs/PLAN.md` | Glossary · decisions · build plan + data contract. |

## How it works

- **Cavalry model** — a "rainbow" = 1 of each selected cavalry type; a village's budget = `min` over
  the selected types' counts; an oasis costs `ceil(2 × travel / interval)` rainbows (the **interval is
  entered in seconds** in the UI and converted to minutes for the cost model). The slowest
  selected unit sets travel speed (base ×2 for the speed server, ×artefact whole-trip, +20%/TS level
  beyond 20 fields). Distance is Euclidean on the wrapping −200..+200 map.
- **Optimizer** — a max-cardinality Generalized Assignment Problem. The **travel cap** prunes any
  (oasis, village) pair beyond the max one-way minutes *before* solving — without it a long interval
  makes the entire map "affordable" to a big village and the solver assigns 200-field farms. The
  workhorse is a **best-of-two greedy**: per-oasis cheapest-first *and* global cheapest-pair packing
  (sort all pairs by cost, assign while oasis free + budget left), keeping the better result — pair
  packing fixes the budget-burn cascade where an oasis whose cheap village is full immediately grabs
  an expensive fallback (benchmarked on a real 16,648-oasis world: +20 oases on the uncapped real
  account, +202 on a synthetic 20-village one; ties capped configs, where greedy is provably
  optimal). If every reachable oasis is placed the result is flagged optimal; otherwise the exact
  ILP is tried only at ≤50 pairs (`jsLPSolver`, CDN — its branch-and-bound cliffs at ~60 pairs:
  62 pairs = 15 s, 78 pairs > 5 min), **timeboxed (10 s)**, its result *feasibility-checked* (a
  timeout can leak the fractional LP relaxation, which rounds to budget violations) and kept only
  if it beats greedy. The plan shows the **outgoing-movement** estimate (= Σ rainbow cost) against
  the 20,000 game cap.

## Develop / test

```sh
node test.js                 # unit tests for the core logic
python3 -m http.server 8731  # then open http://localhost:8731/index.html, click "Load sample data"
```

(Open via a local server so `fetch('sample-data.json')` works; or use "Import JSON file".)

## Status

Calculator + core logic built and tested (Node unit tests + headless-browser end-to-end). The
collector's live DOM/endpoint parsers are written from documented selectors and marked
`VALIDATE LIVE` — confirm them against a logged-in gameworld (build-plan step 7).
