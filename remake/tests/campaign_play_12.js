// include: campaign_bot.js
// Mission 12 "Sea Battles" played by script: after the opening film sc_4025 the army takes the telescope tower ruin
// (it becomes the player's) and guards it while the workers repair it (quest "The Telescope Tower", film sc_4030).
// Then the SEAS carrier ships come for 40 minutes (quest "The SEAS Storm"): the base grows (epoch 2, more workers),
// the harbour builds warships that wait on the carriers' way and go for every carrier (no more than three may get
// through); the land army guards the base. The film sc_4038 ends the mission. The side quests are left alone.
//   python3 tests/evaljs.py tests/campaign_play_12.js "&campaign=12"           (&tribe=Hu: with another tribe)
// Cheats (campaign_bot.js): the player's units are healed, enemies near the player's fighters are worn down, a unit
// that makes no progress for 60 s is teleported (all counted and reported).
const isShip = (u) => { const ix = Ru.info(u.name); return !!ix && ix.type === 'SHIP'; };
const ships = () => mine().filter(isShip);
const warships = () => ships().filter((u) => !/fishing|transport|catamaran/.test(u.name));
const army = () => fighters().filter((u) => !isShip(u));
const foe = (e) => !!e.owner && e.owner !== me && !me.isFriend(e.owner);
const ruin = () => named('ninigi_telescope_tower_ruins_4');
const carriers = (e) => e.name === 'seas_carrier_fake' && e.alive;
const escorts = (e) => /^seas_(submarine|helicopter)$/.test(e.name) && !!e.owner && e.owner !== me;
// where the fleet waits: on the carriers' way to the north-west bay (Gc05 / Gc07 waypoints)
const WAIT = [251, 281];
function base() {
  gather();
  housing();
  if (workers().length < 10) produce('ninigi_worker', 1);
  // the warships need epoch 2
  const boat = actionFor(own('ninigi_fire_boat'));
  const why = boat ? Ru.check(me, boat, null) : 'none';
  if (why === 'req' || why === 'hidden') produce('age_2', 1, 'Upgrades');
  else if (warships().length < 8) produce('ninigi_fire_boat', 1);
  // the land army stays by the main building and fights what comes near (the harbour too)
  const [hx, hz] = C.toGame(...homeAt()), a = army();
  if (a[0] && !hunt(a, (e) => foe(e) && e.kind === 'unit' && !isShip(e) && Math.hypot(e.pos.x - hx, e.pos.z - hz) < 110, 'army')) go(a, homeAt()[0] + 15, homeAt()[1] + 15, 'army');
}
function fleet() {
  const s = warships();
  if (!s.length) return;
  if (hunt(s, carriers, 'fleet')) return;
  if (hunt(s, (e) => escorts(e) && e.distTo(s[0]) < 40, 'fleet')) return;
  go(s, ...WAIT, 'fleet');
}
const steps = [
  ['the opening film sc_4025: quest "The Telescope Tower"', () => gather(), () => questState('L12MQ01') === 'open', 120],
  ['the army reaches the tower ruin: it becomes the player\'s', () => { gather(); goRegion(army(), 'TowerOwnerChange', 'army'); }, () => !!ruin() && ruin().owner === me, 900],
  ['the workers repair the telescope tower while the army guards it: quest "The Telescope Tower", film sc_4030', () => {
    gather();
    const r = ruin();
    if (!r) return;
    if (!hunt(army(), (e) => foe(e) && e.kind === 'unit' && e.distTo(r) < 60, 'army')) goRegion(army(), 'TowerOwnerChange', 'army');
    const ws = workers().slice(0, 4);
    for (const w of ws) if (!r.built && (w.task.type !== 'build' || w.task.building !== r)) W.order([w], { type: 'build', target: r });
  }, () => questState('L12MQ01') === 'done', 1800],
  ['quest "The SEAS Storm"', () => base(), () => questState('L12MQ03') === 'open', 300],
  ['the fleet stops the carrier ships for 40 minutes: film sc_4038, the mission is won', () => { base(); fleet(); }, () => G.over, 3600],
];
runSteps(steps);
ok(!G.over || (G.endInfo && G.endInfo.won === true), 'QUIT: the mission is won');
return report({ 3: 'La02: Accomplished', 5: 'Gcb04#check_all_carrier' }) + '\n   won: ' + JSON.stringify(G.endInfo) +
  '\n   variables: ' + ['Carrier', 'Turmstörer', 'Tower_Island'].map((n) => n + '=' + C.variables.get(n)).join(' ') + '; warships ' + warships().map((u) => u.name).join(' ');
