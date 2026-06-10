#!/usr/bin/env node
/* FUSE ⇄ arcade-pvp duel sim parity suite (plain Node, ESM).
   Proves the GENERATED arcade-pvp/sims/fuse.js === fuse/sim.js driven directly:
   identical scores on 1,100+ seeded random input logs, validity edges, and
   build-pvp.js regen idempotence. Run: node fuse/tests/pvp-sim.test.mjs */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const simPath = path.join(here, '..', 'sim.js');
const buildPath = path.join(here, '..', 'api', 'build-pvp.js');
const adapterPath = path.join(here, '..', '..', 'arcade-pvp', 'sims', 'fuse.js');

execFileSync(process.execPath, [buildPath]); // always test the freshly generated adapter
const SIM = require(simPath);
const NS = await import(pathToFileURL(adapterPath).href); // ESM, like the arcade-pvp worker imports it
const PVP = NS.default;
const seedToUint32 = NS.seedToUint32;

let passed = 0, failed = 0;
function T(name, fn){ try{ fn(); passed++; console.log('  ✓ ' + name); }catch(e){ failed++; console.log('  ✗ ' + name + ' — ' + (e && e.message)); } }

/* ---------- scaffolding (test-only; the sim under test is never reimplemented) ---------- */
function randHex(rng, len){ const chars='0123456789abcdef'; let s=''; for(let i=0;i<len;i++) s+=chars[Math.floor(rng()*16)]; return s; }
/* legal random-walk log: ascending, gaps ≥0.085s (can never trip the burst guard) */
function randomLog(rng){
  const taps=[]; let t=rng()*0.8; const n=3+Math.floor(rng()*120);
  for(let i=0;i<n;i++){ t=SIM.q5(t+0.085+rng()*0.6); if(t>SIM.CFG.maxT) break; taps.push(t, Math.floor(rng()*4)); }
  return taps;
}
/* greedy bot that PLAYS on the incremental sim (mirrors fuse/test/test.js botRun) */
function botRun(seed32, opts){
  const o=Object.assign({ greed:0.85, reaction:0.22, rate:0.13, panic:0.25, minWorth:0.3, maxT:400 }, opts||{});
  const sim=new SIM.Sim(seed32); const taps=[];
  const notice=[Infinity,Infinity,Infinity,Infinity];
  let t=0, lastTap=-10;
  while(!sim.dead && t<o.maxT){
    t=SIM.q5(t+0.008); sim.advance(t); if(sim.dead) break;
    for(let i=0;i<4;i++){ const f=sim.fuses[i];
      if(!f){ notice[i]=Infinity; continue; }
      const p=SIM.progressAt(f,t), ttb=f.bombT-t;
      if(notice[i]===Infinity && (p>=o.greed || (ttb<o.panic && p>=o.minWorth))) notice[i]=t; }
    if(t-lastTap<o.rate) continue;
    let pick=-1, pickBomb=Infinity;
    for(let i=0;i<4;i++){ const f=sim.fuses[i]; if(!f||notice[i]===Infinity) continue;
      if(t>=notice[i]+o.reaction && f.bombT<pickBomb){ pickBomb=f.bombT; pick=i; } }
    if(pick>=0){ taps.push(t,pick); sim.tap(t,pick); notice[pick]=Infinity; lastTap=t; }
  }
  return { taps, live:{ score:sim.score, deathT:sim.deathT } };
}

