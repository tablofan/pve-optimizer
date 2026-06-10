// Node unit tests for optimizer.js — run: node test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PVE = require('./optimizer.js');
const { UNITS } = require('./cavalry.js');

let pass = 0, fail = 0, skipped = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}
function tskip(name, why) { skipped++; console.log('SKIP  ' + name + ' (' + why + ')'); }
function approx(a, b, eps) { assert(Math.abs(a - b) <= (eps || 1e-6), `${a} ≈ ${b}`); }

console.log('geometry/travel');
t('torus wrap on -200..200 (size 401)', () => {
  // (200,0) and (-200,0) are 1 field apart across the wrap, not 400
  approx(PVE.distance(200, 0, -200, 0, 200), 1);
  approx(PVE.distance(0, 0, 3, 4, 200), 5); // pythagorean
});
t('travel time: Marauder (base14) to 28-field oasis, no TS', () => {
  // fph = 14*2 = 28; fpm = 28/60. first 20 fields + 8 fields = 28/(28/60) = 60 min
  approx(PVE.travelMinutes(28, 14, 1, 0), 60, 1e-6);
});
t('TS only applies beyond 20 fields', () => {
  const noTs = PVE.travelMinutes(40, 14, 1, 0);
  const ts5 = PVE.travelMinutes(40, 14, 1, 5);  // beyond-20 portion 2x faster (1+0.2*5=2)
  const ts5_first20 = PVE.travelMinutes(20, 14, 1, 5);
  approx(PVE.travelMinutes(20, 14, 1, 0), ts5_first20); // first 20 unaffected by TS
  assert(ts5 < noTs, 'TS should reduce time for >20 trips');
});
t('artefact multiplies whole trip', () => {
  approx(PVE.travelMinutes(40, 14, 2, 0), PVE.travelMinutes(40, 28, 1, 0)); // 2x artefact == 2x base
});
t('oasis cost = ceil(2*travel/interval)', () => {
  assert.strictEqual(PVE.oasisCost(60, 5), 24);  // ceil(120/5)
  assert.strictEqual(PVE.oasisCost(61, 5), 25);  // ceil(122/5)=24.4->25
});

console.log('oasis typing');
t('primary res = first non-crop; clay+crop -> clay', () => {
  assert.strictEqual(PVE.primaryRes([{res:'clay',pct:25},{res:'crop',pct:25}]), 'clay');
  assert.strictEqual(PVE.primaryRes([{res:'crop',pct:50}]), 'crop');
  assert.strictEqual(PVE.primaryRes([{res:'iron',pct:25}]), 'iron');
});

console.log('budget = min over selected cavalry counts');
t('budget is the scarcest selected type', () => {
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'V', x: 0, y: 0, troops: { t4: 1000, t5: 1800, t6: 1200 } }],
    oases: [{ x: 1, y: 0, bonuses: [{ res: 'crop', pct: 50 }] }], farmLists: [] };
  const inst = PVE.buildInstance(data, {
    units: UNITS.huns, selectedSlots: ['t4','t5','t6'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 5, artefact: 1 } }
  });
  assert.strictEqual(inst.villages[0].budget, 1000); // min(1000,1800,1200)
  assert.strictEqual(inst.baseSpeed, 14);            // slowest of Steppe16/Marksman16/Marauder14
});

t('carry-0 cavalry (scouts) are never farm-send candidates', () => {
  // Huns t3 = Spotter (cavalry, cap 0). Selecting it must not affect speed or budget.
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t3: 5, t4: 100 } }],
    oases: [{ x: 1, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }], farmLists: [] };
  const inst = PVE.buildInstance(data, { units: UNITS.huns, selectedSlots: ['t3', 't4'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 5, artefact: 1 } } });
  assert.deepStrictEqual(inst.selectedSlots, ['t4'], 'scout slot filtered out of the selection');
  assert.strictEqual(inst.villages[0].budget, 100, 'budget = Steppe Rider count, NOT min(5, 100)');
  assert.strictEqual(inst.baseSpeed, 16, 'speed from the real cavalry');
});

console.log('solver: greedy optimality + assignment');
t('greedy places every reachable oasis when budget is ample (=> provably optimal)', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-data.json')));
  const inst = PVE.buildInstance(data, {
    units: UNITS.huns, selectedSlots: ['t4','t5','t6'],
    includedDids: data.villages.map(v => v.did),
    resourceFilter: { wood: true, clay: true, iron: true, crop: true },
    perVillage: { 1001: { ts: 10, interval: 5, artefact: 1 },
                  1004: { ts: 8, interval: 5, artefact: 1 },
                  1006: { ts: 8, interval: 5, artefact: 1 } }
  });
  const r = PVE.solve(inst, {});
  assert(inst.maxPossible > 0, 'some oases feasible');
  assert.strictEqual(r.count, inst.maxPossible, 'all reachable placed');
  assert(r.optimal === true, 'flagged optimal');
  assert(r.movements > 0, 'movements estimated');
  // capacity respected
  inst.villages.forEach((v, vi) => assert(r.used[vi] <= v.budget, 'within budget'));
});
t('tight budget forces choices; greedy maximizes count & respects capacity', () => {
  // 2 villages, budget 3 each; 4 oases. v0 cheap to all (cost1), v1 cost2.
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 3 } },
               { did: 2, name: 'B', x: 2, y: 0, troops: { t6: 3 } }],
    oases: [ { x: 0, y: 1, bonuses: [{res:'crop',pct:25}] },
             { x: 1, y: 0, bonuses: [{res:'crop',pct:25}] },
             { x: 2, y: 1, bonuses: [{res:'crop',pct:25}] },
             { x: 3, y: 0, bonuses: [{res:'crop',pct:25}] } ],
    farmLists: [] };
  const inst = PVE.buildInstance(data, {
    units: UNITS.huns, selectedSlots: ['t6'], includedDids: [1, 2],
    resourceFilter: { crop: true },
    perVillage: { 1: { ts: 0, interval: 60, artefact: 1 }, 2: { ts: 0, interval: 60, artefact: 1 } }
  });
  const r = PVE.solve(inst, {});
  inst.villages.forEach((v, vi) => assert(r.used[vi] <= v.budget, 'within budget'));
  assert(r.count >= 1 && r.count <= inst.oases.length);
});

