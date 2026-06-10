#!/usr/bin/env node
/* FUSE test suite — determinism, client/server parity, anti-cheat, solvability, scoring. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const SIM = require(path.join(__dirname, '..', 'sim.js'));

let passed = 0, failed = 0;
function T(name, fn){ try{ fn(); passed++; console.log('  ✓ ' + name); }catch(e){ failed++; console.log('  ✗ ' + name + ' — ' + (e && e.message)); } }

/* ---------- helpers: bots that PLAY on the incremental sim ---------- */
function botRun(seed, opts){
  const o = Object.assign({ greed:0.85, reaction:0.22, rate:0.13, panic:0.25, minWorth:0.3, maxT:400 }, opts||{});
  const sim = new SIM.Sim(seed);
  const taps = [];
  const notice = [Infinity,Infinity,Infinity,Infinity];
  let t = 0, lastTap = -10;
  while(!sim.dead && t < o.maxT){
    t = SIM.q5(t + 0.008);
    sim.advance(t);
    if(sim.dead) break;
    for(let i=0;i<4;i++){
      const f = sim.fuses[i];
      if(!f){ notice[i] = Infinity; continue; }
      const p = SIM.progressAt(f, t);
      const ttb = f.bombT - t;
      if(notice[i] === Infinity && (p >= o.greed || (ttb < o.panic && p >= o.minWorth))) notice[i] = t;
    }
    if(t - lastTap < o.rate) continue;
    let pick = -1, pickBomb = Infinity;
    for(let i=0;i<4;i++){
      const f = sim.fuses[i];
      if(!f || notice[i] === Infinity) continue;
      if(t >= notice[i] + o.reaction && f.bombT < pickBomb){ pickBomb = f.bombT; pick = i; }
    }
    if(pick >= 0){
      taps.push(t, pick);
      sim.tap(t, pick);
      notice[pick] = Infinity;
      lastTap = t;
    }
  }
  return { taps, live:{ score:sim.score, cuts:sim.cuts, bestCut:sim.bestCut, dead:sim.dead, deathT:sim.deathT } };
}

console.log('\n— determinism —');
T('simulate twice = identical (100 random runs)', ()=>{
  for(let k=0;k<100;k++){
    const seed = (Math.random()*0xffffffff)>>>0;
    const r = botRun(seed, { greed:0.6+Math.random()*0.3 });
    const a = SIM.simulate(seed, r.taps);
    const b = SIM.simulate(seed, r.taps);
    assert.deepStrictEqual(a, b);
  }
});
T('live incremental play === server replay (150 seeds)', ()=>{
  for(let k=0;k<150;k++){
    const seed = (1000+k*7919)>>>0;
    const r = botRun(seed);
    const rep = SIM.simulate(seed, r.taps);
    assert.strictEqual(rep.score, r.live.score, 'score live='+r.live.score+' replay='+rep.score+' seed='+seed);
    assert.strictEqual(rep.cuts, r.live.cuts);
    assert.strictEqual(rep.bestCut, r.live.bestCut);
  }
});
T('daily seed is stable + replay-locked', ()=>{
  const day = 17;
  const s1 = SIM.dailySeed(day), s2 = SIM.dailySeed(day);
  assert.strictEqual(s1, s2);
  const r = botRun(s1);
  assert.strictEqual(SIM.simulate(s1, r.taps).score, r.live.score);
});

console.log('\n— client/server parity (build-enforced) —');
const workerPath = path.join(__dirname, '..', 'api', 'worker.js');
T('worker.js exists (run api/build.js first)', ()=>{ assert.ok(fs.existsSync(workerPath), 'run node api/build.js'); });
T('worker.js contains sim.js VERBATIM', ()=>{
  const simSrc = fs.readFileSync(path.join(__dirname, '..', 'sim.js'), 'utf8');
  const w = fs.readFileSync(workerPath, 'utf8');
  assert.ok(w.includes(simSrc), 'sim block in worker differs from sim.js — rerun api/build.js');
});
T('worker-extracted sim is functionally identical (200 cases)', ()=>{
  const w = fs.readFileSync(workerPath, 'utf8');
  const START='/*__FUSE_SIM_START__*/', END='/*__FUSE_SIM_END__*/';
  const block = w.slice(w.indexOf(START)+START.length, w.indexOf(END));
  const WSIM = new Function('module', block + '\nreturn FUSE_SIM;')({exports:{}});
  for(let k=0;k<200;k++){
    const seed = (777+k*104729)>>>0;
    const r = botRun(seed, { greed:0.55+ (k%40)/100 });
    assert.deepStrictEqual(WSIM.simulate(seed, r.taps), SIM.simulate(seed, r.taps));
  }
});
T('worker never reads a client-claimed score', ()=>{
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'api', 'worker.template.js'), 'utf8');
  assert.ok(!/b\.score/.test(tpl), 'worker must not trust client score');
});

