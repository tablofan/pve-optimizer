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

console.log('travel cap (max one-way travel)');
t('cap drops far-but-affordable pairs; no cap keeps them (back-compat)', () => {
  // Marauder base14 -> 28 f/h. Oasis at 28 fields = 60 min one-way; at 1 field ≈ 2.14 min.
  const data = { mapRadius: 200, villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t4: 1000 } }],
    oases: [{ x: 1, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }, { x: 28, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }],
    farmLists: [] };
  const cfg = { units: UNITS.huns, selectedSlots: ['t4'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 5, artefact: 1 } } };
  const noCap = PVE.buildInstance(data, cfg);
  assert.strictEqual(noCap.maxPossible, 2, 'both reachable without a cap');
  assert.strictEqual(noCap.maxTravelMin, null, 'no cap recorded');
  const capped = PVE.buildInstance(data, Object.assign({}, cfg, { maxTravelMin: 30 }));
  assert.strictEqual(capped.maxPossible, 1, 'far oasis pruned by the 30 min cap');
  assert(capped.pairs.every(p => p.travelMin <= 30), 'no pair beyond the cap');
  assert.strictEqual(capped.maxTravelMin, 30, 'cap recorded on the instance');
  const zero = PVE.buildInstance(data, Object.assign({}, cfg, { maxTravelMin: 0 }));
  assert.strictEqual(zero.maxPossible, 2, '0 = no cap');
});
t('currently-farmed oasis beyond the cap -> remove with reason "out of range"', () => {
  const data = { mapRadius: 200, villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t4: 1000 } }],
    oases: [{ x: 28, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }],
    farmLists: [{ listId: 1, name: 'A', villageDid: 1, targets: [{ x: 28, y: 0 }] }] };
  const inst = PVE.buildInstance(data, { units: UNITS.huns, selectedSlots: ['t4'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 5, artefact: 1 } }, maxTravelMin: 30 });
  const rows = PVE.planDiff(data, inst, PVE.solve(inst, {}), []);
  const rem = rows.find(x => x.status === 'remove' && x.x === 28 && x.y === 0);
  assert(rem && /out of range/.test(rem.reason), 'tagged out of range, got: ' + (rem && rem.reason));
  assert(/30 min/.test(rem.reason), 'reason names the cap');
});
t('budget-caused out-of-range does NOT blame the cap (even when a cap is set)', () => {
  // 5 fields ≈ 9.4 min travel — well inside the 30 min cap — but cost 4 > budget 1.
  const data = { mapRadius: 200, villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t4: 1 } }],
    oases: [{ x: 5, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }],
    farmLists: [{ listId: 1, name: 'A', villageDid: 1, targets: [{ x: 5, y: 0 }] }] };
  const cfg = { units: UNITS.huns, selectedSlots: ['t4'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 5, artefact: 1 } } };
  const capped = PVE.buildInstance(data, Object.assign({}, cfg, { maxTravelMin: 30 }));
  assert.strictEqual(capped.pairs.length, 0, 'no feasible pair (budget too small)');
  const remCap = PVE.planDiff(data, capped, PVE.solve(capped, {}), [])
    .find(x => x.status === 'remove' && x.x === 5 && x.y === 0);
  assert(remCap && /cost exceeds every budget/.test(remCap.reason),
    'budget blamed, not the cap — got: ' + (remCap && remCap.reason));
  // and the no-cap branch words it the same way
  const uncapped = PVE.buildInstance(data, cfg);
  const remNo = PVE.planDiff(data, uncapped, PVE.solve(uncapped, {}), [])
    .find(x => x.status === 'remove' && x.x === 5 && x.y === 0);
  assert(remNo && /cost exceeds every budget/.test(remNo.reason), 'no-cap branch, got: ' + (remNo && remNo.reason));
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

console.log('\n' + pass + ' passed, ' + fail + ' failed' + (skipped ? ', ' + skipped + ' skipped' : ''));
process.exit(fail ? 1 : 0);