console.log('plan diff');
t('diff: keep/add/move/remove; ignores non-free-oasis targets', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-data.json')));
  const inst = PVE.buildInstance(data, {
    units: UNITS.huns, selectedSlots: ['t4','t5','t6'],
    includedDids: data.villages.map(v => v.did),
    resourceFilter: { wood: true, clay: true, iron: true, crop: true },
    perVillage: { 1001: { ts: 10, interval: 5, artefact: 1 },
                  1004: { ts: 8, interval: 5, artefact: 1 },
                  1006: { ts: 8, interval: 5, artefact: 1 } }
  });
  const r = PVE.solve(inst, {});
  const rows = PVE.planDiff(data, inst, r);
  assert(rows.length > 0, 'diff has rows');
  const statuses = new Set(rows.map(x => x.status));
  // the -50/-50 (occupied) and -18/-93 (village) targets must NOT appear as removals
  const badRemoval = rows.find(x => x.status === 'remove' && x.x === -50 && x.y === -50);
  assert(!badRemoval, 'non-free-oasis target ignored');
  assert(statuses.has('add') || statuses.has('keep') || statuses.has('move'), 'has actionable rows');
});

console.log('plan diff — regressions from review');
t('removal branch does not throw and tags reason (strict-mode `cur` fix)', () => {
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 100 } }],
    oases: [{ x: 1, y: 0, bonuses: [{ res: 'clay', pct: 25 }] }],
    farmLists: [{ listId: 1, name: 'A', villageDid: 1, targets: [{ x: 1, y: 0 }] }] };
  const inst = PVE.buildInstance(data, { units: UNITS.huns, selectedSlots: ['t6'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 60, artefact: 1 } } }); // clay excluded
  const r = PVE.solve(inst, {});
  let rows;
  assert.doesNotThrow(function () { rows = PVE.planDiff(data, inst, r); });
  const rem = rows.find(x => x.status === 'remove' && x.x === 1 && x.y === 0);
  assert(rem && /filter/.test(rem.reason), 'filtered current target flagged remove with reason');
});
t('multi-list oasis: one keep/move + one remove (no A→A, no double-farm)', () => {
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 100 } },
               { did: 2, name: 'B', x: 1, y: 0, troops: { t6: 100 } }],
    oases: [{ x: 0, y: 1, bonuses: [{ res: 'crop', pct: 25 }] }],
    farmLists: [{ listId: 1, name: 'A', villageDid: 1, targets: [{ x: 0, y: 1 }] },
                { listId: 2, name: 'B', villageDid: 2, targets: [{ x: 0, y: 1 }] }] };
  const inst = PVE.buildInstance(data, { units: UNITS.huns, selectedSlots: ['t6'], includedDids: [1, 2],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 60, artefact: 1 }, 2: { ts: 0, interval: 60, artefact: 1 } } });
  const r = PVE.solve(inst, {});
  const forOasis = PVE.planDiff(data, inst, r).filter(x => x.x === 0 && x.y === 1);
  const keeps = forOasis.filter(x => x.status === 'keep' || x.status === 'move');
  const rems = forOasis.filter(x => x.status === 'remove');
  assert.strictEqual(keeps.length, 1, 'exactly one keep/move');
  assert.strictEqual(rems.length, 1, 'exactly one remove for the other holder');
  keeps.forEach(k => assert(k.toVillage !== k.fromVillage, 'no X→X no-op'));
});
t('distance is a non-rounded float', () => {
  const d = PVE.distance(0, 0, 1, 2, 200); // sqrt(5) ≈ 2.236…
  approx(d, Math.sqrt(5));
  assert(d !== Math.round(d), 'kept as float (matches in-game ETA precision)');
});
t('plan rows carry village dids (so the UI groups by did, not the collidable name)', () => {
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'Dup', x: 0, y: 0, troops: { t6: 100 } },   // SAME name…
               { did: 2, name: 'Dup', x: 1, y: 0, troops: { t6: 100 } }],  // …different did
    oases: [{ x: 0, y: 1, bonuses: [{ res: 'crop', pct: 25 }] }],
    farmLists: [{ listId: 1, name: 'L', villageDid: 2, targets: [{ x: 0, y: 1 }] }] };
  const inst = PVE.buildInstance(data, { units: UNITS.huns, selectedSlots: ['t6'], includedDids: [1, 2],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 60, artefact: 1 }, 2: { ts: 0, interval: 60, artefact: 1 } } });
  const rows = PVE.planDiff(data, inst, PVE.solve(inst, {}), []);
  rows.forEach(row => {
    if (row.toVillage != null) assert(typeof row.toDid === 'number', 'toDid present when toVillage set');
    if (row.fromVillage != null) assert(typeof row.fromDid === 'number', 'fromDid present when fromVillage set');
  });
  assert(rows.some(x => [1, 2].indexOf(x.toDid) >= 0 || [1, 2].indexOf(x.fromDid) >= 0), 'rows reference real dids');
});

