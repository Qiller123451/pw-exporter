// A generic "player" for every mission in the mock world (node tests/campaign_bot_mock.mjs [folder] [minutes]):
// every 10 s the player's fighters jump to the next region that a listening REGN condition asks player 0 to be in,
// and everything hostile within 40 m of them dies; every ten minutes everything hostile on the map dies. It knows
// nothing about the story, so it does not finish most missions - the point is coverage: it drives each mission's
// triggers much further than a mission that is left alone (spawns, owner changes, AI orders, sequences ...), and
// no action or condition may throw on the way. One line per mission.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeGame } from './campaign_mock.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] || process.env.PW_CPN || path.join(here, '..', '..', '_notes', 'cpn');
const minutes = +(process.argv[3] || 40);
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^single_\d+\.json$/.test(f)).sort() : [];
if (!files.length) console.log('   (no mission dumps in ' + dir + ': skipped)');
let fails = 0;
for (const f of files) {
  const id = +f.match(/\d+/)[0];
  let G, err = null;
  try {
    G = makeGame(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), { id });
    const C = G.campaign, W = G.world, E = C.engine, me = C.human;
    let k = 0;
    for (let s = 0; s < minutes * 60 && !G.over; s++) {
      G.step(20, 0.05);
      const mine = W.units.filter((u) => u.alive && u.owner === me && !u.parked && !u.isWorker);
      for (const u of W.units) if (u.alive && u.owner === me) u.hp = u.maxHp;
      if (s % 10 === 5 && mine.length) {
        // the regions the mission wants somebody of the player in, right now
        const want = [];
        for (const t of E.triggers) if (t.live) for (const c of t.conds) {
          if (c.type !== 'REGN' || c.state || !c.regional() || !/^(>|>=|=|==)?\s*[1-9]|^>0|^>=1/.test(String(c.p.obj_count || '').trim() || '1')) continue;
          const o = String(c.p.obj_owner == null ? '-2' : c.p.obj_owner);
          if (o !== '0' && !/_s0$|special_eusmilus/i.test(String(c.p.obj_class || '')) && !(c.p.obj_name && C.objects.get(c.p.obj_name) && C.objects.get(c.p.obj_name).slot === 0)) continue;
          const r = C.regions.find(c.p.rgn_guid), ctr = r && r.center();
          if (ctr) want.push(ctr);
        }
        if (want.length) { const [x, z] = want[k++ % want.length]; for (const u of W.units) if (u.alive && u.owner === me && !u.parked) { u.pos.x = x + (u.id % 5) - 2; u.pos.z = z + ((u.id >> 3) % 5) - 2; u.goal = null; u.chase = null; } }
      }
      const all = s % 600 === 599;
      for (const e of [...W.units, ...W.buildings]) {
        if (!e.alive || e.parked || e.invulnT > 0 || !e.owner || !me.isEnemy(e.owner)) continue;
        if (all || mine.some((u) => Math.hypot(u.pos.x - e.pos.x, u.pos.z - e.pos.z) < 40)) W.kill(e);
      }
    }
  } catch (e) { err = e; }
  if (err) { fails++; console.log(`FAIL ${f}: ${err.stack || err}`); continue; }
  const C = G.campaign, S = C.debug.summary(), Q = C.debug.quests();
  const unk = [...S.unknownConditions, ...S.unknownActions];
  const good = !unk.length && !C.errors.length;
  if (!good) fails++;
  console.log(`${good ? 'ok' : 'FAIL'} mission ${String(id).padStart(2)}: ${S.firedTriggers}/${S.triggers} triggers fired (${S.firings} firings, ${S.actions} actions) in ${Math.round(G.world.time / 60)} min; quests done ${Q.filter((q) => q.accomplished).length}/${Q.length}, failed ${Q.filter((q) => q.unaccomplishable).length}; ` +
    `sequences ${G.mission.log.filter((l) => l[0] === 'sequence').length}, dialogues ${G.mission.log.filter((l) => l[0] === 'dialog').length}; ${S.ended ? (S.ended.won ? 'WON' : 'lost' + (S.ended.reason ? ' (' + S.ended.reason + ')' : '')) + ' at ' + Math.round(S.ended.t / 60) + ' min' : 'not ended'}; errors ${C.errors.length}${unk.length ? ', unknown ' + unk.join(' ') : ''}`);
  for (const e of C.errors.slice(0, 4)) console.log('     error: ' + JSON.stringify(e));
}
process.exit(fails ? 1 : 0);
