# fuse-api — FUSE leaderboard backend (CF Worker + D1)

Server-authoritative replay anti-cheat (PULSE pattern, build-enforced parity):
`worker.js` is GENERATED — `node build.js` injects `../sim.js` verbatim between
the `__FUSE_SIM_START__/__FUSE_SIM_END__` markers in `worker.template.js`.
Never edit `worker.js` directly; edit `sim.js` or the template, re-run build,
re-run tests (`node ../test/test.js`), redeploy.

## Deploy (CF REST API, no wrangler needed — proven nerve/pulse playbook)
Account `86878bdf15d73a2eb4a0c41d7a1870e0`, subdomain `clutchpbcfo`. With a
transient CF API token (never committed):
1. Create D1: `POST /client/v4/accounts/{acct}/d1/database {"name":"fuse-leaderboard"}` → grab `uuid`.
2. Schema: `POST .../d1/database/{uuid}/query` with `schema.sql` contents.
3. Put `database_id` into metadata binding, then upload worker:
   `PUT .../workers/scripts/fuse-api` (multipart: `metadata` JSON `{main_module:"worker.js", bindings:[{type:"d1",name:"DB",id:"<uuid>"}], compatibility_date:"2026-06-01"}` + `worker.js` as ES module part).
4. Enable subdomain: `POST .../workers/scripts/fuse-api/subdomain {"enabled":true}`.
5. Verify: `curl https://fuse-api.clutchpbcfo.workers.dev/health` → `{ok:true}`.

## Endpoints
- `GET /top?board=alltime|daily&day=N&handle=foo` → `{top:[{handle,score,bestcut}],rank,best}`
- `POST /submit {handle, board, day, seed, taps:[t,lane,...]}` → replays, stores OUR score
- `GET /health`

Guards: taps validated (ascending, lanes 0-3, ≤3000, ≤7200s, 20-tap burst window ≥1.2s),
daily locked to true daily seed + today/yesterday, score cap 1e6, ≥1 cut.