console.log('skip (global opt-out)');
t('skipped oasis is dropped from the candidate set (never assigned)', () => {
  const data = { mapRadius: 200, villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 100 } }],
    oases: [{ x: 1, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }, { x: 2, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }],
    farmLists: [] };
  const base = PVE.buildInstance(data, { units: UNITS.huns, selectedSlots: ['t6'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 60, artefact: 1 } } });
  assert.strictEqual(base.oases.length, 2, 'both oases candidates without a skip');
  const skip = PVE.buildInstance(data, { units: UNITS.huns, selectedSlots: ['t6'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 60, artefact: 1 } }, skipped: ['1|0'] });
  assert.strictEqual(skip.oases.length, 1, 'skipped tile removed from candidates');
  assert(skip.oases.every(o => !(o.x === 1 && o.y === 0)), 'skipped oasis absent');
  assert(skip.maxPossible <= 1, 'skipped oasis not counted as reachable');
});
t('currently-farmed skipped oasis -> remove with reason "skipped"', () => {
  const data = { mapRadius: 200, villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 100 } }],
    oases: [{ x: 1, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }],
    farmLists: [{ listId: 1, name: 'A', villageDid: 1, targets: [{ x: 1, y: 0 }] }] };
  const inst = PVE.buildInstance(data, { units: UNITS.huns, selectedSlots: ['t6'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 60, artefact: 1 } }, skipped: ['1|0'] });
  const r = PVE.solve(inst, {});
  const rows = PVE.planDiff(data, inst, r, ['1|0']);
  const rem = rows.find(x => x.status === 'remove' && x.x === 1 && x.y === 0);
  assert(rem && rem.reason === 'skipped', 'tagged skipped, not resource-filter');
});
t('oases at the same tile are deduped in buildInstance', () => {
  const data = { mapRadius: 200, villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 100 } }],
    oases: [{ x: 1, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }, { x: 1, y: 0, bonuses: [{ res: 'crop', pct: 50 }] }],
    farmLists: [] };
  const inst = PVE.buildInstance(data, { units: UNITS.huns, selectedSlots: ['t6'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 60, artefact: 1 } } });
  assert.strictEqual(inst.oases.length, 1, 'duplicate tile collapsed');
});

console.log('no reachability cap (ADR-0002 — removed travel-cap bolt-on)');
t('far-but-affordable pairs stay candidates; a legacy maxTravelMin key is ignored', () => {
  // Marauder base14 -> 28 f/h. Oasis at 28 fields = 60 min one-way; at 1 field ≈ 2.14 min.
  const data = { mapRadius: 200, villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t4: 1000 } }],
    oases: [{ x: 1, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }, { x: 28, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }],
    farmLists: [] };
  const cfg = { units: UNITS.huns, selectedSlots: ['t4'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 5, artefact: 1 } } };
  assert.strictEqual(PVE.buildInstance(data, cfg).maxPossible, 2, 'both reachable');
  const legacy = PVE.buildInstance(data, Object.assign({}, cfg, { maxTravelMin: 30 })); // stale persisted config
  assert.strictEqual(legacy.maxPossible, 2, 'legacy cap key has no effect');
});
t('unaffordable current target -> remove with reason "unaffordable (cost exceeds every budget)"', () => {
  // 5 fields ≈ 9.4 min travel, cost 4 > budget 1.
  const data = { mapRadius: 200, villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t4: 1 } }],
    oases: [{ x: 5, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }],
    farmLists: [{ listId: 1, name: 'A', villageDid: 1, targets: [{ x: 5, y: 0 }] }] };
  const inst = PVE.buildInstance(data, { units: UNITS.huns, selectedSlots: ['t4'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 5, artefact: 1 } } });
  assert.strictEqual(inst.pairs.length, 0, 'no feasible pair (budget too small)');
  const rem = PVE.planDiff(data, inst, PVE.solve(inst, {}), [])
    .find(x => x.status === 'remove' && x.x === 5 && x.y === 0);
  assert(rem && /unaffordable \(cost exceeds every budget\)/.test(rem.reason),
    'unaffordable reason, got: ' + (rem && rem.reason));
});

console.log('ILP timeout safety net');
let realSolver = null;
try { realSolver = require('javascript-lp-solver'); } catch (e) { /* optional dep */ }
if (realSolver) {
  t('solveExact accepts a timeout and still solves a tiny instance exactly (real jsLPSolver)', () => {
    const data = { mapRadius: 200,
      villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 2 } }],
      oases: [{ x: 1, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }, { x: 0, y: 1, bonuses: [{ res: 'crop', pct: 25 }] },
              { x: 2, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }],
      farmLists: [] };
    const inst = PVE.buildInstance(data, { units: UNITS.huns, selectedSlots: ['t6'], includedDids: [1],
      resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 60, artefact: 1 } } });
    const r = PVE.solveExact(inst, realSolver, 5000);
    assert(r && r.count >= 1, 'solved with timeout set');
    inst.villages.forEach((v, vi) => assert(r.used[vi] <= v.budget, 'within budget'));
  });
} else {
  tskip('solveExact with real jsLPSolver', 'javascript-lp-solver not installed — run NODE_PATH=<dir with it> node test.js');
}
t('solve() labels a completed, accepted ILP run "exact ILP" and optimal', () => {
  // same separating instance as the greedyPairs test: bestGreedy = 4 < maxPossible 5, so the ILP
  // path runs; a fake solver returns a correct count-4 integral solution well within the timeout.
  const inst = {
    villages: [{ did: 1, name: 'V1', budget: 1 }, { did: 2, name: 'V2', budget: 4 }],
    oases: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }],
    pairs: [
      { oi: 0, vi: 0, cost: 1, dist: 1, travelMin: 1 }, { oi: 0, vi: 1, cost: 3, dist: 3, travelMin: 3 },
      { oi: 1, vi: 0, cost: 1, dist: 1, travelMin: 1 }, { oi: 1, vi: 1, cost: 3, dist: 3, travelMin: 3 },
      { oi: 2, vi: 1, cost: 1, dist: 1, travelMin: 1 },
      { oi: 3, vi: 1, cost: 1, dist: 1, travelMin: 1 },
      { oi: 4, vi: 1, cost: 1, dist: 1, travelMin: 1 }
    ],
    maxPossible: 5
  };
  const fakeExact = { Solve(model) {
    assert(model.timeout > 0, 'timeout forwarded to the model');
    return { feasible: true, x0: 1, x4: 1, x5: 1, x6: 1 }; // A1->V1, B/C/D->V2 (count 4, optimal)
  } };
  const r = PVE.solve(inst, { solver: fakeExact, exactTimeoutMs: 10000 });
  assert.strictEqual(r.method, 'exact ILP (jsLPSolver)', 'happy-path label, got: ' + r.method);
  assert.strictEqual(r.optimal, true, 'flagged optimal');
  assert.strictEqual(r.count, 4);
  r.used.forEach((u, vi) => assert(u <= inst.villages[vi].budget, 'within budget'));
});
t('solve() labels a timed-out ILP as not provably optimal', () => {
  // fake solver: burns past the deadline, returns a feasible 1-assignment incumbent
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 1 } }],
    oases: [{ x: 1, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }, { x: 0, y: 1, bonuses: [{ res: 'crop', pct: 25 }] }],
    farmLists: [] };
  const inst = PVE.buildInstance(data, { units: UNITS.huns, selectedSlots: ['t6'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 60, artefact: 1 } } });
  assert(inst.maxPossible > 1, 'choice exists (so greedy is not auto-optimal)');
  const slowSolver = { Solve(model) {
    const deadline = Date.now() + (model.timeout || 0);
    while (Date.now() < deadline) { /* spin to the model.timeout deadline, like a real timeout */ }
    const res = { feasible: true };
    const firstVar = Object.keys(model.variables)[0];
    res[firstVar] = 1;
    return res;
  } };
  const r = PVE.solve(inst, { solver: slowSolver, exactTimeoutMs: 30 });
  assert.strictEqual(r.optimal, false, 'timed-out result not flagged optimal');
  // the incumbent ties greedy (count 1, movements 1), so it must surface as TIMEBOXED specifically
  assert(/timeboxed/.test(r.method), 'method pins the timeboxed branch, got: ' + r.method);
});

