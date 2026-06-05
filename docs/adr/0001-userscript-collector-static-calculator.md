# Split into a userscript collector and a static calculator

## Status

accepted

## Update (as built)

The collector/calculator split below still holds, but two details diverged in the shipped code:

- **Parsing moved to the calculator (the "send-page" rework).** The collector does **no** parsing. It
  ships the scanned free oases (`Send oases`) and each page's raw HTML (`Send this page`) to the
  calculator via `window.open` + `postMessage` (a ready/retry/ack handshake — not localStorage or a
  query param); the calculator parses villages / farm-lists / troops from the sent HTML. This lets
  selectors be fixed by redeploying the page with no userscript reinstall.
- **The scan is a full-map sweep.** `scanOases` always sweeps a grid of windows across the whole
  −R..+R map (default R = 200), throttled ~0.5–1.5 s per window. There is no village-centered default
  and no separate opt-in for a whole-map scan.

## Decision

The project is two artifacts:

1. A **Tampermonkey collector userscript** that runs on the Travian gameworld origin. It reads
   all **free oases** (coordinates + bonus type) from the map's own data feed
   (`POST /api/v1/map/position`, same-origin, authenticated by the player's existing session
   cookie — no token needed), plus the player's own villages, coordinates, and home cavalry. It
   scans only windows around the player's villages by default (range-limited), exports the result
   as JSON, and hands it to the calculator automatically (localStorage / postMessage / query param).
2. A **static `index.html` calculator** (matching the sibling `trade-route-calculator` pattern) that
   imports that JSON and runs the oasis-farming optimizer + UI.

## Context

The original vision — "pick a server, the page auto-fetches all oasis data" from a single static
HTML file — is not achievable. Verified live (2026-06-02) against a T4.6 x3 world:

- **`map.sql` contains villages only — zero oases** (tribe id 4 / Nature never appears), so oasis
  coordinates and bonus types are not in the one anonymous bulk export.
- Oasis data exists only in the in-game map API (`/api/v1/map/position`), which is **same-origin
  and session-gated** (401 without the player's cookie; CORS locked to the game's own origin).
  `map.sql` is also served with no `Access-Control-Allow-Origin`, so a cross-origin static page
  cannot read it either.
- No third-party service (travianstats / gettertools / travmap) exposes per-world oasis data via a
  CORS-friendly API.

Therefore the data is reachable only from code running **on the game origin, with the user's
session** — i.e. a userscript/extension — or from a backend that replays the user's session.

A userscript was confirmed feasible from the user's own `Ash-Warden/standalone/scout_players.py`
and the live `adipiciu/TravianResourceBarPlus` userscript: a page-context `fetch` to
`/api/v1/map/position` with only `Content-Type: application/json` succeeds on the session cookie
alone; CSP is only `frame-ancestors 'self'` (no `connect-src`/`script-src`), so it does not block
the calls or UI injection; and each tile already carries the oasis bonus type in its `text`
(`{a.r1}..{a.r4}` + percentage), so no per-oasis `tile-details` calls are needed.

## Considered options

- **Pure static page that fetches the data itself** — rejected: CORS + session-auth make it
  impossible to read oasis data from another origin.
- **Backend / serverless proxy** — rejected: adds hosting infrastructure and would have to handle
  the user's game session server-side (a security concern), and still needs the user's login for
  oases.
- **All-in-one in-page userscript** (scraper + optimizer UI injected into the game) — rejected as
  the default: smoothest UX but abandons the standalone static-HTML pattern shared with the sibling
  calculators and is harder to develop and debug. The collector/calculator split keeps the optimizer
  in a plain testable page; the auto hand-off recovers most of the UX smoothness.

## Consequences

- The tool depends on an **undocumented in-game API** that Travian can change; the collector's
  parsing of `/api/v1/map/position` tiles is the main maintenance risk.
- The full-map sweep (~1,800 throttled calls) is avoided in normal use by scanning only around the
  player's villages; whole-map scan is opt-in and must be throttled (~0.5–1.5s spacing) to avoid
  anti-bot measures.
- Oasis locations and types are permanent for the world's life (only free-vs-occupied drifts), so
  oasis data is cache-once / refresh-occasionally; troop counts are re-read each planning session.