console.log('\n— anti-cheat guards —');
T('validateTaps: rejects descending times', ()=>{
  assert.strictEqual(SIM.validateTaps([1,0, 0.5,1]).ok, false);
});
T('validateTaps: rejects bad lane', ()=>{
  assert.strictEqual(SIM.validateTaps([1,4]).ok, false);
  assert.strictEqual(SIM.validateTaps([1,-1]).ok, false);
  assert.strictEqual(SIM.validateTaps([1,1.5]).ok, false);
});
T('validateTaps: rejects inhuman burst (20 taps in <1.2s)', ()=>{
  const flat=[]; for(let i=0;i<20;i++) flat.push(i*0.05, i%4);
  const v = SIM.validateTaps(flat);
  assert.strictEqual(v.ok, false); assert.strictEqual(v.reason, 'inhuman_rate');
});
T('validateTaps: accepts a real bot run', ()=>{
  const r = botRun(123456);
  assert.strictEqual(SIM.validateTaps(r.taps).ok, true);
});
T('validateTaps: rejects >3000 taps / bad time', ()=>{
  const flat=[]; for(let i=0;i<3001;i++) flat.push(i*2, 0);
  assert.strictEqual(SIM.validateTaps(flat).ok, false);
  assert.strictEqual(SIM.validateTaps([NaN,0]).ok, false);
  assert.strictEqual(SIM.validateTaps([8000,0]).ok, false);
});
T('tampered timeline cannot claim cuts after the bomb', ()=>{
  const seed = 9876543;
  const r = botRun(seed);
  const legit = SIM.simulate(seed, r.taps);
  const shifted = r.taps.map((v,i)=> i%2===0 ? SIM.q5(v+0.6) : v); // "ride everything 0.6s deeper"
  const cheat = SIM.simulate(seed, shifted);
  assert.ok(cheat.deathT <= legit.deathT + 1e-9 || cheat.cuts < legit.cuts,
    'shifting deeper must bomb earlier or cut less (legit '+legit.cuts+' cuts vs '+cheat.cuts+')');
});

console.log('\n— scoring math —');
T('first fuse: HOT cut at p≈0.9 scores by the formula', ()=>{
  const sim = new SIM.Sim(42);
  sim.advance(0.6);
  let lane=-1; for(let i=0;i<4;i++) if(sim.fuses[i]) lane=i;
  assert.ok(lane>=0, 'first fuse spawned at 0.6');
  const f = sim.fuses[lane];
  assert.strictEqual(f.ti, 0, 'BOX 0 spawns NORM only');
  const t = SIM.q5(f.t0 + 0.9*f.dur);
  const res = sim.tap(t, lane);
  assert.ok(Math.abs(res.p-0.9) < 1e-6);
  const base = Math.floor(1000*res.p*res.p*res.p);
  const expected = Math.floor((base+50) * (1+0.25*1) * 1);
  assert.strictEqual(res.pts, expected);
  assert.strictEqual(res.label, 'HOT');
  assert.strictEqual(sim.streak, 1);
});
T('COLD cut scores 0 and resets streak', ()=>{
  const sim = new SIM.Sim(42);
  sim.advance(0.6);
  let lane=-1; for(let i=0;i<4;i++) if(sim.fuses[i]) lane=i;
  const f = sim.fuses[lane];
  sim.streak = 5;
  const res = sim.tap(SIM.q5(f.t0 + 0.1*f.dur), lane);
  assert.strictEqual(res.pts, 0);
  assert.strictEqual(res.label, 'COLD');
  assert.strictEqual(sim.streak, 0);
});
T('whiff resets streak', ()=>{
  const sim = new SIM.Sim(42);
  sim.advance(0.6);
  let lane=-1; for(let i=0;i<4;i++) if(sim.fuses[i]) lane=i;
  sim.streak = 7;
  const empty = (lane+1)%4;
  const res = sim.tap(sim.t, empty);
  assert.strictEqual(res.whiff, true);
  assert.strictEqual(sim.streak, 0);
});
T('flat tiers ordered: deeper cut never scores less (same streak)', ()=>{
  const ps=[0.5,0.8,0.92,0.97,0.995];
  let prev=-1;
  for(const p of ps){
    const sim = new SIM.Sim(42);
    sim.advance(0.6);
    let lane=-1; for(let i=0;i<4;i++) if(sim.fuses[i]) lane=i;
    const f = sim.fuses[lane];
    const res = sim.tap(SIM.q5(f.t0 + p*f.dur), lane);
    assert.ok(res.pts > prev, p+' should outscore shallower cuts');
    prev = res.pts;
  }
});
T('letting a fuse reach the bomb kills the run', ()=>{
  const sim = new SIM.Sim(42);
  sim.advance(30);
  assert.strictEqual(sim.dead, true);
  assert.ok(sim.deathT > 0.6 && sim.deathT < 6, 'first untouched fuse bombs in a few seconds, got '+sim.deathT);
});