t('solveExact rejects a budget-violating (fractional-relaxation) solver result', () => {
  // 2 oases cost 1 each, budget 1 — a leaked LP relaxation marks BOTH x vars ~1 (sum 2 > budget).
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 1 } }],
    oases: [{ x: 1, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }, { x: 0, y: 1, bonuses: [{ res: 'crop', pct: 25 }] }],
    farmLists: [] };
  const inst = PVE.buildInstance(data, { units: UNITS.huns, selectedSlots: ['t6'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 60, artefact: 1 } } });
  const leakySolver = { Solve(model) {
    const res = { feasible: true }; // fractional relaxation leaked at timeout: every var ≈ 0.99
    Object.keys(model.variables).forEach(k => { res[k] = 0.99; });
    return res;
  } };
  assert.strictEqual(PVE.solveExact(inst, leakySolver, 1000), null, 'infeasible plan rejected');
  const r = PVE.solve(inst, { solver: leakySolver, exactTimeoutMs: 1000 });
  assert(/greedy/.test(r.method), 'solve falls back to greedy, got: ' + r.method);
  inst.villages.forEach((v, vi) => assert(r.used[vi] <= v.budget, 'fallback within budget'));
});

console.log('best-of-two greedy (global cheapest-pair packing)');
t('greedyPairs avoids the budget-burn cascade; solve() takes the better construction', () => {
  // A1,A2 are cheap at V1 (budget 1) with an expensive V2 fallback; B,C,D are cheap-only at V2.
  // Per-oasis greedy: A1->V1, then A2 burns 3 of V2's 4 budget -> only one of B/C/D fits (count 3).
  // Pair packing: every cost-1 pair first -> A1->V1, B,C,D->V2; A2's cost-3 pair no longer fits (count 4).
  const inst = {
    villages: [{ did: 1, name: 'V1', budget: 1 }, { did: 2, name: 'V2', budget: 4 }],
    oases: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }],
    pairs: [
      { oi: 0, vi: 0, cost: 1, dist: 1, travelMin: 1 }, { oi: 0, vi: 1, cost: 3, dist: 3, travelMin: 3 },
      { oi: 1, vi: 0, cost: 1, dist: 1, travelMin: 1 }, { oi: 1, vi: 1, cost: 3, dist: 3, travelMin: 3 },
      { oi: 2, vi: 1, cost: 1, dist: 1, travelMin: 1 },
      { oi: 3, vi: 1, cost: 1, dist: 1, travelMin: 1 },
      { oi: 4, vi: 1, cost: 1, dist: 1, travelMin: 1 }
    ],
    maxPossible: 5
  };
  assert.strictEqual(PVE.greedy(inst).count, 3, 'per-oasis greedy strands two oases');
  const gp = PVE.greedyPairs(inst);
  assert.strictEqual(gp.count, 4, 'pair packing places four');
  gp.used.forEach((u, vi) => assert(u <= inst.villages[vi].budget, 'pair packing within budget'));
  const r = PVE.solve(inst, {});
  assert.strictEqual(r.count, 4, 'solve() returns the better of the two constructions');
});
t('bestGreedy tie-break: equal count, strictly fewer movements wins', () => {
  // greedy: A1->V1, A2 falls back to V2 at cost 3 (V2 left with 0), B stranded -> count 2, movements 4.
  // pairs:  A1->V1, B->V2 at cost 1, A2's cost-3 pair no longer fits      -> count 2, movements 2.
  const inst = {
    villages: [{ did: 1, name: 'V1', budget: 1 }, { did: 2, name: 'V2', budget: 3 }],
    oases: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    pairs: [
      { oi: 0, vi: 0, cost: 1, dist: 1, travelMin: 1 }, { oi: 0, vi: 1, cost: 3, dist: 3, travelMin: 3 },
      { oi: 1, vi: 0, cost: 1, dist: 1, travelMin: 1 }, { oi: 1, vi: 1, cost: 3, dist: 3, travelMin: 3 },
      { oi: 2, vi: 1, cost: 1, dist: 1, travelMin: 1 }
    ],
    maxPossible: 3
  };
  const a = PVE.greedy(inst), b = PVE.greedyPairs(inst), best = PVE.bestGreedy(inst);
  assert.strictEqual(a.count, 2); assert.strictEqual(a.movements, 4);
  assert.strictEqual(b.count, 2); assert.strictEqual(b.movements, 2);
  assert.strictEqual(best.movements, 2, 'tie on count broken to the cheaper packing');
});
t('bestGreedy never returns the worse construction (and ties break to fewer movements)', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-data.json')));
  const inst = PVE.buildInstance(data, {
    units: UNITS.huns, selectedSlots: ['t4','t5','t6'],
    includedDids: data.villages.map(v => v.did),
    resourceFilter: { wood: true, clay: true, iron: true, crop: true },
    perVillage: { 1001: { ts: 10, interval: 5, artefact: 1 },
                  1004: { ts: 8, interval: 5, artefact: 1 },
                  1006: { ts: 8, interval: 5, artefact: 1 } }
  });
  const a = PVE.greedy(inst), b = PVE.greedyPairs(inst), best = PVE.bestGreedy(inst);
  assert(best.count >= a.count && best.count >= b.count, 'best-of-both count');
  if (best.count === a.count && best.count === b.count) {
    assert(best.movements <= Math.min(a.movements, b.movements), 'tie broken to fewer movements');
  }
});

