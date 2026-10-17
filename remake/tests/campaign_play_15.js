// include: campaign_bot.js
// Mission 15 "New World Order" played by script: after the opening film sc_7010 (quest "The Core of the Problem")
// the army marches to the first pumping station (film ms_7026: the countdown starts, quest "Countdown of Death") and
// takes the five stations one after the other, leaving two soldiers to hold each; with all five held the countdown
// stops and the crater opens (sequence sc_7040). Béla, Cole, Stina and Taslow walk into the crater (quest "The Core of
// the Problem"); the film sc_7041 ends the mission. The base trains soldiers meanwhile. The side quests are left alone.
//   python3 tests/evaljs.py tests/campaign_play_15.js "&campaign=15"           (&tribe=Ninigi: with another tribe)
// Cheats (campaign_bot.js): the player's units are healed, enemies near the player's fighters are worn down, a unit
// that makes no progress for 60 s is teleported (all counted and reported).
const FOUR = ['Bela_s0', 'Cole_s0', 'special_eusmilus', 'tesla_s0'];
const four = () => FOUR.map(unit).filter(Boolean);
const foe = (e) => !!e.owner && e.owner !== me && !me.isFriend(e.owner);
const ORDER = [1, 3, 2, 4, 5];
const held = (n) => Number(C.variables.get('ctrlpt0' + n)) === 1;
const point = (n) => 'controlpoint_0' + n;
// two soldiers stay at every station the player holds. They hold their ground and fight only what enters the
// station: a station is lost as soon as none of the player's objects stands in it while an enemy does
// (Gc0Nb#lose_ctrlpt_0N)
const GARRISON = 2;
const garrison = new Map();
const guards = () => [...garrison.values()].flat();
const army = () => fighters().filter((u) => !guards().includes(u) && u.name !== 'lovelace_s0');
function hold() {
  for (const n of ORDER) {
    if (!held(n)) continue;
    let g = (garrison.get(n) || []).filter((u) => u.alive);
    if (g.length < GARRISON) g = g.concat(army().filter((u) => !FOUR.includes(u.name)).slice(0, GARRISON - g.length));
    garrison.set(n, g);
    for (const u of g) u.stance = 0;            // hold ground: shoot what comes in range, never chase it out
    if (g.length && !hunt(g, (e) => foe(e) && e.kind === 'unit' && inRegion(e, point(n)), 'guard' + n)) goRegion(g, point(n), 'guard' + n);
  }
}
function base() {
  gather();
  housing();
  if (workers().length < 8) produce('hu_worker', 1);
  if (fighters().length >= 30) return;
  // the stations need guards faster than the volcano's few food sources feed them: the stock is topped up while
  // nothing is being trained or researched (a cheat, counted) - enough for an epoch, which the Dragon Clan's next
  // hammock (room for more units) and the Dustriders' warriors wait for
  const short = ORDER.filter(held).some((k) => (garrison.get(k) || []).filter((u) => u.alive).length < GARRISON);
  if (short && ![...myBuildings(), ...mine()].some((b) => b.queue && b.queue.length)) topUp({ food: 800, wood: 800, stone: 800 });
  produce('hu_warrior', 1); produce('hu_archer', 1);
}
// the army takes the next station: what stands in it or within 25 m of the army is fought, then it walks on - but
// first it stays at a held station that has fewer guards than it needs, until the base has sent them
function take() {
  const weak = ORDER.find((k) => held(k) && (garrison.get(k) || []).filter((u) => u.alive).length < GARRISON);
  const n = weak || ORDER.find((k) => !held(k));
  if (!n) return;
  const a = army();
  if (!a[0]) return;
  if (!hunt(a, (e) => foe(e) && e.kind === 'unit' && (e.distTo(a[0]) < 25 || inRegion(e, point(n))), 'army')) goRegion(a, point(n), 'army');
}
const steps = [
  ['the opening film sc_7010: quest "The Core of the Problem"', () => {}, () => questState('L15MQ01') === 'open', 120],
  // the film plays when the player comes near a station (S02#7026: any of the ovals of region sc_7026 around them,
  // not the station itself): the army walks to the one before the first station, fighting what it meets
  ['the army reaches the first pumping station: film ms_7026, quest "Countdown of Death"', () => {
    base();
    const a = army();
    if (a[0] && !hunt(a, (e) => foe(e) && e.kind === 'unit' && e.distTo(a[0]) < 25, 'army')) go(a, 380, 722, 'army');
  }, () => questState('L15MQ02') === 'open', 1500],
  ['the five pumping stations are taken and held: the countdown stops, sequence sc_7040 (quest "Countdown of Death")', () => { base(); hold(); take(); }, () => questState('L15MQ02') === 'done', 3400],
  ['Béla, Cole, Stina and Taslow walk into the crater: quest "The Core of the Problem"', () => {
    base(); hold();
    const f = four();
    if (!hunt(f, (e) => foe(e) && e.kind === 'unit' && e.distTo(f[0]) < 25, 'heroes')) goRegion(f, 'exit', 'heroes');
  }, () => questState('L15MQ01') === 'done', 1500],
  ['the film sc_7041 ends the mission', () => {}, () => G.over, 300],
];
runSteps(steps);
ok(!G.over || (G.endInfo && G.endInfo.won === true), 'QUIT: the mission is won');
return report({ 2: 'S02#7026', 3: 'S07#7040', 4: 'L01b#mq01_done', 5: 'S08#7041' }) + '\n   won: ' + JSON.stringify(G.endInfo) +
  `\n   population ${me.units}/${me.maxUnits}, epoch ${me.epoch()}` +
  '\n   variables: ' + ['ctrlpts', 'ctrlpt01', 'ctrlpt02', 'ctrlpt03', 'ctrlpt04', 'ctrlpt05', 'cntdwn_aborted', 'blocker'].map((n) => n + '=' + C.variables.get(n)).join(' ');
