# FUSE → arcade-shell wiring (insurance copy)

Applied 2026-06-10 ~00:25 UTC directly into `arcade-shell/index.html` (the post-ROOK-rename version, mtime 00:14). **A parallel session was actively editing the shell tonight** — if its next save came from a stale buffer and the FUSE cabinet vanished, re-apply:

1. **GAMES[]** — after the STAK row:
```js
{key:"FUSE", icon:"<base64 PNG — regenerate: render fuse/fuse-icon.svg at 220×220, or omit icon to use the glyph fallback>", glyph:"⌁", color:"#FF8A1E", rings:["free","skill"], players:"85", tag:"GREED · TIMING", status:"LIVE", url:"https://clutchpbcfo.github.io/fuse"},
```
2. **DESC{}** — after the STAK line:
```js
FUSE:'The greed-timing game. No target zone — you set your own line: the later you cut, the more it\'s worth, and the bomb ends the argument. NERVE\'s emotion as a free skill game.',
```
The renderer falls back to the glyph automatically if `icon` is omitted.

---

## PVP DUEL WIRING (arcade-pvp · Shape A) — added 2026-06-10

FUSE duels run on the shared `arcade-pvp` worker (PVP_PROTOCOL.md). The server re-simulates **both** players' input logs with FUSE's sim module; clients never submit scores.

**Sim adapter (GENERATED — never edit):** `arcade-pvp/sims/fuse.js`
- Platform sim interface (matches `sims/pulse.js`): ESM `export default { game:'fuse', maxInputs:6000, simulate }` — `simulate(seed, inputs) -> {score:int, valid:bool}` (+ `reason` on invalid, `meta:{bestCut,cuts,lvl,deathT}` on valid); named exports `simulate, seedToUint32, FUSE_SIM`. `maxInputs` is derived from `CFG.maxTaps*2`, never hardcoded.
- **Worker activation (owned by the arcade-pvp build):** its `SIMS` table ships with a `fuse: null` slot — flip it with `import fuseSim from './sims/fuse.js';` → `fuse: fuseSim`. Until then the worker answers `unknown_game` and the FUSE client degrades to "PVP IS OFFLINE".
- `seed` = the duel's server seed treated as an **opaque string, used verbatim**: sim uint32 = `FUSE_SIM.hashSeed(String(seed))`. The client derives its run seed the exact same way (`duelSeed32()` in `index.html`) — client play and server replay are the same run by construction.
- `inputs` = FUSE's flat tap log `[t0,lane0,t1,lane1,...]` (q5 game-time, ascending). `valid:false` on malformed/forged logs (descending, bad lane/time, >3000 taps, inhuman burst, taps after death) or implausible score (>1e6 — same cap as fuse-api).

**Regenerate after ANY `fuse/sim.js` change:**
```
node fuse/api/build-pvp.js     # sim.js → (verbatim) → arcade-pvp/sims/fuse.js
node fuse/api/build.js         # sim.js → (verbatim) → fuse/api/worker.js   (solo fuse-api)
node fuse/tests/pvp-sim.test.mjs && node fuse/test/test.js
```
`build-pvp.js` injects sim.js verbatim between markers in `fuse/api/pvp-adapter.template.js` (idempotent — byte-identical on rerun). All three sims (client / fuse-api / arcade-pvp) must ship from the same sim.js in the same change.

**Client:** DUEL button on the title screen → handle entry (reuses saved tag) → `POST {PVP_API}/api/duel/queue {game:'fuse',name}` → poll `/api/duel/state?d=&t=` → at `active`, one run seeded by the server seed → `POST /api/duel/submit {duelId,token,inputs}` (raw log only) → poll to `resolved` → verified you-vs-them scores + W/L + REMATCH (re-queues). `PVP_API` is one const (`https://arcade-pvp.clutchpbcfo.workers.dev`). PVP unreachable → "PVP IS OFFLINE" + retry; solo + fuse-api leaderboard flows are untouched.

**Deploy note:** shipping duels = redeploy the static `fuse` repo (client) **and** the arcade-pvp worker (owned by the pvp build) with the regenerated `sims/fuse.js`. No FUSE-side worker changes; `fuse-api` stays as-is for solo boards.
