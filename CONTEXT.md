# Farm Optimizer

A browser tool for planning farming in Travian (x3 speed, T4.6) — both **oasis farming** (which free
oases should each village farm, and what cavalry does that commit) and **PvP farming** (which village
should hold each existing player-farm). This file is the shared glossary — terms only, no
implementation. (_Was_: named "PvE Optimizer" when it only planned oases; the repo slug may lag the
rename.)

## Language

**Gameworld**:
A single Travian server instance, identified by its host (e.g. `ts30.x3.international.travian.com`).
All oasis data is scoped to one gameworld.
_Avoid_: server (ambiguous — can mean the backend), world, realm.

**Oasis**:
A nature map tile that a village can raid for resources. In this tool oases are assumed **empty**
(animal garrison already cleared) — combat is out of scope. Only **free** oases (not annexed to any
player's village) are farm targets; **occupied/annexed** oases are excluded.
_Avoid_: oase, oasys.

**Collector**:
The Tampermonkey userscript that runs on the gameworld and gathers the data — all free **Oases**
(coordinates + **Oasis type**), the player's **Villages** (coordinates + **Cavalry** counts), and the
**Current farm lists** — then hands it to the **Calculator**. It never writes to the game.

**Calculator**:
The static `index.html` page that imports the **Collector**'s data and presents it in tabs: a data /
village tab (import, global settings, **Roles**), the oasis optimizer, the **Oasis browser**, and the
**PvP optimizer**. Each optimizer displays its result as a **Plan diff** against the current farm
lists. Display only — the player applies changes by hand.

**Farm list**:
A Travian rally-point list of raid targets that the game re-sends on a cadence. The optimizers plan
each village's *ideal* farm-list membership — the oasis optimizer its free-oasis targets, the **PvP
optimizer** its **PvP farms**; the **Current farm lists** are what is set up now.

**Plan diff**:
The per-oasis comparison of the optimizer's assignment against the **Current farm lists**, labelling
each as **keep / add / move / remove**. Only **free Oases** are reconciled — village and
occupied-oasis entries in the lists are ignored (never moved or removed). A target is in scope only
if its coordinates match a free oasis in the scan; a target that is no longer a free oasis (e.g.
annexed since the scan) silently falls out of scope. Each row links to the oasis on the in-game
map (`karte.php?x=…&y=…`). Removals are tagged with a reason: over capacity, excluded by the resource
filter, **unaffordable** (costlier than every village's **Capacity**), duplicate, or **skipped**
(a currently-farmed **Skipped oasis**). The **PvP optimizer** shows its own analogous diff over
**PvP farms** — only **keep / move** (its farm set is fixed, so nothing is ever added or removed).

**PvP farm**:
A **Current farm list** target that is *not* a free **Oasis** — a player village or an occupied/annexed
oasis — together with the troops its list entry currently dispatches to it each cycle. Exactly the
targets the (oasis) **Plan diff** ignores: free-oasis targets and PvP farms partition the farm lists.
The set of PvP farms is taken as given — the **PvP optimizer** decides *who* farms each one, never
*whether* it is farmed. A PvP farm is identified by its **list entry**, not its tile: the same target
farmed from two lists is two farms (double-farming is treated as intentional, never merged or
flagged as a duplicate — unlike free-oasis targets, where the **Plan diff** removes duplicates).
_Avoid_: pvp target (a farm is the target *plus* its **Send**), grey farm / inactive (inactivity is not modelled).

**PvP optimizer**:
The calculator feature that reassigns **PvP farms** among **Villages** to minimize total **Travel
time** within each village's per-unit-type troop stocks, using the same in-flight cost physics as
oasis farming (a farm ties up its send × `ceil(2 × travel / interval)`). It is **keep-biased**: a
farm stays with its current village unless moving is forced by an overload or beats a meaningful
travel tolerance — no churn for marginal gains. Contrast the oasis optimizer, which chooses *which*
free **Oases** to farm; the PvP optimizer never adds or drops a farm. Only **Villages** whose
**Role** is PvP participate — just as the oasis optimizer only plans from Role-PvE villages.
Budgets are **soft for staying, hard for moving**: a farm may remain with an over-committed current
village (the current state being infeasible is this tool's main use case), but a move never creates
or worsens a shortfall. Residual shortfalls are reported per village and unit type, never silently
absorbed.

**Oasis browser**:
A read-only view in the **Calculator** for browsing a single **Village**'s surroundings: all free
**Oases** within a **Distance** band of that village, always ordered nearest-first, filterable by
**Oasis type**. Independent of the optimizer — it needs no **Cavalry** selection and no plan; it
answers "what is around this village?", not "what should I farm?".
_Avoid_: oasis explorer, nearby oases (use only descriptively).

**Oasis type**:
The resource bonus an oasis carries (e.g. +25% lumber, +50% crop, or a double-bonus). Scraped
per-oasis alongside coordinates. For filtering it collapses to one of the **4 resources** by its
primary (first / non-crop) bonus — e.g. a clay+crop double buckets as **clay** — while the full type
is still displayed.
_Avoid_: oasis bonus (use only as a clarifier), oasis kind.

**Skipped oasis**:
A free oasis the player has manually marked **skip**, so the optimizer never assigns it to any
village (global — not per-village). Distinct from a resource-filtered or annexed oasis: the tile is a
perfectly valid free farm target, the player just opts it out by hand. Skips **persist across
sessions** (wiped only by Clear data) and stay listed on the results page with an **unskip** control.
_Avoid_: excluded (reserved for the resource-filter / annexed senses below), opted-out.

**Village**:
One of the player's own bases, with map coordinates and a stock of trainable cavalry. The origin
point from which oases are farmed. Each village has a **Role**.

**Role**:
A per-village declaration of which optimizer may plan from that **Village**: **PvE** (the oasis
optimizer), **PvP** (the **PvP optimizer**), or **off** (neither). Roles are exclusive — no village
is ever planned by both sides, which is what keeps the two plans jointly feasible without a shared
troop budget. A village's default role derives from its **Current farm lists** (free-oasis targets →
PvE; **PvP farms** → PvP; both → PvE plus a conflict warning) — but only once there is *evidence*:
an oasis scan must exist and the village must show farms in some list. A village with no visible
farms merely *displays* as off — nothing is pinned, so data arriving later can still derive it; only
the player's explicit choice stores a role for an empty village. Once stored, the choice wins, and a
stored role contradicted by the lists (any role, off included) gets a warning — never a silent
re-derivation.
_Avoid_: include / "Use" (the boolean it replaces), village type.

**Cavalry**:
Mounted units used to farm oases (the "horses"). The only troops the *oasis* optimizer plans for;
speed is set by the **slowest** cavalry type in a send. A mounted unit that **carries nothing** (a
scout — e.g. Spotter, Pathfinder, Equites Legati) is *not* Cavalry in this tool's sense: it can never
be part of a **Rainbow**. (The **PvP optimizer** is *not* cavalry-only — see **Send**.)
_Avoid_: horses (UI shorthand only), troops (too broad — includes infantry/siege the oasis side doesn't plan).

**Send**:
The troop composition a farm-list entry dispatches to one target each cycle — any mix of the tribe's
units, infantry included (unlike a **Rainbow**, which is cavalry-only and fixed at 1 of each type).
A **PvP farm**'s send is read from the list as-is, never resized; travel speed is set by the
**slowest** unit in that send, and the farm ties up `send × ceil(2 × travel / interval)` of each
unit type. The **hero** is ignored where he appears in a send (there is one of him, and his speed
depends on untracked gear).
_Avoid_: send size (it's a composition per type, not one number), raid (the in-game action, not the configuration).

**Rainbow**:
One farm-send composed of exactly **1 of each selected cavalry type** — the mix of unit types is
what makes it a "rainbow". A village can form `min(count of each selected type)` rainbows; a farmed
oasis ties up `ceil(2 × travel_time / interval)` of them (the round-trips in flight at any moment).
(The Excel's "111 / 222 / 333" meant 1 / 2 / 3 of each type; this tool fixes it at 1 of each — no
send-size knob.)
_Avoid_: clearing party (a rainbow here farms empty oases, it does not clear animals).

**Sending interval**:
How often (**seconds**) a village re-sends its farm list. Drives how many rainbows a given oasis ties
up (cost uses round-trip time and interval in consistent units).

**Travel time**:
Minutes for cavalry to reach an oasis, derived from **distance**, cavalry speed, **Tournament Square**
level, and **speed artefact** — never entered by hand (the Excel entered it manually; this tool computes it).

**Distance**:
Straight-line (Euclidean) map distance in fields between a village and an oasis, computed from their
coordinates. This world's map runs **−200..+200** on both axes (≈401 wide) and wraps (torus), so each
axis delta is wrap-capped — `d = min(|Δ|, 401 − |Δ|)` — before applying Pythagoras.
_Avoid_: travel length, squares / sq (Excel terms — both meant distance), range.

**Tournament Square (TS)**:
A village building that increases travel speed for the portion of a trip beyond 20 fields.
_Avoid_: TS (spell out at least once per surface).

**Speed artefact**:
A multiplier on troop travel speed, set **per village**: a *small* speed artefact boosts a single
village, while an account-wide (*unique/large*) artefact is modelled by setting the same multiplier on
every village. _Was_: described as strictly account-wide — corrected, since this tool keys it per village.

**Capacity**:
A village's available **Rainbows** = `min` over the selected cavalry types of their counts. The
oases assigned to a village are feasible only while their total cost (`Σ ceil(2 × travel/interval)`)
stays within this budget.

**Current usage**:
The **Rainbows** a village's **Current farm lists** tie up *today* — the same cost model applied to
its existing list targets instead of the plan's. Scoped like the **Plan diff**: only targets matching
a scanned free **Oasis** count (a **Skipped oasis** still being farmed counts — it costs rainbows
right now); occupied-oasis and village targets don't. Contrast with *plan usage*, the rainbows the
optimizer's assignment would tie up.
_Avoid_: before (ambiguous), committed (sounds like an in-game state).

**Outgoing movement**:
One in-flight farm-send occupying a troop-movement slot. At steady state a farmed **Oasis** holds
`ceil(2 × travel/interval)` of them, so the account total = the sum of all assigned rainbow costs.
The gameworld caps total troop movements at **20,000**; the **Calculator** displays this estimate
but does not optimize against it.

## Relationships

- A **Gameworld** contains many **Oases** (each with coordinates and an **Oasis type**).
- A **Village** has a **Role**: it farms **Oases** (PvE), holds **PvP farms** (PvP), or neither — never both.
- A **Village** farms zero or more **Oases**; an **Oasis** is farmed by **at most one Village** (no double-farming).
- The oasis optimizer maximizes the **total count of farmed Oases** across Role-PvE villages, within each **Village**'s **Capacity**.
- The **PvP optimizer** reassigns the fixed set of **PvP farms** among Role-PvP villages, minimizing total **Travel time** within per-unit-type troop stocks.
- Each oasis assignment ties up **Cavalry** as **Rainbows**; each **PvP farm** ties up its **Send** × waves in flight.
- **Travel time** is a function of **Distance**, unit speed (slowest in the send), **Tournament Square**, and **Speed artefact**.
- A **Village** has a **Capacity** — the rainbows it can sustain across its assigned oases at a given **Sending interval**.

## Example dialogue

> **Dev:** "When the user picks a **Village**, do we farm every **Oasis** in range?"
> **Player:** "No — only the ones we assign. Each oasis we add costs **Rainbows** every **Sending interval**, and the **Village** only has so many. That's the **Capacity** limit."
> **Dev:** "And the **Oasis type** — does it change the math?"
> **Player:** "Not the cavalry math. It's a label so I can choose which oases to farm."

## Flagged ambiguities

- **Farming vs Clearing** — *Farming* = repeatedly raiding an empty **Oasis** for resources (this tool's whole scope). *Clearing* = killing the animal garrison first (combat). Clearing is **out of scope**; oases are assumed pre-cleared.
- **"Rainbow"** — in the wider Travian community can mean a mixed clearing party; **here** it means a fixed-size cavalry farm-send (111/222/333). Resolved to the farming meaning.
- **"Travel length" (Excel) vs "Distance"** — the Excel's manually-entered "travel length (sq)" is what this tool calls **Distance** and computes from coordinates.
- **"Excluded" vs "Skipped"** — three different "this oasis is not farmed" senses, kept distinct: an **annexed/occupied** oasis is excluded because it is not a free target; a **resource-filtered** oasis is excluded by the 4-resource filter (a whole-type toggle); a **Skipped oasis** is one specific free tile the player opted out by hand. Only the last is "skip"; the first two are "excluded".
- **"PvP" is by exclusion, not by target kind** — a **PvP farm** is *any* farm-list target that isn't a free **Oasis**. An **occupied oasis** in a list is therefore a PvP farm even though raiding it is arguably PvE; the boundary is "does the oasis optimizer reason about this tile?", not game lore.
