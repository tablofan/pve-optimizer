// PvE Optimizer — core logic (pure, no DOM). Loadable in the browser (window.PVE)
// and in Node (module.exports) so it can be unit-tested. See docs/PLAN.md + CONTEXT.md.

(function (root) {
  'use strict';

  // ── Geometry / travel ─────────────────────────────────────────────
  // Travian map wraps (torus). For coords in [-R..R] the axis size is 2R+1.
  function axisSize(radius) { return 2 * radius + 1; }

  function torusDelta(a, b, size) {
    var d = Math.abs(a - b);
    return Math.min(d, size - d);
  }

  function distance(ax, ay, bx, by, radius) {
    var s = axisSize(radius);
    var dx = torusDelta(ax, bx, s);
    var dy = torusDelta(ay, by, s);
    return Math.sqrt(dx * dx + dy * dy); // fields (kept as float for time precision)
  }

  // Travel time in MINUTES.
  //   spd = baseSpeed * 2 (speed-server) * artefact, in fields/hour
  //   first 20 fields at spd; the remainder at spd * (1 + 0.2*TS)  (TS only beyond 20 fields)
  //   no hero/boots (a rainbow carries no hero)
  function travelMinutes(dist, baseSpeed, artefact, ts) {
    var fph = baseSpeed * 2 * artefact;
    if (fph <= 0) return Infinity;
    var fpm = fph / 60;
    var first = Math.min(dist, 20);
    var rem = Math.max(dist - 20, 0);
    var tsFactor = 1 + 0.2 * ts;
    return first / fpm + rem / (fpm * tsFactor);
  }

  // Rainbows tied up by farming one oasis = round-trips in flight at steady state.
  function oasisCost(travelMin, intervalMin) {
    if (intervalMin <= 0) return Infinity;
    return Math.ceil((2 * travelMin) / intervalMin);
  }

  // ── Oasis typing ──────────────────────────────────────────────────
  var RES = ['wood', 'clay', 'iron', 'crop'];
  // Bucket an oasis to ONE resource by its primary (first non-crop) bonus.
  // e.g. clay+crop -> clay; crop-only -> crop.
  function primaryRes(bonuses) {
    if (!bonuses || !bonuses.length) return null;
    var nonCrop = bonuses.filter(function (b) { return b.res !== 'crop'; });
    var pick = (nonCrop.length ? nonCrop : bonuses)[0];
    return pick ? pick.res : null;
  }

  // ── Instance construction ─────────────────────────────────────────
  // data: { tribe, mapRadius, villages:[{did,name,x,y,troops:{tN:count}}],
  //         oases:[{x,y,bonuses:[{res,pct}]}], farmLists:[...] }
  // cfg:  { units, selectedSlots:[..], includedDids:Set/array, resourceFilter:{wood,..},
  //         perVillage:{did:{ts,interval,artefact}}, skipped:["x|y", …],
  //         maxTravelMin: number|null  — Travel cap: drop any (oasis,village) pair whose one-way
  //                                     travel exceeds this many minutes (null/0 = no cap) }
  // units = UNITS[tribe] (slot->unit array). Returns an instance for the solver.
  // `skipped` (a coord key set) removes those oases from every village's candidate set entirely —
  // they are never assigned (a Skipped oasis is a deliberate, global player opt-out). See CONTEXT.md.
  function skipLookup(skipped) {
    var m = {};
    (skipped || []).forEach(function (s) { m[typeof s === 'string' ? s : (s.x + '|' + s.y)] = true; });
    return m;
  }
  function buildInstance(data, cfg) {
    var unitsForTribe = cfg.units;
    var bySlot = {};
    unitsForTribe.forEach(function (u) { bySlot[u.slot] = u; });

    // cavalry with carry 0 (scouts) can never loot — not a farm-send candidate (see CONTEXT.md "Cavalry")
    var selected = cfg.selectedSlots.filter(function (s) { return bySlot[s] && bySlot[s].type === 'c' && bySlot[s].cap > 0; });
    // slowest selected unit drives speed (global — selection is global)
    var baseSpeed = Infinity;
    selected.forEach(function (s) { baseSpeed = Math.min(baseSpeed, bySlot[s].speed); });
    if (!isFinite(baseSpeed)) baseSpeed = 0;

    var included = {};
    (cfg.includedDids || []).forEach(function (d) { included[d] = true; });

    var villages = data.villages
      .filter(function (v) { return included[v.did]; })
      .map(function (v) {
        var counts = selected.map(function (s) { return (v.troops && v.troops[s]) || 0; });
        var budget = counts.length ? Math.min.apply(null, counts) : 0;
        var pv = (cfg.perVillage && cfg.perVillage[v.did]) || {};
        return {
          did: v.did, name: v.name, x: v.x, y: v.y,
          budget: budget,
          ts: pv.ts != null ? pv.ts : 0,
          interval: pv.interval != null ? pv.interval : 5,
          artefact: pv.artefact != null ? pv.artefact : 1
        };
      });

    var filter = cfg.resourceFilter || { wood: true, clay: true, iron: true, crop: true };
    var skipped = skipLookup(cfg.skipped);
    var oseen = {};
    var oases = data.oases
      .filter(function (o) { var k = o.x + '|' + o.y; if (oseen[k]) return false; oseen[k] = 1; return true; }) // dedupe by tile
      .filter(function (o) { return !skipped[o.x + '|' + o.y]; }) // drop Skipped oases (global opt-out)
      .map(function (o) { return { x: o.x, y: o.y, bonuses: o.bonuses, res: primaryRes(o.bonuses) }; })
      .filter(function (o) { return o.res && filter[o.res]; });

    // Feasible (oasis,village) pairs with rainbow cost. The Travel cap prunes pairs whose
    // one-way travel exceeds maxTravelMin BEFORE solving — without it, a long interval makes
    // the whole map "affordable" for a big village and the solver happily assigns 200-field
    // farms (and the pair count explodes past what the exact ILP can handle).
    var cap = (cfg.maxTravelMin && cfg.maxTravelMin > 0) ? cfg.maxTravelMin : null;
    var pairs = [];
    var capBlocked = {}; // oi -> true if some village would take it but-for the cap (for honest diff reasons)
    var radius = data.mapRadius != null ? data.mapRadius : 200;
    oases.forEach(function (o, oi) {
      villages.forEach(function (v, vi) {
        if (v.budget <= 0) return;
        var dist = distance(o.x, o.y, v.x, v.y, radius);
        var tmin = travelMinutes(dist, baseSpeed, v.artefact, v.ts);
        var cost = oasisCost(tmin, v.interval);
        if (!(cost <= v.budget && isFinite(cost))) return; // unaffordable regardless of the cap
        if (cap && tmin > cap) { capBlocked[oi] = true; return; } // affordable, but beyond the Travel cap
        pairs.push({ oi: oi, vi: vi, cost: cost, dist: dist, travelMin: tmin });
      });
    });

    // Max achievable count = oases feasible for >= 1 village.
    var feasibleOases = {};
    pairs.forEach(function (p) { feasibleOases[p.oi] = true; });
    var maxPossible = Object.keys(feasibleOases).length;

    return { villages: villages, oases: oases, pairs: pairs, baseSpeed: baseSpeed,
             selectedSlots: selected, maxPossible: maxPossible, maxTravelMin: cap,
             capBlocked: capBlocked };
  }

  // ── Greedy solvers (always available; also the exact-path incumbent) ─
  // Two O(P log P) constructions, best kept by (count, then movements):
  //  - greedy: per-oasis cheapest-first (original). An oasis whose cheap village is full
  //    immediately takes its next-cheapest — possibly very expensive — pair, burning budget
  //    that many later cheap-only oases needed.
  //  - greedyPairs: global cheapest-pair packing. An expensive pair is never taken until every
  //    cheaper pair on the map has had its chance. Benchmarked on a real 16,648-oasis world:
  //    +20 oases (130→150) on the uncapped 4-village instance and +202 (407→609) on a synthetic
  //    20-village one; ties everywhere else. Matches the count of far heavier local-search /
  //    Lagrangian solvers on every benchmark, in ~50-200 ms at 51k-222k pairs.
  // Neither strictly dominates the other (rare ±1 cases both ways), hence best-of-both.
  function greedy(inst) {
    var candByO = {};
    inst.pairs.forEach(function (p) {
      (candByO[p.oi] || (candByO[p.oi] = [])).push(p);
    });
    Object.keys(candByO).forEach(function (oi) {
      candByO[oi].sort(function (a, b) { return a.cost - b.cost; });
    });
    // serve cheapest-to-place oases first
    var order = Object.keys(candByO).map(Number).sort(function (a, b) {
      return candByO[a][0].cost - candByO[b][0].cost;
    });
    var remaining = inst.villages.map(function (v) { return v.budget; });
    var assign = {}; // oi -> vi
    order.forEach(function (oi) {
      var cands = candByO[oi];
      for (var k = 0; k < cands.length; k++) {
        var c = cands[k];
        if (remaining[c.vi] >= c.cost) { assign[oi] = c.vi; remaining[c.vi] -= c.cost; break; }
      }
    });
    return finalize(inst, assign);
  }

  function greedyPairs(inst) {
    var order = inst.pairs.slice().sort(function (a, b) {
      return a.cost - b.cost || a.dist - b.dist || a.oi - b.oi || a.vi - b.vi; // deterministic
    });
    var remaining = inst.villages.map(function (v) { return v.budget; });
    var assign = {};
    order.forEach(function (p) {
      if (assign[p.oi] === undefined && remaining[p.vi] >= p.cost) {
        assign[p.oi] = p.vi; remaining[p.vi] -= p.cost;
      }
    });
    return finalize(inst, assign);
  }

  function bestGreedy(inst) {
    var a = greedy(inst), b = greedyPairs(inst);
    return (b.count > a.count || (b.count === a.count && b.movements < a.movements)) ? b : a;
  }

  // ── Exact solver via an injected jsLPSolver-compatible solver ───────
  // timeoutMs (optional): jsLPSolver's branch-and-bound stops at the deadline and returns the
  // best integral solution found so far (or nothing). Measured: B&B time explodes past ~50
  // pairs on loose-budget instances, so an uncapped run can hang the tab — this is the net.
  function solveExact(inst, solver, timeoutMs) {
    var totalCost = inst.pairs.reduce(function (s, p) { return s + p.cost; }, 0);
    var eps = 1 / (totalCost + 1); // count dominates; tie-break to cheapest packing
    var model = { optimize: 'score', opType: 'max', constraints: {}, variables: {}, binaries: {} };
    if (timeoutMs && timeoutMs > 0) model.timeout = timeoutMs;
    inst.oases.forEach(function (o, oi) { model.constraints['o' + oi] = { max: 1 }; });
    inst.villages.forEach(function (v, vi) { model.constraints['v' + vi] = { max: v.budget }; });
    inst.pairs.forEach(function (p, idx) {
      var name = 'x' + idx;
      var vobj = { score: 1 - eps * p.cost };
      vobj['o' + p.oi] = 1;
      vobj['v' + p.vi] = p.cost;
      model.variables[name] = vobj;
      model.binaries[name] = 1;
    });
    var res = solver.Solve(model);
    if (!res || !res.feasible) return null;
    var assign = {};
    inst.pairs.forEach(function (p, idx) {
      if (res['x' + idx] && res['x' + idx] > 0.5) assign[p.oi] = p.vi;
    });
    var out = finalize(inst, assign);
    // A timed-out branch-and-bound with NO integral incumbent leaks the fractional LP relaxation;
    // rounding that can overshoot budgets (seen live: 622/613). Never surface an infeasible plan.
    for (var vi = 0; vi < inst.villages.length; vi++) {
      if (out.used[vi] > inst.villages[vi].budget) return null;
    }
    return out;
  }

  function finalize(inst, assign) {
    var used = inst.villages.map(function () { return 0; });
    var perVillage = inst.villages.map(function () { return []; });
    var count = 0;
    var byKey = {}; // (oi|vi) -> pair, so finalize is O(P + assigned), not O(P × assigned)
    inst.pairs.forEach(function (p) { byKey[p.oi + '|' + p.vi] = p; });
    Object.keys(assign).forEach(function (oiStr) {
      var oi = Number(oiStr), vi = assign[oiStr];
      var pair = byKey[oi + '|' + vi];
      if (!pair) return;
      used[vi] += pair.cost;
      perVillage[vi].push({ oi: oi, cost: pair.cost, dist: pair.dist, travelMin: pair.travelMin });
      count++;
    });
    var movements = used.reduce(function (s, u) { return s + u; }, 0);
    return { assign: assign, count: count, used: used, perVillage: perVillage, movements: movements };
  }

  // opts: { solver, maxExactPairs, exactTimeoutMs }
  // exactTimeoutMs (default 10s) timeboxes the ILP: a timed-out run yields the best solution
  // found so far, used only if it beats greedy (more oases, or same oases for fewer movements)
  // and labelled as not provably optimal.
  // maxExactPairs defaults to 50 — measured cliff for jsLPSolver's branch-and-bound on this
  // problem shape: 49 pairs = 36 ms, 62 pairs = 15 s, 78 pairs > 5 min. Beyond it the ILP
  // attempt just burns the full timeout and loses to greedy.
  function solve(inst, opts) {
    opts = opts || {};
    var g = bestGreedy(inst);
    if (g.count >= inst.maxPossible) {
      // count-optimal: every reachable oasis is placed (can't beat that). Movement total is a
      // greedy estimate, not provably minimal — the exact path's ε-term would shave it.
      return Object.assign(g, { method: 'greedy (count-optimal — every reachable oasis placed)', optimal: true });
    }
    var limit = opts.maxExactPairs || 50;
    var timeoutMs = opts.exactTimeoutMs != null ? opts.exactTimeoutMs : 10000;
    if (opts.solver && inst.pairs.length <= limit) {
      try {
        var t0 = Date.now();
        var e = solveExact(inst, opts.solver, timeoutMs);
        var timedOut = timeoutMs > 0 && (Date.now() - t0) >= timeoutMs;
        var better = e && (e.count > g.count || (e.count === g.count && e.movements <= g.movements));
        if (better && !timedOut) {
          return Object.assign(e, { method: 'exact ILP (jsLPSolver)', optimal: true });
        }
        if (better && timedOut) {
          return Object.assign(e, { method: 'ILP, timeboxed at ' + Math.round(timeoutMs / 1000) + 's (best found — not provably optimal)', optimal: false });
        }
      } catch (err) { /* fall through to greedy */ }
    }
    var note = opts.solver
      ? (inst.pairs.length > limit
          ? 'greedy heuristic (instance too large for exact: ' + inst.pairs.length + ' pairs)'
          : 'greedy heuristic (ILP found nothing better within ' + Math.round(timeoutMs / 1000) + 's)')
      : 'greedy heuristic (no ILP solver loaded)';
    return Object.assign(g, { method: note, optimal: false });
  }

  // ── Plan diff vs current farm lists (free oases only) ──────────────
  // Returns rows grouped per village action: keep/add/move/remove.
  // `skipped` (coord key set) lets a currently-farmed Skipped oasis be tagged reason 'skipped'
  // rather than misattributed to the resource filter (both are absent from inst.oases).
  function planDiff(data, inst, result, skipped) {
    var key = function (x, y) { return x + '|' + y; };
    var skippedKey = skipLookup(skipped);
    // optimal: oasisKey -> villageDid
    var optByKey = {};
    Object.keys(result.assign).forEach(function (oiStr) {
      var o = inst.oases[Number(oiStr)];
      optByKey[key(o.x, o.y)] = inst.villages[result.assign[oiStr]].did;
    });
    // scanned free oases by key (only these are in scope)
    var freeByKey = {};
    inst.oases.forEach(function (o) { freeByKey[key(o.x, o.y)] = o; });
    // oases with >= 1 feasible (oasis,village) pair — anything else is out of range for every
    // village (beyond the Travel cap, or costlier than any budget), not a solver choice.
    var reachableByKey = {};
    inst.pairs.forEach(function (p) {
      var o = inst.oases[p.oi];
      reachableByKey[key(o.x, o.y)] = true;
    });
    // …and of those, the ones some village could afford but-for the cap (so the reason
    // names the knob that actually binds — a budget-only failure must not blame the cap).
    var capBlockedByKey = {};
    inst.oases.forEach(function (o, oi) {
      if (inst.capBlocked && inst.capBlocked[oi]) capBlockedByKey[key(o.x, o.y)] = true;
    });
    // all scanned free oases (incl. filtered-out) — to flag "filtered" removals
    var allFreeByKey = {};
    (data.oases || []).forEach(function (o) { allFreeByKey[key(o.x, o.y)] = o; });

    // current: oasisKey -> [villageDid] (only free-oasis targets are in scope)
    var curByKey = {};
    (data.farmLists || []).forEach(function (list) {
      (list.targets || []).forEach(function (t) {
        var k = key(t.x, t.y);
        if (!allFreeByKey[k]) return; // village / occupied oasis -> ignore
        (curByKey[k] || (curByKey[k] = [])).push(list.villageDid);
      });
    });

    var vName = {};
    (data.villages || []).forEach(function (v) { vName[v.did] = v.name; });

    var rows = [];
    // additions / keeps / moves from the optimal set (one oasis -> one village)
    Object.keys(optByKey).forEach(function (k) {
      var o = freeByKey[k];
      var optDid = optByKey[k];
      var cur = curByKey[k] || [];
      var isKeep = cur.indexOf(optDid) !== -1;
      var status = cur.length === 0 ? 'add' : (isKeep ? 'keep' : 'move');
      var fromDid = isKeep ? null : (cur.length ? cur[0] : null);
      rows.push(row(o, status, optDid, fromDid, vName, null));
      // enforce the one-village rule: any OTHER village currently farming this oasis must drop it.
      // (the keep/move row already accounts for `optDid` and, for a move, the representative `fromDid`.)
      var covered = isKeep ? optDid : fromDid;
      cur.forEach(function (d) {
        if (d !== covered && d !== optDid) {
          rows.push(row(o, 'remove', null, d, vName, 'duplicate — keep only on ' + (vName[optDid] || optDid)));
        }
      });
    });
    // removals: current free-oasis targets the plan does not keep at all
    Object.keys(curByKey).forEach(function (k) {
      if (optByKey[k]) return; // handled above (keep/move)
      var o = allFreeByKey[k];
      var reason = skippedKey[k] ? 'skipped'
        : !freeByKey[k] ? 'excluded by resource filter'
        : !reachableByKey[k] ? (capBlockedByKey[k] ? 'out of range (beyond ' + inst.maxTravelMin + ' min travel cap)' : 'out of range (cost exceeds every budget)')
        : 'over capacity / not optimal';
      curByKey[k].forEach(function (fromDid) {
        rows.push(row(o, 'remove', null, fromDid, vName, reason));
      });
    });
    return rows;
  }

  function row(o, status, toDid, fromDid, vName, reason) {
    return {
      x: o.x, y: o.y,
      res: primaryRes(o.bonuses),
      bonuses: o.bonuses,
      status: status,
      toDid: toDid != null ? toDid : null,   // unambiguous ids so the UI can group by village
      fromDid: fromDid != null ? fromDid : null, // (names can collide — Travian allows duplicates)
      toVillage: toDid != null ? vName[toDid] : null,
      fromVillage: fromDid != null ? vName[fromDid] : null,
      reason: reason
    };
  }

  // ── exports ────────────────────────────────────────────────────────
  var PVE = {
    axisSize: axisSize, torusDelta: torusDelta, distance: distance,
    travelMinutes: travelMinutes, oasisCost: oasisCost, primaryRes: primaryRes, RES: RES,
    buildInstance: buildInstance, greedy: greedy, greedyPairs: greedyPairs, bestGreedy: bestGreedy,
    solveExact: solveExact, solve: solve,
    planDiff: planDiff
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PVE;
  root.PVE = PVE;
})(typeof window !== 'undefined' ? window : this);
