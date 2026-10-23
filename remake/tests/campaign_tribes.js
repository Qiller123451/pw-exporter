// A campaign mission played with another tribe (game/campaign/tribes.js): load with
//   python3 tests/evaljs.py tests/campaign_tribes.js "&campaign=<id>&tribe=<Hu|Aje|Ninigi|SEAS>"
// and check that the player is that tribe, owns only that tribe's units and buildings (heroes and Special objects
// aside), that class queries of the mission's tribe find the equivalents, and that the mission runs a while.
const C = G.campaign, W = G.world, me = G.me;
const out = [];
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const want = C.chosenTribe;
check('the player is the chosen tribe', me.tribe === want && (!C.swap || C.swap.from === C.missionTribe), { tribe: me.tribe, mission: C.missionTribe });
const prefix = (n) => (/^([a-z]+)_/.exec(String(n).toLowerCase()) || [])[1] || '';
const own = W.entitiesOf(me);
const foreign = own.filter((e) => ['hu', 'aje', 'ninigi', 'seas'].includes(prefix(e.name)) && prefix(e.name) !== want.toLowerCase());
const kept = foreign.filter((e) => C.swap && C.swap.equivalent(e.name) === null);
check('everything of the player is the chosen tribe\'s (or has no equivalent)', foreign.length === kept.length,
  { own: own.length, foreign: foreign.map((e) => e.name), kept: kept.map((e) => e.name) });
// a query for the mission tribe's worker / main building finds the player's equivalents
const T = C.missionTribe.toLowerCase();
const worker = { hu: 'hu_worker', aje: 'aje_worker', ninigi: 'ninigi_worker', seas: 'seas_worker' }[T];
const workers = C.objects.select({ obj_class: worker, obj_owner: String(C.humanSlot) });
const mine = own.filter((e) => e.def && /_worker$/.test(e.name)).length;
check(`a query for ${worker} of the player finds the chosen tribe's workers`, workers.length === mine, { found: workers.length, workers: mine });
// a class without an equivalent keeps its class: objectives about it are met (BLDG met, see conditions.js)
const engine = C.engine;
const t0 = W.time;
for (let i = 0; i < 60; i++) G.step(10, 0.1);
check('the mission runs (60 s, no trigger errors)', W.time > t0 + 50 && !(C.errors || []).length && !G.over, { t: Math.round(W.time), errors: (C.errors || []).slice(0, 3), over: G.over, end: G.endInfo });
check('nothing is missing', !C.warnings.some((w) => /could not be created for the player|start army unit not created|start building not created/.test(w)), C.warnings.slice(0, 8));
// a ban of the level that the chosen tribe's equivalent shares with a class the level allows does not take the
// equivalent away (tribes.js filters): the Dustriders' first mission bans the clay wall and its gate, not the bone
// palisade and its gate - the SEAS keep their fence and gate
{
  const fs = (me.data && me.data.tech_filters) || [];
  const bans = fs.filter((f) => /AntiActions\/[A-Za-z]+\/Build\//.test(f)).map((f) => f.split('/').pop().trim().toLowerCase());
  if (C.swap && bans.length) {
    const kept = [];
    const sources = G.data.foreignActions(me, C.missionTribe).filter((a) => a.kind === 'Build' && a.results[0]).map((a) => a.results[0].obj);
    for (const b of bans) {
      const e = (C.swap.equivalent(b) || '').toLowerCase();
      if (e && sources.some((c) => !bans.includes(c.toLowerCase()) && (C.swap.equivalent(c) || '').toLowerCase() === e)) kept.push(e);
    }
    const acts = G.data.actions(me).filter((a) => a.results && a.results[0]);
    const lost = kept.filter((e) => !acts.some((a) => a.results[0].obj.toLowerCase() === e && a.visible !== false && !a.disabled));
    check('a ban shared with an allowed class keeps the equivalent', !lost.length, { kept, lost });
  }
}
return out.join('\n') + '\n   engine: ' + (engine ? 'on' : 'off') + ', units ' + own.filter((e) => e.kind === 'unit').map((e) => e.name).slice(0, 14).join(' ') +
  '\n   buildings ' + own.filter((e) => e.kind === 'building').map((e) => e.name).join(' ');
