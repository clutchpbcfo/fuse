#!/usr/bin/env node
/* Builds worker.js by injecting ../sim.js VERBATIM between the markers in
   worker.template.js. This is what guarantees client/server sim parity —
   never edit worker.js by hand. Run: node build.js */
const fs = require('fs');
const path = require('path');
const here = __dirname;
const sim = fs.readFileSync(path.join(here, '..', 'sim.js'), 'utf8');
const tpl = fs.readFileSync(path.join(here, 'worker.template.js'), 'utf8');
const START = '/*__FUSE_SIM_START__*/';
const END = '/*__FUSE_SIM_END__*/';
const i = tpl.indexOf(START), j = tpl.indexOf(END);
if (i < 0 || j < 0 || j < i) { console.error('markers missing'); process.exit(1); }
const out = tpl.slice(0, i + START.length) + '\n' + sim + '\n' + tpl.slice(j);
fs.writeFileSync(path.join(here, 'worker.js'), out);
console.log('worker.js built — sim block ' + sim.length + ' bytes injected.');
