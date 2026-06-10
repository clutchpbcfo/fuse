# FUSE — cut it close.

The greed-timing game. Fuses burn toward bombs — tap a lane to cut. There's no target zone: **the later you cut, the more it's worth.** The bomb ends the argument.

**Play:** https://clutchpbcfo.github.io/fuse/ · part of the INSERT COIN arcade

**Provably fair by construction:** the deterministic game sim (`sim.js`) is one shared module — the client plays on it, and the leaderboard server replays your exact tap timeline through the same code and stores the score *it* computes (`api/`). A forged score can't pass. Tests in `test/` (determinism, client/server parity, anti-cheat, solvability).

Built by [@ClutchPBCFO](https://x.com/ClutchPBCFO).