console.log('oasis browser');
t('band is inclusive on the float distance; rows sorted nearest-first', () => {
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: {} }],
    oases: [ { x: 3, y: 4, bonuses: [{res:'crop',pct:50}] },   // dist exactly 5 (max bound)
             { x: 0, y: 2, bonuses: [{res:'wood',pct:25}] },   // dist exactly 2 (min bound)
             { x: 0, y: 6, bonuses: [{res:'iron',pct:25}] },   // dist 6 — outside band
             { x: 1, y: 0, bonuses: [{res:'clay',pct:25}] } ], // dist 1 — outside band
    farmLists: [] };
  const rows = PVE.browseOases(data, { did: 1, minDist: 2, maxDist: 5,
    resourceFilter: { wood: true, clay: true, iron: true, crop: true } });
  assert.deepStrictEqual(rows.map(r => [r.x, r.y]), [[0, 2], [3, 4]]); // both bounds inclusive, sorted
  approx(rows[0].dist, 2); approx(rows[1].dist, 5);
});
t('browser distance is torus-wrapped like everything else', () => {
  const data = { mapRadius: 200, villages: [{ did: 1, name: 'A', x: 200, y: 0, troops: {} }],
    oases: [{ x: -200, y: 0, bonuses: [{res:'crop',pct:25}] }], farmLists: [] };
  const rows = PVE.browseOases(data, { did: 1, minDist: 0, maxDist: 30 });
  assert.strictEqual(rows.length, 1);
  approx(rows[0].dist, 1); // 1 field across the wrap, not 400
});
t('browser filter uses the optimizer\'s primary-bucket rule (clay+crop hidden when only crop on)', () => {
  const data = { mapRadius: 200, villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: {} }],
    oases: [ { x: 1, y: 0, bonuses: [{res:'clay',pct:25},{res:'crop',pct:25}] },  // buckets clay
             { x: 2, y: 0, bonuses: [{res:'crop',pct:50}] } ], farmLists: [] };
  const rows = PVE.browseOases(data, { did: 1,
    resourceFilter: { wood: false, clay: false, iron: false, crop: true } });
  assert.deepStrictEqual(rows.map(r => [r.x, r.y]), [[2, 0]]);
});
t('rows carry current farm-list membership; unknown village -> []', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-data.json')));
  const rows = PVE.browseOases(data, { did: 1001, minDist: 0, maxDist: 30 }); // A001 (-18,-93)
  assert(rows.length > 0, 'has rows');
  for (let i = 1; i < rows.length; i++) assert(rows[i - 1].dist <= rows[i].dist, 'sorted by distance');
  const listed = rows.find(r => r.x === -8 && r.y === -116);
  assert(listed && listed.farmLists.some(l => l.name === 'A001 oases'), 'membership shown');
  const free = rows.find(r => r.x === -19 && r.y === -89);
  assert(free && free.farmLists.length === 0, 'unlisted oasis has no membership');
  assert.deepStrictEqual(PVE.browseOases(data, { did: 99999 }), []);
});
t('duplicate tiles deduped; defaults: min 0, max unbounded, all resources', () => {
  const data = { mapRadius: 200, villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: {} }],
    oases: [ { x: 1, y: 0, bonuses: [{res:'crop',pct:25}] }, { x: 1, y: 0, bonuses: [{res:'crop',pct:50}] },
             { x: 150, y: 0, bonuses: [{res:'wood',pct:25}] } ], farmLists: [] };
  const rows = PVE.browseOases(data, { did: 1 });
  assert.strictEqual(rows.length, 2); // dup tile collapsed; far oasis included (no max)
  assert.strictEqual(PVE.browseOases(data, { did: 1, maxDist: -5 }).length, 2);      // negative max = invalid = no cap
  assert.strictEqual(PVE.browseOases(data, { did: 1, maxDist: Infinity }).length, 2); // explicit Infinity = no cap
});
t('membership: per-list duplicate target counted once; two lists on one tile both shown', () => {
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: {} }, { did: 2, name: 'B', x: 5, y: 0, troops: {} }],
    oases: [{ x: 1, y: 0, bonuses: [{res:'crop',pct:25}] }],
    farmLists: [
      { listId: 1, name: 'L1', villageDid: 1, targets: [{ x: 1, y: 0 }, { x: 1, y: 0 }] }, // same tile twice
      { listId: 2, name: 'L2', villageName: 'B', villageDid: 2, targets: [{ x: 1, y: 0 }] } ] };
  const rows = PVE.browseOases(data, { did: 1 });
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0].farmLists.map(l => l.name).sort(), ['L1', 'L2']); // dup once; both lists kept
  assert.strictEqual(rows[0].farmLists.find(l => l.name === 'L1').village, 'A');   // village resolved via villageDid
});