console.log('\n— ramp & type coverage —');
T('type variety + razor labels appear across bot runs', ()=>{
  const seenTi = new Set(); let razors=0;
  for(let k=0;k<40;k++){
    const sim = new SIM.Sim((31+k*2654435761)>>>0);
    sim.onEvent = (ev,d)=>{ if(ev==='spawn') seenTi.add(d.ti); };
    const r = botRun((31+k*2654435761)>>>0, { greed:0.9, reaction:0.16, rate:0.11 });
    razors += SIM.simulate((31+k*2654435761)>>>0, r.taps).razors;
    let t=0; while(!sim.dead && t<200){ t=SIM.q5(t+0.05); sim.advance(t); } // drive spawns for coverage too
  }
  assert.ok(razors > 0, 'a greedy bot lands razors');
  assert.ok(seenTi.has(0), 'NORM seen');
});
T('concurrency ramps 1→4 with BOX level', ()=>{
  assert.strictEqual(SIM.maxConc(0),1); assert.strictEqual(SIM.maxConc(1),2);
  assert.strictEqual(SIM.maxConc(3),3); assert.strictEqual(SIM.maxConc(6),4);
});

console.log('\n— solvability (bot distribution, 300 seeds) —');
{
  const human=[], perfect=[];
  for(let k=0;k<300;k++){
    const seed=(k*48271+11)>>>0;
    const h = botRun(seed, { greed:0.85, reaction:0.22, rate:0.13 });
    human.push(SIM.simulate(seed, h.taps).lvl);
    if(k<150){
      const p = botRun(seed, { greed:0.5, reaction:0.10, rate:0.09, panic:0.35 });
      perfect.push(SIM.simulate(seed, p.taps).lvl);
    }
  }
  human.sort((a,b)=>a-b); perfect.sort((a,b)=>a-b);
  const med=human[150], h10=human[30], h90=human[270];
  const pSurvive5 = perfect.filter(l=>l>=5).length/perfect.length;
  console.log('  human-bot death BOX: p10='+h10+' median='+med+' p90='+h90+' | perfect-bot ≥BOX5: '+(pSurvive5*100).toFixed(1)+'%');
  /* NOTE: the bot has flawless 4-lane parallel attention + constant 220ms reaction —
     a strict upper bound on humans, who fracture attention way earlier. The bound
     below is a fairness/sanity rail, not human difficulty calibration (that's tuned
     by hand-feel). */
  T('human-bot median death BOX in [3,14]', ()=>{ assert.ok(med>=3 && med<=14, 'median '+med); });
  T('no impossible early walls (perfect bot ≥BOX5 on ≥95% seeds)', ()=>{ assert.ok(pSurvive5>=0.95, (pSurvive5*100).toFixed(1)+'%'); });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
