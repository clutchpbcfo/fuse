// FUSE leaderboard API — server-authoritative scoring via deterministic replay.
// The client submits {handle, board, day, seed, taps:[t0,lane0,t1,lane1,...]}.
// This worker REPLAYS the run with the EXACT shared sim (injected verbatim from
// ../sim.js by build.js — DO NOT EDIT the block between the markers) and stores
// the score IT computes. A forged score is impossible without a valid,
// humanly-plausible input timeline.
//
// Endpoints:
//   GET  /top?board=alltime|daily&day=N&handle=foo
//   POST /submit {handle, board, day, seed, taps}
//   GET  /health

/*__FUSE_SIM_START__*/
/*__FUSE_SIM_END__*/

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

const SIM = FUSE_SIM;

async function topFor(env, key){
  const r = await env.DB.prepare("SELECT handle, MAX(score) AS score, MAX(bestcut) AS bestcut FROM scores WHERE board=? GROUP BY handle ORDER BY score DESC LIMIT 25").bind(key).all();
  return r.results || [];
}
async function rankFor(env, key, score){
  const r = await env.DB.prepare("SELECT COUNT(*)+1 AS rank FROM (SELECT handle, MAX(score) s FROM scores WHERE board=? GROUP BY handle) WHERE s > ?").bind(key, score).first();
  return r ? r.rank : null;
}

export default {
  async fetch(req, env){
    if(req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    try{
      if(url.pathname === '/health') return json({ ok:true, game:'FUSE' });

      if(url.pathname === '/top' && req.method === 'GET'){
        const board = url.searchParams.get('board') || 'alltime';
        const day = url.searchParams.get('day');
        const handle = (url.searchParams.get('handle')||'').toLowerCase().replace(/[^a-z0-9_\-]/g,'').slice(0,15);
        const key = (board==='daily' && day) ? ('daily:'+day) : 'alltime';
        const top = await topFor(env, key);
        let rank=null, best=null;
        if(handle){
          const b = await env.DB.prepare("SELECT MAX(score) AS best FROM scores WHERE board=? AND handle=?").bind(key, handle).first();
          best = b ? b.best : null;
          if(best!=null) rank = await rankFor(env, key, best);
        }
        return json({ board:key, top, rank, best });
      }

      if(url.pathname === '/submit' && req.method === 'POST'){
        const b = await req.json();
        const handle = String(b.handle||'').trim().toLowerCase().replace(/[^a-z0-9_\-]/g,'').slice(0,15);
        if(handle.length < 3) return json({ error:'bad_handle' }, 400);

        const v = SIM.validateTaps(b.taps);
        if(!v.ok) return json({ error:'bad_taps', reason:v.reason }, 400);

        const seed = (b.seed>>>0);
        const board = b.board==='daily' ? 'daily' : 'alltime';
        let key = 'alltime';
        if(board === 'daily'){
          const day = parseInt(b.day, 10);
          const today = Math.floor((Date.now() - SIM.CFG.epochUTC)/86400000) + 1;
          if(!(day === today || day === today-1)) return json({ error:'stale_day' }, 400);
          if(seed !== SIM.dailySeed(day)) return json({ error:'bad_seed' }, 400);
          key = 'daily:' + day;
        }

        // ===== THE anti-cheat: replay the run; trust only OUR result =====
        const sim = SIM.simulate(seed, b.taps);
        if(sim.cuts < 1) return json({ error:'no_cuts' }, 400);
        if(sim.score < 0 || sim.score > 1000000) return json({ error:'implausible' }, 400);

        const ts = Date.now();
        await env.DB.prepare("INSERT INTO scores (board,handle,score,bestcut,razors,lvl,ts) VALUES (?,?,?,?,?,?,?)")
          .bind(key, handle, sim.score, sim.bestCut, sim.razors, sim.lvl, ts).run();
        return json({ ok:true, score:sim.score, bestCut:sim.bestCut, razors:sim.razors, lvl:sim.lvl,
                      rank: await rankFor(env, key, sim.score), top: await topFor(env, key) });
      }

      return json({ error:'not_found' }, 404);
    }catch(e){ return json({ error: String(e && e.message || e) }, 500); }
  }
};
