// ==UserScript==
// @name         PvE Optimizer — Collector
// @namespace    https://github.com/ren/pve-optimizer
// @version      0.3.0
// @description  Scrape free oases (coords+type), own villages/cavalry, and current farm lists from a Travian T4.6 gameworld, and hand the data to the PvE Optimizer calculator.
// @match        *://*.travian.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
//
// Runs IN PAGE CONTEXT (no @grant) so same-origin fetch carries your session cookie —
// no token needed (verified vs Ash-Warden/scout_players.py + TravianResourceBarPlus).
// Read-only: never writes to the game. Hands data to the calculator via Download / Copy /
// postMessage. Parsers marked "VALIDATE LIVE" depend on the live DOM/patch — confirm them once
// against a logged-in gameworld (build-plan step 7).

(function () {
  'use strict';
  if (window.top !== window.self) return;          // not in iframes

  // ── config (persisted on the game origin) ──
  var CFG = Object.assign({
    radius: 200, zoom: 3, step: 30, throttleMin: 500, throttleMax: 1500, calcUrl: ''  // step 30 = full overlap at zoom-3's 31-wide box, ~196 calls for a full map
  }, JSON.parse(localStorage.getItem('pveCollectorCfg') || '{}'));
  function saveCfg() { localStorage.setItem('pveCollectorCfg', JSON.stringify(CFG)); }

  // in-game Travian tribeId -> calculator tribe slug. (Egyptians/Huns/Spartans/Vikings ids: VALIDATE LIVE.)
  var GAME_TRIBE = { 1: 'romans', 2: 'teutons', 3: 'gauls', 6: 'egyptians', 7: 'huns', 8: 'spartans', 9: 'vikings' };
  var DATA = { server: location.origin, tribe: 'huns', mapRadius: CFG.radius, scannedAt: null,
               villages: [], oases: [], farmLists: [] };

  // ── tiny helpers ──
  var U_MINUS = /−/g;                          // Travian renders negatives as U+2212
  var U_MARKS = /[‪-‮⁦-⁩‎‏⁠]/g; // bidi marks Travian wraps numbers in
  // capture a single signed integer (after stripping bidi marks + normalising the minus)
  function num(s) {
    var m = String(s).replace(U_MARKS, '').replace(U_MINUS, '-').match(/-?\d[\d.,]*\d|-?\d/);
    return m ? parseInt(m[0].replace(/[.,]/g, ''), 10) : NaN;
  }
  function clean(s) { return String(s || '').replace(U_MARKS, '').replace(/\s+/g, ' ').trim(); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function jitter() { return CFG.throttleMin + Math.floor(Math.random() * (CFG.throttleMax - CFG.throttleMin)); }
  function parseDoc(html) { return new DOMParser().parseFromString(html, 'text/html'); }

  function api(method, endpoint, body) {
    return fetch(endpoint, {
      method: method, credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(endpoint + ' ' + r.status)); });
  }
  function getHtml(url) {
    return fetch(url, { credentials: 'include' }).then(function (r) {
      if (!r.ok) return Promise.reject(new Error(url + ' ' + r.status));
      return r.text().then(function (t) {
        if (/name=["']?password["']?/i.test(t) && !/sidebarBoxVillageList/.test(t)) {
          return Promise.reject(new Error('not logged in (' + url + ')'));
        }
        return t;
      });
    });
  }

  // ── 1. scan free oases ──────────────────────────────────────────────
  // POST /api/v1/map/position -> { tiles:[{position:{x,y}, title, text, ...}] }
  // free oasis: title contains {k.fo}; bonus % in text via {a.r1}..{a.r4}.  (VALIDATE LIVE)
  var RES_TOKEN = { r1: 'wood', r2: 'clay', r3: 'iron', r4: 'crop' };
  function parseBonuses(text) {
    var out = [];
    ['r1', 'r2', 'r3', 'r4'].forEach(function (rk) {
      // token then a nearby percentage, not crossing into another {a.*} token
      var m = text && text.match(new RegExp('\\{a\\.' + rk + '\\}[^{}]*?(\\d+)\\s*%'));
      if (m) out.push({ res: RES_TOKEN[rk], pct: parseInt(m[1], 10) });
    });
    return out;
  }
  async function scanOases(log) {
    var R = CFG.radius;
    // probe one window to learn the actual viewport span at this zoom, so window centers overlap
    var span = 30;
    try {
      var probe = await api('POST', '/api/v1/map/position', { data: { x: 0, y: 0, zoomLevel: CFG.zoom, ignorePositions: [] } });
      var xs = (probe.tiles || []).map(function (t) { return t.position.x; });
      if (xs.length) span = Math.max.apply(null, xs) - Math.min.apply(null, xs) + 1;
    } catch (e) { log('probe failed (' + e.message + '); using step ' + CFG.step); }
    var step = Math.max(1, Math.min(CFG.step, span - 1)); // overlap by >= 1 tile
    var centers = [];
    for (var cx = -R; cx <= R; cx += step) for (var cy = -R; cy <= R; cy += step) centers.push([cx, cy]);
    log('Viewport span ' + span + ' → step ' + step + '; ' + centers.length + ' windows.');
    var seen = {}, oases = [], noBonus = 0;
    for (var i = 0; i < centers.length; i++) {
      var c = centers[i];
      try {
        var res = await api('POST', '/api/v1/map/position',
          { data: { x: c[0], y: c[1], zoomLevel: CFG.zoom, ignorePositions: [] } });
        (res.tiles || []).forEach(function (t) {
          if ((t.title || '').indexOf('{k.fo}') === -1) return;     // only FREE oases
          var p = t.position || {}; if (p.x == null || p.y == null) return;
          var key = p.x + '|' + p.y; if (seen[key]) return; seen[key] = 1;
          var bonuses = parseBonuses(t.text || '');
          if (!bonuses.length) noBonus++;
          oases.push({ x: p.x, y: p.y, bonuses: bonuses });   // keep even if bonus parse missed
        });
      } catch (e) { log('  window ' + c + ' failed: ' + e.message); }
      if (i % 10 === 0) log('  …' + (i + 1) + '/' + centers.length + ' (' + oases.length + ' oases)');
      await sleep(jitter());
    }
    DATA.oases = oases; DATA.mapRadius = R; DATA.scannedAt = new Date().toISOString();
    log('Done: ' + oases.length + ' free oases' + (noBonus ? ' (' + noBonus + ' with unreadable bonus — check {a.rN} parse)' : '') + '.');
  }

  // ── 2. own villages + coords (read from the live sidebar DOM) ───────
  // #sidebarBoxVillageList .listEntry.village[data-did]; name in .name;
  // coords in .coordinatesGrid > .coordinateX / .coordinateY (bidi-wrapped).
  function readVillages(log) {
    var rows = document.querySelectorAll('#sidebarBoxVillageList .listEntry.village');
    var vs = [];
    rows.forEach(function (el) {
      var did = el.getAttribute('data-did'); if (!did) return;
      var nameEl = el.querySelector('.name');
      var name = nameEl ? clean(nameEl.textContent) : ('v' + did);
      var cg = el.querySelector('.coordinatesGrid');
      var x = num((cg && cg.querySelector('.coordinateX') || {}).textContent);
      var y = num((cg && cg.querySelector('.coordinateY') || {}).textContent);
      if (isNaN(x) || isNaN(y)) return;
      vs.push({ did: Number(did), name: name || ('v' + did), x: x, y: y, troops: {} });
    });
    DATA.villages = vs;
    log('Villages: ' + vs.length + (vs.length
      ? ' (' + vs.slice(0, 5).map(function (v) { return v.name; }).join(', ') + (vs.length > 5 ? ', …' : '') + ')'
      : ' — none in #sidebarBoxVillageList .listEntry.village'));
    return vs;
  }

  // ── 3. home cavalry per village ─────────────────────────────────────
  // build.php?gid=16&tt=1&newdid=<did> ; parse the troops table -> t1..t10.  (VALIDATE LIVE)
  async function readTroops(log) {
    for (var i = 0; i < DATA.villages.length; i++) {
      var v = DATA.villages[i];
      try { v.troops = parseTroopsTable(parseDoc(await getHtml('/build.php?gid=16&tt=1&newdid=' + v.did))); }
      catch (e) { log('  troops ' + v.name + ' failed: ' + e.message); }
      await sleep(jitter());
    }
    log('Troops read for ' + DATA.villages.length + ' villages.');
  }
  // Travian unit icons carry a class like `unit_small tribe6 t4` — the `tN` token IS the
  // rally-point slot. (Fallback: a global `uN` class, where slot = ((N-1) % 10) + 1.)
  // Each icon is paired with a `.value` count in its wrapper. Pass a DOM root (element or document).
  function parseTroopsTable(root) {
    var troops = {}; for (var s = 1; s <= 10; s++) troops['t' + s] = 0; // fixed skeleton
    var icons = Array.prototype.filter.call(root.querySelectorAll('i[class*="t"], [class*="unit"] i, [class*="unit"]'),
      function (e) { return /\bt(\d{1,2})\b/.test(e.className) || /\bu(\d{1,2})\b/.test(e.className); });
    icons.forEach(function (ic) {
      var slot = null;
      var mt = ic.className.match(/\bt(\d{1,2})\b/);
      if (mt) slot = parseInt(mt[1], 10);
      else { var mu = ic.className.match(/\bu(\d{1,2})\b/); if (mu) slot = ((parseInt(mu[1], 10) - 1) % 10) + 1; }
      if (!slot || slot > 10) return;
      var wrap = ic.closest ? (ic.closest('td,span,div,li') || ic.parentElement) : ic.parentElement;
      var valEl = wrap && (wrap.querySelector('.value') || wrap.nextElementSibling);
      var n = num(valEl ? valEl.textContent : (wrap && wrap.textContent));
      if (!isNaN(n)) troops['t' + slot] = Math.max(troops['t' + slot], n);
    });
    return troops;
  }

  // ── 4. current farm lists (read from the live DOM on the Farm List page) ──
  // The farm-list page is client-rendered, so we read the current DOM (NOT a fetch):
  //   .farmListWrapper > .farmListHeader [data-list] (list id) + .farmListName .name;
  //   targets: tbody tr.slot > td.target a[href*="karte.php?x=&y="].
  // NOTE: collapsed lists don't render their rows — expand a list to capture its targets.
  function readFarmLists(log) {
    var wrappers = document.querySelectorAll('.farmListWrapper');
    if (!wrappers.length) { DATA.farmLists = []; log('Farm lists: 0 — open Rally Point ▸ Farm List first, then click this.'); return []; }
    var lists = [], collapsed = 0;
    wrappers.forEach(function (w) {
      var listEl = w.querySelector('.farmListHeader [data-list]');
      var listId = listEl ? Number(listEl.getAttribute('data-list')) : null;
      var name = clean((w.querySelector('.farmListName .name') || {}).textContent) || ('list' + (listId || ''));
      var slots = w.querySelectorAll('tbody tr.slot');
      if (!slots.length) collapsed++;
      var targets = [];
      slots.forEach(function (tr) {
        var a = tr.querySelector('td.target a[href*="karte.php?x="]');
        if (!a) return;
        var m = (a.getAttribute('href') || '').replace(U_MINUS, '-').match(/x=(-?\d+)&(?:amp;)?y=(-?\d+)/);
        if (m) targets.push({ x: Number(m[1]), y: Number(m[2]) });
      });
      lists.push({ listId: listId, name: name, villageDid: null, targets: targets });
    });
    DATA.farmLists = lists;
    var total = lists.reduce(function (s, l) { return s + l.targets.length; }, 0);
    log('Farm lists: ' + lists.length + ' (' + total + ' targets' +
      (collapsed ? '; ' + collapsed + ' collapsed — EXPAND them to include their targets' : '') + ').');
    return lists;
  }

  // ── tribe detection ──
  function detectTribe() {
    var b = document.body.className + ' ' + document.documentElement.className;
    var m = b.match(/tribe(\d+)/);
    if (m && GAME_TRIBE[m[1]]) return GAME_TRIBE[m[1]];
    return DATA.tribe; // fall back to the panel selection
  }

  // ── hand-off ──
  function jsonBlob() { return JSON.stringify(DATA, null, 2); }
  function download() {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([jsonBlob()], { type: 'application/json' }));
    a.download = 'pve-data.json'; a.click(); URL.revokeObjectURL(a.href);
  }
  function copy() { return navigator.clipboard.writeText(jsonBlob()); }
  function sendToCalculator(log) {
    if (!CFG.calcUrl) { log('Set the Calculator URL first (or use Download/Copy).'); return; }
    var w = window.open(CFG.calcUrl, 'pveCalc');
    if (!w) { log('Popup blocked — allow popups or use Download/Copy.'); return; }
    var done = false, tries = 0;
    function finish(msg) { done = true; clearInterval(iv); window.removeEventListener('message', onMsg); log(msg); }
    function onMsg(ev) { if (ev.source === w && ev.data === 'pve-ready' && !done) { w.postMessage(DATA, '*'); finish('Sent to calculator.'); } }
    window.addEventListener('message', onMsg);
    var iv = setInterval(function () {
      if (done) return;
      if (tries++ > 12) { finish('No ready-signal from calculator — use Download/Copy instead.'); return; }
      try { w.postMessage(DATA, '*'); } catch (e) { /* not loaded yet */ }
    }, 800);
  }

  // ── panel UI ──
  function buildPanel() {
    var p = document.createElement('div');
    p.style.cssText = 'position:fixed;right:10px;top:80px;z-index:99999;width:300px;background:#1c1917;color:#e0e0e0;border:1px solid #57534e;border-radius:8px;font:12px/1.4 Segoe UI,sans-serif;padding:10px;box-shadow:0 4px 16px rgba(0,0,0,.5)';
    p.innerHTML =
      '<div style="font-weight:600;color:#f5f0e8;margin-bottom:6px">PvE Optimizer — Collector</div>' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">' +
        'Tribe <select id="pveTribe"></select>' +
        'Radius <input id="pveRad" type="number" style="width:54px" value="' + CFG.radius + '">' +
        'Step <input id="pveStep" type="number" style="width:44px" value="' + CFG.step + '">' +
      '</div>' +
      '<input id="pveCalc" placeholder="Calculator URL (for auto-send)" style="width:100%;margin-bottom:6px" value="' + (CFG.calcUrl || '') + '">' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap">' +
        '<button id="pveScan">Scan oases</button>' +
        '<button id="pveVil">Villages+troops</button>' +
        '<button id="pveFarm">Farm lists</button>' +
      '</div>' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">' +
        '<button id="pveSend">Send → Calculator</button>' +
        '<button id="pveDl">Download</button>' +
        '<button id="pveCopy">Copy</button>' +
      '</div>' +
      '<div id="pveLog" style="margin-top:8px;max-height:160px;overflow:auto;font-family:monospace;font-size:11px;color:#a8a29e"></div>';
    document.body.appendChild(p);
    Array.prototype.forEach.call(p.querySelectorAll('button'), function (b) {
      b.style.cssText = 'background:#44403c;color:#f5f0e8;border:1px solid #57534e;border-radius:5px;padding:5px 8px;cursor:pointer;font-size:11px';
    });

    var sel = p.querySelector('#pveTribe');
    ['romans', 'teutons', 'gauls', 'egyptians', 'huns', 'spartans', 'vikings'].forEach(function (t) {
      var o = document.createElement('option'); o.value = t; o.textContent = t; sel.appendChild(o);
    });
    DATA.tribe = detectTribe(); sel.value = DATA.tribe;
    sel.onchange = function () { DATA.tribe = sel.value; };

    var logEl = p.querySelector('#pveLog');
    function log(m) { var d = document.createElement('div'); d.textContent = m; logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight; }

    function readCfg() {
      CFG.radius = Number(p.querySelector('#pveRad').value) || 200;
      CFG.step = Number(p.querySelector('#pveStep').value) || 25;
      CFG.calcUrl = p.querySelector('#pveCalc').value.trim();
      DATA.mapRadius = CFG.radius; saveCfg();
    }
    p.querySelector('#pveScan').onclick = function () { readCfg(); scanOases(log); };
    p.querySelector('#pveVil').onclick = function () { readCfg(); if (!readVillages(log).length) return; readTroops(log); };
    p.querySelector('#pveFarm').onclick = function () { readCfg(); readFarmLists(log); };
    p.querySelector('#pveSend').onclick = function () { readCfg(); sendToCalculator(log); };
    p.querySelector('#pveDl').onclick = function () { readCfg(); download(); log('Downloaded pve-data.json'); };
    p.querySelector('#pveCopy').onclick = function () { readCfg(); copy().then(function () { log('Copied JSON to clipboard.'); }, function () { log('Clipboard blocked — use Download.'); }); };
    log('Ready. Scan oases → Villages+troops → Farm lists, then Send/Download.');
  }

  if (document.body) buildPanel();
  else window.addEventListener('DOMContentLoaded', buildPanel);
})();
