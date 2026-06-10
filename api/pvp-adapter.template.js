/* FUSE → arcade-pvp duel sim adapter TEMPLATE (fuse/api/pvp-adapter.template.js).
   build-pvp.js injects ../sim.js VERBATIM between the markers below and emits
   arcade-pvp/sims/fuse.js. Edit THIS file (and sim.js) — NEVER the emitted file.
   Everything above the sentinel line is stripped from the output. */
/*__TEMPLATE_HEADER_END__*/
// Contract (PVP_PROTOCOL.md · Shape A DUEL):
//   simulate(seed, inputs) -> { score:int, valid:bool }
//   seed   — the duel's server seed, an opaque (hex) STRING used VERBATIM:
//            sim uint32 = FUSE_SIM.hashSeed(String(seed)). The FUSE client
//            derives its run seed the exact same way (duelSeed32 in index.html),
//            so client play and server replay are the same run by construction.
//   inputs — FUSE input log: flat [t0,lane0,t1,lane1,...] (q5 game-time, ascending).
// valid=false ⇢ bad seed · malformed/forged log (descending times, bad lane/time,
//   empty, >3000 taps, inhuman burst rate, extra taps after the run already
//   ended) · implausible score. Adapter-only logic lives OUTSIDE the markers;
//   the sim itself is byte-identical to fuse/sim.js.
// Module shape matches the platform sim interface (see sims/pulse.js):
//   export default { game, maxInputs, simulate }  — worker wires it via
//   `import fuseSim from './sims/fuse.js'` → SIMS slot `fuse: fuseSim`.

/*__FUSE_SIM_START__*/
/*__FUSE_SIM_END__*/

const MAX_DUEL_SCORE = 1000000; // same plausibility cap as the solo fuse-api worker

function seedToUint32(seed){ return FUSE_SIM.hashSeed(String(seed)); }

function simulate(seed, inputs){
  if (seed == null) return { score: 0, valid: false, reason: 'bad_seed' };
  const s = String(seed);
  if (s.length < 1 || s.length > 256) return { score: 0, valid: false, reason: 'bad_seed' };
  const seed32 = seedToUint32(s);

  const v = FUSE_SIM.validateTaps(inputs);
  if (!v.ok) return { score: 0, valid: false, reason: v.reason };

  const r = FUSE_SIM.simulate(seed32, inputs);
  // r.used = taps the replay consumed before death. The single tap that
  // *discovers* the bomb is consumed (clients can race one in), but any
  // further taps mean a tampered "kept playing after death" log.
  if (r.used !== v.n) return { score: 0, valid: false, reason: 'taps_after_death' };
  if (!(r.score >= 0 && r.score <= MAX_DUEL_SCORE)) return { score: 0, valid: false, reason: 'implausible' };

  return { score: r.score | 0, valid: true,
           meta: { bestCut: r.bestCut, cuts: r.cuts, lvl: r.lvl, deathT: r.deathT } };
}

/* maxInputs = flat log entries (taps × 2), derived from the sim — never hardcoded. */
export default { game: 'fuse', maxInputs: FUSE_SIM.CFG.maxTaps * 2, simulate };
export { simulate, seedToUint32, FUSE_SIM };