console.log('pvp rebalancer — comp speed & instance classification');
t('compSpeed = slowest unit in the send, infantry included; empty comp -> null', () => {
  assert.strictEqual(PVE.compSpeed({ t4: 10 }, UNITS.huns), 16);            // Steppe Rider
  assert.strictEqual(PVE.compSpeed({ t4: 10, t6: 1 }, UNITS.huns), 14);     // Marauder slower
  assert.strictEqual(PVE.compSpeed({ t4: 10, t1: 20 }, UNITS.huns), 6);     // Mercenary (infantry!) sets speed
  assert.strictEqual(PVE.compSpeed({}, UNITS.huns), null);
  assert.strictEqual(PVE.compSpeed(null, UNITS.huns), null);
  assert.strictEqual(PVE.compSpeed({ t4: 0 }, UNITS.huns), null, 'zero-count slot does not count');
});
t('pvp farm = list entry whose target is NOT a free oasis; free-oasis targets excluded', () => {
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 100 } }],
    oases: [{ x: 1, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }],
    farmLists: [{ listId: 1, name: 'L', villageDid: 1, targets: [
      { x: 1, y: 0, comp: { t6: 5 } },   // free oasis -> NOT a pvp farm
      { x: 2, y: 0, comp: { t6: 5 } },   // player village / occupied -> pvp farm
    ] }] };
  const inst = PVE.buildPvpInstance(data, { units: UNITS.huns, pvpDids: [1],
    perVillage: { 1: { ts: 0, interval: 60, artefact: 1 } } });
  assert.strictEqual(inst.farms.length, 1);
  assert.strictEqual(inst.farms[0].x, 2);
  assert.strictEqual(inst.farms[0].curDid, 1);
});
t('exclusions are reported, never silently dropped: unresolved / frozen / noComp', () => {
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 100 } },
               { did: 2, name: 'B', x: 5, y: 0, troops: { t6: 100 } }],
    oases: [],
    farmLists: [
      { listId: 1, name: 'orphan', villageDid: null, targets: [{ x: 9, y: 9, comp: { t6: 5 } }] },     // unresolved
      { listId: 2, name: 'pveheld', villageDid: 2, targets: [{ x: 8, y: 8, comp: { t6: 5 } }] },        // holder not Role-PvP
      { listId: 3, name: 'mine', villageDid: 1, targets: [{ x: 7, y: 7 }, { x: 6, y: 6, comp: {} }] },  // no comp ×2
    ] };
  const inst = PVE.buildPvpInstance(data, { units: UNITS.huns, pvpDids: [1],
    perVillage: { 1: { ts: 0, interval: 60, artefact: 1 } } });
  assert.strictEqual(inst.farms.length, 0, 'nothing rebalanceable');
  assert.strictEqual(inst.excluded.unresolved, 1);
  assert.strictEqual(inst.excluded.frozen.length, 1);
  assert.strictEqual(inst.excluded.frozen[0].listName, 'pveheld');
  assert.strictEqual(inst.excluded.noComp.length, 2);
});
t('duplicate targets across lists are independent farms (double-farming intentional)', () => {
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 100 } },
               { did: 2, name: 'B', x: 5, y: 0, troops: { t6: 100 } }],
    oases: [],
    farmLists: [
      { listId: 1, name: 'LA', villageDid: 1, targets: [{ x: 3, y: 0, comp: { t6: 5 } }] },
      { listId: 2, name: 'LB', villageDid: 2, targets: [{ x: 3, y: 0, comp: { t4: 10 } }] } ] };
  const inst = PVE.buildPvpInstance(data, { units: UNITS.huns, pvpDids: [1, 2],
    perVillage: { 1: { ts: 0, interval: 60, artefact: 1 }, 2: { ts: 0, interval: 60, artefact: 1 } } });
  assert.strictEqual(inst.farms.length, 2, 'both entries kept');
  const r = PVE.pvpRebalance(inst, {});
  assert.strictEqual(r.rows.length, 2, 'both entries in the result');
});

console.log('pvp rebalancer — overload repair (the motivating example)');
t('overloaded village spills to the village with slack; nearest-to-receiver moves first', () => {
  // A holds two farms costing 8 Marauders each but stocks only 10; B (at x=10) has 100 free.
  // Interval 60 min keeps waves at 1 (travel ≤ ~20 min), so demand = comp.
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 10 } },
               { did: 2, name: 'B', x: 10, y: 0, troops: { t6: 100 } }],
    oases: [],
    farmLists: [{ listId: 1, name: 'LA', villageDid: 1, targets: [
      { x: 1, y: 0, comp: { t6: 8 } },    // close to A
      { x: 9, y: 0, comp: { t6: 8 } },    // close to B — this one should move
    ] }] };
  const inst = PVE.buildPvpInstance(data, { units: UNITS.huns, pvpDids: [1, 2],
    perVillage: { 1: { ts: 0, interval: 60, artefact: 1 }, 2: { ts: 0, interval: 60, artefact: 1 } } });
  const r = PVE.pvpRebalance(inst, {});
  const f1 = r.rows.find(x => x.x === 1), f9 = r.rows.find(x => x.x === 9);
  assert.strictEqual(f9.status, 'move', 'farm nearest the receiver moves');
  assert.strictEqual(f9.toDid, 2);
  assert.strictEqual(f1.status, 'keep', 'the close farm stays home');
  assert.strictEqual(r.shortfalls.length, 0, 'overload fully repaired');
  assert.strictEqual(r.moves, 1, 'exactly one move — no churn');
});
t('soft keep, hard move: an unfixable overload stays put and reports a per-type shortfall', () => {
  // A stocks 5 Marauders, farm needs 8; B exists but stocks only 7 -> move would overload B, forbidden.
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 5 } },
               { did: 2, name: 'B', x: 2, y: 0, troops: { t6: 7 } }],
    oases: [],
    farmLists: [{ listId: 1, name: 'LA', villageDid: 1, targets: [{ x: 1, y: 0, comp: { t6: 8 } }] }] };
  const inst = PVE.buildPvpInstance(data, { units: UNITS.huns, pvpDids: [1, 2],
    perVillage: { 1: { ts: 0, interval: 60, artefact: 1 }, 2: { ts: 0, interval: 60, artefact: 1 } } });
  const r = PVE.pvpRebalance(inst, {});
  assert.strictEqual(r.rows[0].status, 'keep', 'farm stays with its over-committed holder');
  assert.strictEqual(r.shortfalls.length, 1);
  assert.strictEqual(r.shortfalls[0].did, 1);
  assert.strictEqual(r.shortfalls[0].slot, 't6');
  assert.strictEqual(r.shortfalls[0].short, 3, '8 used - 5 stock');
});
t('multi-type sends need EVERY type in stock at the destination', () => {
  // Farm sends Steppe Riders + Mercenaries. B has riders but no infantry -> cannot receive.
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t4: 5, t1: 5 } },
               { did: 2, name: 'B', x: 2, y: 0, troops: { t4: 100, t1: 0 } }],
    oases: [],
    farmLists: [{ listId: 1, name: 'LA', villageDid: 1, targets: [{ x: 1, y: 0, comp: { t4: 10, t1: 10 } }] }] };
  const inst = PVE.buildPvpInstance(data, { units: UNITS.huns, pvpDids: [1, 2],
    perVillage: { 1: { ts: 0, interval: 60, artefact: 1 }, 2: { ts: 0, interval: 60, artefact: 1 } } });
  assert.strictEqual(inst.farms[0].speed, 6, 'infantry sets the speed');
  const r = PVE.pvpRebalance(inst, {});
  assert.strictEqual(r.rows[0].status, 'keep', 'B cannot absorb the infantry component');
  assert(r.shortfalls.some(s => s.did === 1 && s.slot === 't4' && s.short === 5), 't4 shortfall reported');
  assert(r.shortfalls.some(s => s.did === 1 && s.slot === 't1' && s.short === 5), 't1 shortfall reported');
});
t('demand scales with waves in flight: farther holder ties up comp × ceil(2·travel/interval)', () => {
  // Marauders 28 f/h. Farm at 28 fields from A = 60 min one-way; interval 30 min -> 4 waves.
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 1000 } }],
    oases: [],
    farmLists: [{ listId: 1, name: 'LA', villageDid: 1, targets: [{ x: 28, y: 0, comp: { t6: 5 } }] }] };
  const inst = PVE.buildPvpInstance(data, { units: UNITS.huns, pvpDids: [1],
    perVillage: { 1: { ts: 0, interval: 30, artefact: 1 } } });
  const r = PVE.pvpRebalance(inst, {});
  assert.strictEqual(r.rows[0].waves, 4, 'ceil(120/30)');
  assert.strictEqual(r.usage[0].perSlot.t6.used, 20, '5 Marauders × 4 waves');
  assert.strictEqual(r.movements, 4, 'movements = Σ waves');
});