console.log('\n— generated adapter (build discipline) —');
T('adapter exists + carries the GENERATED header', ()=>{
  const src=fs.readFileSync(adapterPath,'utf8');
  assert.ok(src.startsWith('/* ='), 'header banner missing');
  assert.ok(src.includes("GENERATED from fuse/sim.js — regenerate, don't edit"), 'regen warning missing');
});
T('adapter contains fuse/sim.js VERBATIM between markers', ()=>{
  const simSrc=fs.readFileSync(simPath,'utf8');
  const src=fs.readFileSync(adapterPath,'utf8');
  assert.ok(src.includes(simSrc), 'sim block differs from sim.js — rerun fuse/api/build-pvp.js');
  assert.ok(src.includes('/*__FUSE_SIM_START__*/') && src.includes('/*__FUSE_SIM_END__*/'));
});
T('adapter exposes the platform sim interface: default {game, maxInputs, simulate}', ()=>{
  assert.strictEqual(typeof PVP.simulate,'function');
  assert.strictEqual(PVP.game,'fuse');
  assert.strictEqual(PVP.maxInputs, SIM.CFG.maxTaps*2, 'maxInputs = flat log entries, derived from sim CFG');
  const src=fs.readFileSync(adapterPath,'utf8');
  assert.ok(/export default \{ game: 'fuse', maxInputs:/.test(src), 'ESM default export (worker imports it)');
  const r=PVP.simulate('ab12cd34',[1.0,0]);
  assert.strictEqual(typeof r.score,'number');
  assert.strictEqual(r.score, r.score|0, 'score must be an integer');
  assert.strictEqual(typeof r.valid,'boolean');
});
T('seed mapping = FUSE_SIM.hashSeed(String(seed)) — verbatim, case-sensitive', ()=>{
  for(const s of ['00','deadbeef','A3F9','a3f9','7fffffff00112233']){
    assert.strictEqual(seedToUint32(s), SIM.hashSeed(s));
  }
  assert.notStrictEqual(seedToUint32('A3F9'), seedToUint32('a3f9'), 'seed string is opaque/verbatim');
});

console.log('\n— score parity: generated adapter vs fuse/sim.js direct —');
T('700 random-walk logs: identical scores + deterministic', ()=>{
  const rng=SIM.mulberry32(0xC0FFEE);
  let valids=0, rejected=0;
  for(let k=0;k<700;k++){
    const hex=randHex(rng, 8+Math.floor(rng()*25));
    let log=randomLog(rng);
    const probe=SIM.simulate(SIM.hashSeed(hex), log);
    if(k%7!==0) log=log.slice(0, probe.used*2); // honest client: log stops at death
    if(log.length<2) continue;
    const a=PVP.simulate(hex,log);
    const b=PVP.simulate(hex,log);
    assert.deepStrictEqual(a,b,'adapter must be deterministic');
    const direct=SIM.simulate(SIM.hashSeed(hex), log);
    if(a.valid){ valids++;
      assert.strictEqual(a.score, direct.score, 'score mismatch seed='+hex);
      assert.strictEqual(a.meta.bestCut, direct.bestCut);
      assert.strictEqual(a.meta.deathT, direct.deathT);
    } else { rejected++;
      // only legit-invalid reason possible for these legal logs: trailing taps after death
      assert.strictEqual(a.reason,'taps_after_death','unexpected invalid reason '+a.reason+' seed='+hex);
      assert.ok(direct.used < log.length/2);
    }
  }
  assert.ok(valids>500,'random-walk corpus too degenerate ('+valids+' valid)');
  assert.ok(rejected>20,'untruncated slice must exercise the reject path ('+rejected+')');
});
T('400 greedy-bot duels: adapter === direct replay === live incremental play', ()=>{
  const rng=SIM.mulberry32(0xF05E);
  let valids=0;
  for(let k=0;k<400;k++){
    const hex=randHex(rng, 16);
    const seed32=SIM.hashSeed(hex);
    const r=botRun(seed32,{ greed:0.55+(k%40)/100, reaction:0.12+(k%5)*0.03, maxT:240 });
    if(!r.taps.length) continue;
    const a=PVP.simulate(hex, r.taps);
    const direct=SIM.simulate(seed32, r.taps);
    if(a.valid){ valids++;
      assert.strictEqual(a.score, direct.score, 'adapter vs direct seed='+hex);
      assert.strictEqual(a.score, r.live.score, 'adapter vs live play seed='+hex);
    } else {
      // a marathon bot can exceed the 1e6 plausibility cap — adapter must mirror it exactly
      assert.strictEqual(a.reason,'implausible','unexpected invalid reason '+a.reason+' seed='+hex);
      assert.ok(direct.score>1000000, 'cap rejection must match the direct sim score');
    }
  }
  assert.ok(valids>300,'bot corpus too degenerate ('+valids+' valid)');
});
T('same inputs, different duel seeds → different runs (sanity)', ()=>{
  const r=botRun(SIM.hashSeed('aaaa1111'));
  const a=PVP.simulate('aaaa1111', r.taps);
  const b=PVP.simulate('bbbb2222', r.taps);
  assert.ok(a.valid);
  assert.ok(!b.valid || b.score!==a.score, 'a foreign seed must not replay to the same verified run');
});

console.log('\n— validity edges —');
const goodHex='1f2e3d4c';
const goodSeed32=SIM.hashSeed(goodHex);
const good=botRun(goodSeed32);
T('legit bot log → valid', ()=>{ assert.strictEqual(PVP.simulate(goodHex, good.taps).valid, true); });
T('taps after the run ended → valid=false', ()=>{
  const d=SIM.simulate(goodSeed32, good.taps);
  const t0=SIM.q5(Math.max(good.taps[good.taps.length-2], d.deathT)+1);
  const tampered=good.taps.concat([t0,0, SIM.q5(t0+1),1, SIM.q5(t0+2),2]);
  const r=PVP.simulate(goodHex, tampered);
  assert.strictEqual(r.valid,false);
  assert.strictEqual(r.reason,'taps_after_death');
  assert.strictEqual(r.score,0);
});
T('out-of-order times → valid=false', ()=>{
  const bad=good.taps.slice();
  if(bad.length>=4){ const tmp=bad[0]; bad[0]=bad[2]; bad[2]=tmp; }
  const r=PVP.simulate(goodHex,bad);
  assert.strictEqual(r.valid,false);
  assert.strictEqual(r.reason,'not_ascending');
});
T('impossible tap rate (20 taps inside 1.2s) → valid=false', ()=>{
  const burst=[]; for(let i=0;i<24;i++) burst.push(SIM.q5(1+i*0.05), i%4);
  const r=PVP.simulate(goodHex,burst);
  assert.strictEqual(r.valid,false);
  assert.strictEqual(r.reason,'inhuman_rate');
});
T('malformed logs → valid=false (empty · bad lane · bad time · >3000 taps · not array)', ()=>{
  assert.strictEqual(PVP.simulate(goodHex,[]).valid,false);
  assert.strictEqual(PVP.simulate(goodHex,[1,7]).valid,false);
  assert.strictEqual(PVP.simulate(goodHex,[1,-1]).valid,false);
  assert.strictEqual(PVP.simulate(goodHex,[1,1.5]).valid,false);
  assert.strictEqual(PVP.simulate(goodHex,[NaN,0]).valid,false);
  assert.strictEqual(PVP.simulate(goodHex,[8000,0]).valid,false);
  const huge=[]; for(let i=0;i<3001;i++) huge.push(i*2,0);
  assert.strictEqual(PVP.simulate(goodHex,huge).valid,false);
  assert.strictEqual(PVP.simulate(goodHex,'nope').valid,false);
  assert.strictEqual(PVP.simulate(goodHex,null).valid,false);
});
T('bad seed → valid=false (null · empty · oversized)', ()=>{
  assert.strictEqual(PVP.simulate(null, good.taps).valid,false);
  assert.strictEqual(PVP.simulate(undefined, good.taps).valid,false);
  assert.strictEqual(PVP.simulate('', good.taps).valid,false);
  assert.strictEqual(PVP.simulate('f'.repeat(300), good.taps).valid,false);
});
T('shift-everything-deeper forgery cannot outscore unpunished', ()=>{
  const legit=PVP.simulate(goodHex, good.taps);
  const shifted=good.taps.map((v,i)=> i%2===0 ? SIM.q5(v+0.6) : v);
  const cheat=PVP.simulate(goodHex, shifted);
  const dl=SIM.simulate(goodSeed32, good.taps), dc=SIM.simulate(goodSeed32, shifted);
  assert.ok(!cheat.valid || dc.deathT<=dl.deathT+1e-9 || dc.cuts<dl.cuts,
    'riding deeper must bomb earlier, cut less, or be invalid');
  assert.ok(legit.valid);
});
T('adapter never trusts a client score (no score-shaped input is read)', ()=>{
  const tpl=fs.readFileSync(path.join(here,'..','api','pvp-adapter.template.js'),'utf8');
  assert.ok(!/inputs\.score|body\.score|b\.score/.test(tpl), 'adapter must only consume seed + inputs');
});

console.log('\n— regen idempotence —');
T('running build-pvp.js twice → byte-identical output', ()=>{
  execFileSync(process.execPath,[buildPath]);
  const one=fs.readFileSync(adapterPath);
  execFileSync(process.execPath,[buildPath]);
  const two=fs.readFileSync(adapterPath);
  assert.ok(one.equals(two), 'regen must be deterministic (no timestamps/randomness)');
});
await (async()=>{ try{
  const P2=(await import(pathToFileURL(adapterPath).href+'?regen='+Date.now())).default; // cache-busted re-import
  assert.deepStrictEqual(P2.simulate(goodHex, good.taps), PVP.simulate(goodHex, good.taps));
  passed++; console.log('  ✓ regenerated adapter still loads + scores identically');
}catch(e){ failed++; console.log('  ✗ regenerated adapter still loads + scores identically — '+(e&&e.message)); } })();

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
