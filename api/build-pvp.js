#!/usr/bin/env node
/* Emits arcade-pvp/sims/fuse.js by injecting ../sim.js VERBATIM between the
   markers in pvp-adapter.template.js — the same build-enforced parity
   discipline as build.js (fuse-api worker). NEVER edit the emitted file and
   never hand-copy the sim. Idempotent (no timestamps): rerunning produces
   byte-identical output. Run: node build-pvp.js */
const fs = require('fs');
const path = require('path');
const here = __dirname;
const sim = fs.readFileSync(path.join(here, '..', 'sim.js'), 'utf8');
let tpl = fs.readFileSync(path.join(here, 'pvp-adapter.template.js'), 'utf8');

const SENTINEL = '/*__TEMPLATE_HEADER_END__*/';
const sIdx = tpl.indexOf(SENTINEL);
if (sIdx < 0) { console.error('template header sentinel missing'); process.exit(1); }
tpl = tpl.slice(sIdx + SENTINEL.length).replace(/^\n/, '');

const START = '/*__FUSE_SIM_START__*/';
const END = '/*__FUSE_SIM_END__*/';
const i = tpl.indexOf(START), j = tpl.indexOf(END);
if (i < 0 || j < 0 || j < i) { console.error('sim markers missing in pvp-adapter.template.js'); process.exit(1); }

const HEADER = [
  '/* =========================================================================',
  '   GENERATED from fuse/sim.js — regenerate, don\'t edit.',
  '   Built by fuse/api/build-pvp.js (template: fuse/api/pvp-adapter.template.js).',
  '   Regenerate after ANY fuse/sim.js change:   node fuse/api/build-pvp.js',
  '   FUSE\'s arcade-pvp duel sim module (PVP_PROTOCOL.md Shape A):',
  '     simulate(seed, inputs) -> { score:int, valid:bool }',
  '   ========================================================================= */',
  ''
].join('\n');

const out = HEADER + tpl.slice(0, i + START.length) + '\n' + sim + '\n' + tpl.slice(j);
const outDir = path.join(here, '..', '..', 'arcade-pvp', 'sims');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'fuse.js'), out);
console.log('arcade-pvp/sims/fuse.js built — sim block ' + sim.length + ' bytes injected verbatim.');