console.log('pvp rebalancer — keep-biased improvement');
t('feasible-but-bad layout improves: cluster moves to the idle village next door', () => {
  // A (within budget) farms a cluster ~25 fields away that sits next to B, which idles.
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 1000 } },
               { did: 2, name: 'B', x: 25, y: 0, troops: { t6: 1000 } }],
    oases: [],
    farmLists: [{ listId: 1, name: 'LA', villageDid: 1, targets: [
      { x: 24, y: 0, comp: { t6: 5 } }, { x: 26, y: 0, comp: { t6: 5 } }, { x: 25, y: 1, comp: { t6: 5 } },
    ] }] };
  const inst = PVE.buildPvpInstance(data, { units: UNITS.huns, pvpDids: [1, 2],
    perVillage: { 1: { ts: 0, interval: 60, artefact: 1 }, 2: { ts: 0, interval: 60, artefact: 1 } } });
  const r = PVE.pvpRebalance(inst, {});
  assert.strictEqual(r.moves, 3, 'whole cluster reassigned');
  r.rows.forEach(x => assert.strictEqual(x.toDid, 2, 'all to B'));
});
t('keep bias: a move under the tolerance does not happen; over it, it does', () => {
  // Farm at dist 3 from A, dist 1 from B -> 2 fields ≈ 4.29 min saving at Marauder speed.
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 1000 } },
               { did: 2, name: 'B', x: 4, y: 0, troops: { t6: 1000 } }],
    oases: [],
    farmLists: [{ listId: 1, name: 'LA', villageDid: 1, targets: [{ x: 3, y: 0, comp: { t6: 5 } }] }] };
  const inst = PVE.buildPvpInstance(data, { units: UNITS.huns, pvpDids: [1, 2],
    perVillage: { 1: { ts: 0, interval: 60, artefact: 1 }, 2: { ts: 0, interval: 60, artefact: 1 } } });
  const stay = PVE.pvpRebalance(inst, { toleranceMin: 5 });
  assert.strictEqual(stay.rows[0].status, 'keep', '4.29 min saving < 5 min tolerance');
  const go = PVE.pvpRebalance(inst, { toleranceMin: 1 });
  assert.strictEqual(go.rows[0].status, 'move', '4.29 min saving ≥ 1 min tolerance');
  assert.strictEqual(go.rows[0].toDid, 2);
  approx(go.rows[0].travelCur - go.rows[0].travelNew, PVE.travelMinutes(3, 14, 1, 0) - PVE.travelMinutes(1, 14, 1, 0));
});
t('a move never creates or worsens a shortfall (fits is checked on every slot)', () => {
  // B is closer to the farm but already saturated by its own farm.
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 100 } },
               { did: 2, name: 'B', x: 10, y: 0, troops: { t6: 10 } }],
    oases: [],
    farmLists: [
      { listId: 1, name: 'LA', villageDid: 1, targets: [{ x: 9, y: 0, comp: { t6: 8 } }] },
      { listId: 2, name: 'LB', villageDid: 2, targets: [{ x: 11, y: 0, comp: { t6: 8 } }] } ] };
  const inst = PVE.buildPvpInstance(data, { units: UNITS.huns, pvpDids: [1, 2],
    perVillage: { 1: { ts: 0, interval: 60, artefact: 1 }, 2: { ts: 0, interval: 60, artefact: 1 } } });
  const r = PVE.pvpRebalance(inst, {});
  const mine = r.rows.find(x => x.listName === 'LA');
  assert.strictEqual(mine.status, 'keep', 'B (8+8 > 10) must not receive');
  assert.strictEqual(r.shortfalls.length, 0, 'no shortfall anywhere');
  // every village ends within stock on every slot it uses
  r.usage.forEach(u => Object.keys(u.perSlot).forEach(s => assert(u.perSlot[s].used <= u.perSlot[s].stock)));
});

