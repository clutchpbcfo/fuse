/* ============================================================================
   FUSE — shared deterministic sim. SINGLE SOURCE OF TRUTH.
   Loaded by the client (<script src="sim.js">), injected VERBATIM into
   api/worker.js by api/build.js, and required by test/test.js.
   DO NOT fork this logic anywhere. Integer/rational math only — no
   transcendentals — so results are bit-identical across JS engines.
   ========================================================================== */
const FUSE_SIM = (function(){
'use strict';

const CFG = {
  epochUTC: Date.UTC(2026,5,9),        // Daily Box #1 = 2026-06-09 UTC
  lanes: 4,
  firstSpawnT: 0.6,
  lvlSec: 9,                            // BOX level = floor(gt / lvlSec)
  spawnBase: 2.3, spawnDecay: 0.93, spawnMin: 0.62, spawnRetry: 0.25,
  durMin0: 2.2, durMax0: 3.2, durDecay: 0.93, durFloorMin: 0.85, durFloorMax: 1.25,
  minCut: 0.25, coldMax: 0.5, hotMin: 0.8,
  basePts: 1000,                        // base = floor(basePts * p^3)
  flats: [[0.995,500],[0.97,300],[0.92,150],[0.80,50]],   // sorted desc
  flatNames: ['LAST GASP','INSANE','RAZOR','HOT'],
  streakStep: 0.25, streakCap: 12,
  types: [
    { id:'NORM',  speed:1,   mult:1 },
    { id:'FLASH', speed:1.6, mult:2 },                    // unlocks BOX 3
    { id:'RIDER', speed:0.6, mult:3 },                    // unlocks BOX 4 (gold)
    { id:'STUT',  speed:1,   mult:2, lurch:1.35, hold:0.35 } // unlocks BOX 5
  ],
  maxConcAt: [1,3,6],                   // BOX thresholds → concurrency 2,3,4
  maxT: 7200, simCapAfterLastTap: 60,
  maxTaps: 3000, burstN: 20, burstWindow: 1.2
};

function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function hashSeed(s){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function dailySeed(day){ return hashSeed('FUSE-daily-'+day); }
function dayNumber(){ const d=new Date(); const t=Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()); return Math.floor((t-CFG.epochUTC)/86400000)+1; }
function q5(t){ return Math.round(t*100000)/100000; }
function levelAt(t){ return Math.floor(t/CFG.lvlSec); }
function maxConc(lvl){ let c=1; for(let i=0;i<CFG.maxConcAt.length;i++) if(lvl>=CFG.maxConcAt[i]) c++; return c; }
function spawnInterval(lvl){ let v=CFG.spawnBase; for(let i=0;i<lvl;i++) v*=CFG.spawnDecay; return v<CFG.spawnMin?CFG.spawnMin:v; }
function durRange(lvl){ let lo=CFG.durMin0, hi=CFG.durMax0; for(let i=0;i<lvl;i++){ lo*=CFG.durDecay; hi*=CFG.durDecay; } if(lo<CFG.durFloorMin) lo=CFG.durFloorMin; if(hi<CFG.durFloorMax) hi=CFG.durFloorMax; return [lo,hi]; }
function typeIndexFor(lvl, r){
  const wF = lvl>=3?0.22:0, wR = lvl>=4?0.06:0, wS = lvl>=5?0.16:0;
  const wN = 1-wF-wR-wS;
  if(r < wN) return 0; r -= wN;
  if(r < wF) return 1; r -= wF;
  if(r < wR) return 2;
  return 3;
}
function progressAt(f, t){
  const ty = CFG.types[f.ti];
  let e = t - f.t0; if(e<=0) return 0;
  if(ty.lurch){
    const t1 = f.pStop*f.dur;
    if(e <= t1) return e/f.dur;
    e -= t1;
    if(e <= ty.hold) return f.pStop;
    e -= ty.hold;
    const p = f.pStop + (e*ty.lurch)/f.dur;
    return p>1?1:p;
  }
  const p = e/f.dur;
  return p>1?1:p;
}

/* Incremental machine. The client PLAYS on this; the server REPLAYS on it. */
function Sim(seed){
  this.seed = seed>>>0;
  this.rng = mulberry32(this.seed);
  this.t = 0;
  this.fuses = [null,null,null,null];
  this.nextSpawnT = CFG.firstSpawnT;
  this.score=0; this.cuts=0; this.streak=0; this.maxStreak=0;
  this.bestCut=0; this.razors=0; this.golds=0; this.whiffs=0; this.colds=0;
  this.dead=false; this.deathT=-1; this.deathLane=-1;
  this.onEvent=null; // optional renderer hook — MUST NOT affect state
}
Sim.prototype.advance = function(toT){
  if(this.dead) return;
  if(toT > CFG.maxT) toT = CFG.maxT;
  for(;;){
    let bombT = Infinity, bombLane = -1;
    for(let i=0;i<CFG.lanes;i++){ const f=this.fuses[i]; if(f && f.bombT < bombT){ bombT=f.bombT; bombLane=i; } }
    const st = this.nextSpawnT;
    if(st <= toT && st < bombT){
      const lvl = levelAt(st);
      const conc = maxConc(lvl);
      let active=0; const free=[];
      for(let i=0;i<CFG.lanes;i++){ if(this.fuses[i]) active++; else free.push(i); }
      if(active >= conc || free.length===0){ this.nextSpawnT = st + CFG.spawnRetry; continue; }
      const r1=this.rng(), r2=this.rng(), r3=this.rng(), r4=this.rng(), r5=this.rng();
      const lane = free[Math.floor(r1*free.length)];
      const ti = typeIndexFor(lvl, r2);
      const dr = durRange(lvl);
      const ty = CFG.types[ti];
      const dur = (dr[0] + r3*(dr[1]-dr[0])) / ty.speed;
      const f = { lane:lane, t0:st, dur:dur, ti:ti, pStop:0.45 + r4*0.2, bombT:0 };
      f.bombT = ty.lurch ? (st + f.pStop*dur + ty.hold + ((1-f.pStop)*dur)/ty.lurch) : (st + dur);
      this.fuses[lane] = f;
      this.nextSpawnT = st + spawnInterval(lvl) * (0.75 + r5*0.5);
      if(this.onEvent) this.onEvent('spawn', f);
      continue;
    }
    if(bombT <= toT){
      this.t = bombT; this.dead = true; this.deathT = bombT; this.deathLane = bombLane;
      if(this.onEvent) this.onEvent('bomb', this.fuses[bombLane]);
      return;
    }
    break;
  }
  this.t = toT;
};
Sim.prototype.tap = function(t, lane){
  if(this.dead) return null;
  this.advance(t);
  if(this.dead) return null;
  lane = lane|0;
  if(lane<0 || lane>=CFG.lanes) return null;
  const f = this.fuses[lane];
  if(!f){
    this.streak = 0; this.whiffs++;
    if(this.onEvent) this.onEvent('whiff', lane);
    return { whiff:true, lane:lane };
  }
  const p = progressAt(f, t);
  this.fuses[lane] = null;
  this.cuts++;
  const ty = CFG.types[f.ti];
  let pts = 0, label = 'COLD';
  if(p < CFG.minCut){
    this.streak = 0; this.colds++;
  } else {
    if(p >= CFG.hotMin){ this.streak++; if(this.streak>this.maxStreak) this.maxStreak=this.streak; }
    else if(p < CFG.coldMax){ this.streak = 0; }
    let flat = 0; label = 'CUT';
    for(let i=0;i<CFG.flats.length;i++){ if(p >= CFG.flats[i][0]){ flat = CFG.flats[i][1]; label = CFG.flatNames[i]; break; } }
    const base = Math.floor(CFG.basePts * p*p*p);
    const mult = 1 + CFG.streakStep * Math.min(this.streak, CFG.streakCap);
    pts = Math.floor((base + flat) * mult * ty.mult);
    this.score += pts;
  }
  const pm = Math.floor(p*1000); if(pm > this.bestCut) this.bestCut = pm;
  if(p >= 0.92) this.razors++;
  if(ty.id==='RIDER' && p >= 0.95) this.golds++;
  const res = { whiff:false, lane:lane, p:p, pts:pts, label:label, ti:f.ti, streak:this.streak, fuse:f };
  if(this.onEvent) this.onEvent('cut', res);
  return res;
};

/* taps = flat array [t0,lane0,t1,lane1,...] with times ascending (q5 game-time). */
function validateTaps(flat){
  if(!Array.isArray(flat)) return { ok:false, reason:'not_array' };
  if(flat.length % 2 !== 0) return { ok:false, reason:'odd_length' };
  const n = flat.length/2;
  if(n < 1) return { ok:false, reason:'empty' };
  if(n > CFG.maxTaps) return { ok:false, reason:'too_many' };
  let prev = 0;
  const times = [];
  for(let i=0;i<flat.length;i+=2){
    const t = flat[i], lane = flat[i+1];
    if(typeof t!=='number' || !isFinite(t) || t<0 || t>CFG.maxT) return { ok:false, reason:'bad_time' };
    if(typeof lane!=='number' || (lane|0)!==lane || lane<0 || lane>=CFG.lanes) return { ok:false, reason:'bad_lane' };
    if(t < prev) return { ok:false, reason:'not_ascending' };
    prev = t; times.push(t);
  }
  for(let i=CFG.burstN-1;i<times.length;i++){
    if(times[i] - times[i-(CFG.burstN-1)] < CFG.burstWindow) return { ok:false, reason:'inhuman_rate' };
  }
  return { ok:true, n:n };
}

/* Authoritative replay. */
function simulate(seed, flat){
  const sim = new Sim(seed);
  let prev = 0, minGap = Infinity, n = 0;
  if(Array.isArray(flat)){
    for(let i=0;i+1<flat.length;i+=2){
      const t = flat[i], lane = flat[i+1];
      if(typeof t!=='number' || !isFinite(t) || t<0 || t>CFG.maxT) break;
      if(typeof lane!=='number' || (lane|0)!==lane || lane<0 || lane>=CFG.lanes) break;
      if(t < prev) break;
      if(n>0){ const g=t-prev; if(g<minGap) minGap=g; }
      prev = t; n++;
      sim.tap(t, lane);
      if(sim.dead) break;
    }
  }
  if(!sim.dead){
    sim.advance(prev + CFG.simCapAfterLastTap);
    if(!sim.dead){ sim.dead = true; sim.deathT = sim.t; }
  }
  return {
    score:sim.score, cuts:sim.cuts, bestCut:sim.bestCut, razors:sim.razors, golds:sim.golds,
    maxStreak:sim.maxStreak, lvl:levelAt(sim.deathT<0?sim.t:sim.deathT), deathT:sim.deathT,
    used:n, minGap:minGap, whiffs:sim.whiffs, colds:sim.colds
  };
}

return { CFG:CFG, Sim:Sim, simulate:simulate, validateTaps:validateTaps, progressAt:progressAt,
         mulberry32:mulberry32, hashSeed:hashSeed, dailySeed:dailySeed, dayNumber:dayNumber,
         q5:q5, levelAt:levelAt, maxConc:maxConc, spawnInterval:spawnInterval, durRange:durRange };
})();
if(typeof module!=='undefined' && module.exports) module.exports = FUSE_SIM;
