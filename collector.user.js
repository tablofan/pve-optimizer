// ==UserScript==
// @name         Farm Optimizer — Collector
// @namespace    https://github.com/ren/pve-optimizer
// @version      0.7.0
// @description  Scan all free oases (map API) on a Travian T4.6 gameworld and send them (or download them as a file) — plus the current page's HTML — to the Farm Optimizer calculator, which does the parsing.
// @match        *://*.travian.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
//
// Runs IN PAGE CONTEXT (no @grant) so same-origin fetch carries your session cookie.
// Read-only: never writes to the game. Two jobs only:
//   • Scan oases  — sweep POST /api/v1/map/position (the only way to get the whole map).
//   • Send page   — postMessage the current rendered HTML to the calculator, which parses
//                   villages / farm-lists / troops from it (parsers live in the calculator).
// Open the relevant page (village sidebar, EXPANDED farm lists, troops overview), then Send page.

(function () {
  'use strict';
  if (window.top !== window.self) return;

  var ZOOM = 3, THROTTLE_MIN = 500, THROTTLE_MAX = 1500; // not user-tunable
  var saved = {}; try { saved = JSON.parse(localStorage.getItem('pveCollectorCfg') || '{}') || {}; } catch (e) { saved = {}; }
  // `radius` is the world's half-size (−R..+R): both the scan extent AND the torus modulus sent as mapRadius.
  var CFG = Object.assign({ radius: 200, step: 30, calcUrl: '' }, saved);
  function saveCfg() { try { localStorage.setItem('pveCollectorCfg', JSON.stringify(CFG)); } catch (e) { /* ignore */ } }

  var oases = []; try { oases = JSON.parse(localStorage.getItem('pveOasesCache') || '[]') || []; } catch (e) { oases = []; }
  var oasesScannedAt = ''; try { oasesScannedAt = localStorage.getItem('pveOasesScannedAt') || ''; } catch (e) { oasesScannedAt = ''; }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function jitter() { return THROTTLE_MIN + Math.floor(Math.random() * (THROTTLE_MAX - THROTTLE_MIN)); }
  function api(method, endpoint, body) {
    return fetch(endpoint, { method: method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(endpoint + ' ' + r.status)); });
  }

  // ── scan free oases ──
  var RES_TOKEN = { r1: 'wood', r2: 'clay', r3: 'iron', r4: 'crop' };
  function parseBonuses(text) {
    var out = [];
    ['r1', 'r2', 'r3', 'r4'].forEach(function (rk) {
      var m = text && text.match(new RegExp('\\{a\\.' + rk + '\\}[^{}]*?(\\d+)\\s*%'));
      if (m) out.push({ res: RES_TOKEN[rk], pct: parseInt(m[1], 10) });
    });
    return out;
  }
  async function scanOases(log) {
    var R = CFG.radius, span = 30;
    try {
      var probe = await api('POST', '/api/v1/map/position', { data: { x: 0, y: 0, zoomLevel: ZOOM, ignorePositions: [] } });
      var xs = (probe.tiles || []).map(function (t) { return t && t.position ? t.position.x : undefined; }).filter(function (v) { return Number.isFinite(v); });
      if (xs.length) span = Math.max.apply(null, xs) - Math.min.apply(null, xs) + 1;
    } catch (e) { log('probe failed (' + e.message + '); using step ' + CFG.step); }
    if (!Number.isFinite(span) || span < 2) span = CFG.step + 1;
    var step = Math.max(1, Math.min(CFG.step, span - 1));
    var axis = []; for (var v = -R; v < R; v += step) axis.push(v); axis.push(R); // always include +R so the far edge is covered
    var centers = []; axis.forEach(function (cx) { axis.forEach(function (cy) { centers.push([cx, cy]); }); });
    log('Viewport span ' + span + ' → step ' + step + '; ' + centers.length + ' windows.');
    var seen = {}, found = [], noBonus = 0, fails = 0;
    for (var i = 0; i < centers.length; i++) {
      var c = centers[i];
      try {
        var res = await api('POST', '/api/v1/map/position', { data: { x: c[0], y: c[1], zoomLevel: ZOOM, ignorePositions: [] } });
        fails = 0;
        (res.tiles || []).forEach(function (t) {
          if ((t.title || '').indexOf('{k.fo}') === -1) return;
          var p = t.position || {}; if (p.x == null || p.y == null) return;
          var key = p.x + '|' + p.y; if (seen[key]) return; seen[key] = 1;
          var b = parseBonuses(t.text || ''); if (!b.length) noBonus++;
          found.push({ x: p.x, y: p.y, bonuses: b });
        });
      } catch (e) {
        if (++fails >= 5) { log('Aborted after 5 consecutive failures (' + e.message + '). Logged in / not rate-limited?'); break; }
        log('  window ' + c + ' failed: ' + e.message);
      }
      if (i % 10 === 0 || i === centers.length - 1) log('  …' + (i + 1) + '/' + centers.length + ' (' + found.length + ' oases)');
      await sleep(jitter());
    }
    oases = found;
    oasesScannedAt = new Date().toISOString();
    try { localStorage.setItem('pveOasesCache', JSON.stringify(oases)); } catch (e) { log('(too large to cache — kept in memory; Send/Download oases before navigating away)'); }
    try { localStorage.setItem('pveOasesScannedAt', oasesScannedAt); } catch (e) { /* tiny — ignore */ }
    log('Done: ' + oases.length + ' free oases' + (noBonus ? ' (' + noBonus + ' with unreadable bonus)' : '') + '. Now "Send oases" (to the calculator) or "Download oases" (save a file).');
  }

  // ── send a payload to the calculator (single-flight; deliver on ready/retry; stop on ack) ──
  var CURRENT = null, MSG_ID = 0;
  function send(payload, log) {
    if (!CFG.calcUrl) { log('Set the Calculator URL first.'); return; }
    var origin; try { origin = new URL(CFG.calcUrl).origin; } catch (e) { log('Invalid Calculator URL.'); return; }
    var w = window.open(CFG.calcUrl, 'pveCalc');
    if (!w) { log('Popup blocked — allow popups for this site.'); return; }
    if (CURRENT) { clearInterval(CURRENT.iv); window.removeEventListener('message', CURRENT.onMsg); } // one in-flight send at a time
    var id = ++MSG_ID; payload.id = id;
    var done = false, tries = 0;
    function fin(m) { done = true; clearInterval(iv); window.removeEventListener('message', onMsg); if (CURRENT && CURRENT.id === id) CURRENT = null; log(m); }
    function onMsg(ev) {
      if (ev.source !== w) return;
      if (ev.data === 'pve-ready' && !done) { try { w.postMessage(payload, origin); } catch (e) {} }
      else if (ev.data === 'pve-got:' + id) { fin('Sent ✓'); }
    }
    window.addEventListener('message', onMsg);
    var iv = setInterval(function () {
      if (done) return;
      if (tries++ > 15) { fin('No ack from calculator — check the URL / that the tab opened.'); return; }
      try { w.postMessage(payload, origin); } catch (e) { /* not ready yet */ }
    }, 700);
    CURRENT = { id: id, iv: iv, onMsg: onMsg };
  }
  function sendPage(log) { send({ pve: 'page', html: document.documentElement.outerHTML, server: location.origin }, log); }
  function sendOases(log) {
    if (!oases.length) { log('Scan oases first.'); return; }
    send({ pve: 'oases', oases: oases, server: location.origin, mapRadius: CFG.radius, scannedAt: oasesScannedAt }, log); // radius = world half-size
  }

  // ── download oases as a portable file (oases are permanent for the world's life; this survives a
  //    localStorage clear / new machine, and re-imports into the calculator as a merge). ──
  function downloadOases(log) {
    if (!oases.length) { log('Scan oases first.'); return; }
    var when = oasesScannedAt || new Date().toISOString();
    var payload = { pve: 'oases', oases: oases, server: location.origin, mapRadius: CFG.radius, scannedAt: when };
    try {
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var host = (location.hostname || 'world').replace(/[^a-z0-9.\-]/gi, '');
      var a = document.createElement('a');
      a.href = url; a.download = 'pve-oases-' + host + '-' + when.slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
      log('Downloaded ' + oases.length + ' oases (' + a.download + '). Import it in the calculator.');
    } catch (e) { log('Download failed: ' + e.message); }
  }

  // ── panel ──
  function buildPanel() {
    var p = document.createElement('div');
    p.style.cssText = 'position:fixed;right:10px;top:80px;z-index:99999;width:300px;background:#1c1917;color:#e0e0e0;border:1px solid #57534e;border-radius:8px;font:12px/1.4 Segoe UI,sans-serif;padding:10px;box-shadow:0 4px 16px rgba(0,0,0,.5)';
    p.innerHTML =
      '<div style="font-weight:600;color:#f5f0e8;margin-bottom:6px">Farm Optimizer — Collector</div>' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">Map ± <input id="pveRad" type="number" title="world half-size, e.g. 200 for a −200..200 map" style="width:54px" value="' + CFG.radius + '"> Step <input id="pveStep" type="number" style="width:44px" value="' + CFG.step + '"></div>' +
      '<input id="pveCalc" placeholder="Calculator URL (required)" style="width:100%;margin-bottom:6px" value="' + (CFG.calcUrl || '') + '">' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap"><button id="pveScan">Scan oases</button><button id="pveSendO">Send oases</button><button id="pveDlO">Download oases</button><button id="pveSendP">Send this page</button></div>' +
      '<div id="pveLog" style="margin-top:8px;max-height:170px;overflow:auto;font-family:monospace;font-size:11px;color:#a8a29e"></div>';
    document.body.appendChild(p);
    Array.prototype.forEach.call(p.querySelectorAll('button'), function (b) { b.style.cssText = 'background:#44403c;color:#f5f0e8;border:1px solid #57534e;border-radius:5px;padding:5px 8px;cursor:pointer;font-size:11px'; });

    var logEl = p.querySelector('#pveLog');
    function log(m) { var d = document.createElement('div'); d.textContent = m; logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight; }
    function readCfg() { CFG.radius = Number(p.querySelector('#pveRad').value) || 200; CFG.step = Number(p.querySelector('#pveStep').value) || 30; CFG.calcUrl = p.querySelector('#pveCalc').value.trim(); saveCfg(); }
    p.querySelector('#pveScan').onclick = function () { readCfg(); scanOases(log); };
    p.querySelector('#pveSendO').onclick = function () { readCfg(); sendOases(log); };
    p.querySelector('#pveDlO').onclick = function () { readCfg(); downloadOases(log); };
    p.querySelector('#pveSendP').onclick = function () { readCfg(); sendPage(log); };
    log('Ready. Flow: Scan oases → Send oases (or Download oases to save a file). Then open each page (village list, EXPANDED farm lists, troops overview) and Send this page.');
    if (oases.length) log('(' + oases.length + ' oases cached' + (oasesScannedAt ? ' from ' + oasesScannedAt.slice(0, 10) : '') + ' — Send or Download oases to reuse.)');
  }

  if (document.body) buildPanel(); else window.addEventListener('DOMContentLoaded', buildPanel);
})();