console.log('pvp rebalancer — review fixes');
t('phases alternate to a joint fixpoint: a Phase B move frees the capacity a stuck repair needed', () => {
  // A (stock 0) holds f needing 8; B (stock 10) holds g needing 5; C (stock 5) idles far away.
  // Round 1: f fits nowhere (B free 5 < 8, C 5 < 8) — stuck; B's own farm g sits beside C and
  // moves there (big saving). Round 2: B now has 10 free -> f's repair move A->B becomes legal.
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 0 } },
               { did: 2, name: 'B', x: 6, y: 0, troops: { t6: 10 } },
               { did: 3, name: 'C', x: 20, y: 0, troops: { t6: 5 } }],
    oases: [],
    farmLists: [
      { listId: 1, name: 'LA', villageDid: 1, targets: [{ x: 1, y: 0, comp: { t6: 8 } }] },
      { listId: 2, name: 'LB', villageDid: 2, targets: [{ x: 19, y: 0, comp: { t6: 5 } }] } ] };
  const inst = PVE.buildPvpInstance(data, { units: UNITS.huns, pvpDids: [1, 2, 3],
    perVillage: { 1: { ts: 0, interval: 600, artefact: 1 }, 2: { ts: 0, interval: 600, artefact: 1 }, 3: { ts: 0, interval: 600, artefact: 1 } } });
  const r = PVE.pvpRebalance(inst, {});
  const f = r.rows.find(x => x.listName === 'LA'), g = r.rows.find(x => x.listName === 'LB');
  assert.strictEqual(g.status, 'move'); assert.strictEqual(g.toDid, 3, 'g moves beside C');
  assert.strictEqual(f.status, 'move'); assert.strictEqual(f.toDid, 2, 'freed B absorbs the stuck farm');
  assert.strictEqual(r.shortfalls.length, 0, 'overload fully repaired across rounds');
});
t('unknown comp slots (e.g. an imported t11 hero) are sanitized out, not budgeted against zero stock', () => {
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 5 } },
               { did: 2, name: 'B', x: 10, y: 0, troops: { t6: 100 } }],
    oases: [],
    farmLists: [
      { listId: 1, name: 'LA', villageDid: 1, targets: [{ x: 9, y: 0, comp: { t6: 8, t11: 1 } }] },
      { listId: 2, name: 'LH', villageDid: 1, targets: [{ x: 2, y: 0, comp: { t11: 1 } }] } ] };
  const inst = PVE.buildPvpInstance(data, { units: UNITS.huns, pvpDids: [1, 2],
    perVillage: { 1: { ts: 0, interval: 60, artefact: 1 }, 2: { ts: 0, interval: 60, artefact: 1 } } });
  assert.strictEqual(inst.farms.length, 1, 'mixed comp kept (t11 stripped)');
  assert.deepStrictEqual(inst.farms[0].comp, { t6: 8 }, 't11 gone from the comp');
  assert.strictEqual(inst.excluded.noComp.length, 1, 'unknown-slot-only comp degrades to noComp');
  const r = PVE.pvpRebalance(inst, {});
  assert.strictEqual(r.rows[0].status, 'move', 'farm is movable — no phantom t11 pin');
  assert(!r.shortfalls.some(s => s.slot === 't11'), 'no undisplayable phantom shortfall');
});
t('hero in a send is counted for the warning (never a silent drop)', () => {
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 100 } }],
    oases: [],
    farmLists: [{ listId: 1, name: 'LA', villageDid: 1, targets: [
      { x: 1, y: 0, comp: { t6: 8 }, hero: true },
      { x: 2, y: 0, comp: { t6: 8 } } ] }] };
  const inst = PVE.buildPvpInstance(data, { units: UNITS.huns, pvpDids: [1],
    perVillage: { 1: { ts: 0, interval: 60, artefact: 1 } } });
  assert.strictEqual(inst.heroDropped, 1);
});

console.log('role derivation (pure: farmKinds + deriveRole)');
t('farmKinds classifies per village against the scanned free-oasis set', () => {
  const data = {
    oases: [{ x: 1, y: 0, bonuses: [] }],
    farmLists: [
      { listId: 1, villageDid: 1, targets: [{ x: 1, y: 0 }] },              // oasis only
      { listId: 2, villageDid: 2, targets: [{ x: 9, y: 9 }] },              // pvp only
      { listId: 3, villageDid: 3, targets: [{ x: 1, y: 0 }, { x: 9, y: 9 }] }, // both
      { listId: 4, villageDid: null, targets: [{ x: 8, y: 8 }] } ] };       // unresolved -> ignored
  const k = PVE.farmKinds(data);
  assert.deepStrictEqual(k[1], { oasis: true, pvp: false });
  assert.deepStrictEqual(k[2], { oasis: false, pvp: true });
  assert.deepStrictEqual(k[3], { oasis: true, pvp: true });
  assert.strictEqual(k[4], undefined);
});
t('deriveRole: oasis->pve, pvp->pvp, both->pve; no evidence defers (returns null)', () => {
  assert.strictEqual(PVE.deriveRole({ oasis: true, pvp: false }, {}), 'pve');
  assert.strictEqual(PVE.deriveRole({ oasis: false, pvp: true }, {}), 'pvp');
  assert.strictEqual(PVE.deriveRole({ oasis: true, pvp: true }, {}), 'pve'); // + conflict chip in the UI
  assert.strictEqual(PVE.deriveRole(null, {}), null, 'no scan yet -> defer');
  assert.strictEqual(PVE.deriveRole({ oasis: false, pvp: false }, {}), null, 'no farms -> defer (display off, never store)');
});
t('deriveRole legacy inc:false: pvp if it holds PvP farms (even alongside oases), else off; defers without evidence', () => {
  assert.strictEqual(PVE.deriveRole({ oasis: false, pvp: true }, { inc: false }), 'pvp');
  assert.strictEqual(PVE.deriveRole({ oasis: true, pvp: true }, { inc: false }), 'pvp', 'both-kinds + opted out of pve -> pvp');
  assert.strictEqual(PVE.deriveRole({ oasis: true, pvp: false }, { inc: false }), 'off');
  assert.strictEqual(PVE.deriveRole(null, { inc: false }), null, 'legacy migration also waits for a scan');
  assert.strictEqual(PVE.deriveRole({ oasis: false, pvp: false }, { inc: false }), null, 'legacy + no visible farms -> defer');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed' + (skipped ? ', ' + skipped + ' skipped' : ''));
process.exit(fail ? 1 : 0);
