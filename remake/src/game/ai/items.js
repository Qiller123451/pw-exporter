// The computer player and items (artefacts; game/systems/items.js). docs/spec/ai_group6.md §6.
//
//   * CheckGetItem (goals/AiGoalDisturbAttack.usl:633-681, every strategist think): on skirmish maps, in the epochs
//     1-3, not while hunting a warp gate, Hard always, Medium one think in 15, Easy never: the free item nearest the
//     start location on the home island ("GetDynamicIslandIdForChar"; World.landIsland) is fetched.
//   * The GetItem goal (goals/AiGoalGetItem.usl, thinks every 30 + iType ticks): one runner (hu_warrior,
//     aje_spearman, ninigi_archer, seas_warrior with nothing in its hands) from the pool - else the army
//     "FindItem_1" (one runner) is trained - is sent to pick it up; an enemy (unit, building, hostile wild animal)
//     within 60 m of the item stops it; one that carries the item walks back to the start location (done within
//     30 m); 15 checks with empty hands while idle: it gives up and walks back; after 30 checks the order again.
//   * Every attacking squad on a skirmish map: its first unit with empty hands picks up a free item within 30 m of
//     it (tasks/AiTaskAttackObject.usl:1056, 1496-1526).
const rnd = (n) => Math.floor(Math.random() * n);
const RUNNER = { Hu: 'hu_warrior', Aje: 'aje_spearman', Ninigi: 'ninigi_archer', SEAS: 'seas_warrior' };

export const ItemsAI = {
  // DisturbAttack.CheckGetItem
  checkGetItem(S) {
    const W = this.W;
    if (!this.multimap || this.levelName === '_MN_MP_2_COLDBLOOD' || S.age > 3 || this.cls === 'Easy' || this.getItem || !S.home) return;
    if (this.attacks.some((a) => a.type === 'siege_warpgate')) return;
    if (this.cls === 'Medium' && rnd(15)) return;
    const isle = W.landIsland(S.home.x, S.home.z);
    let best = null, bd = Infinity;
    for (const it of W.items) {
      if (!it.alive || it.item.carrier || W.landIsland(it.pos.x, it.pos.z) !== isle) continue;
      const d = Math.hypot(it.pos.x - S.home.x, it.pos.z - S.home.z);
      if (d < bd) { bd = d; best = it; }
    }
    if (best) this.getItem = { item: best, unit: null, phase: 'new', n: 0, steps: 0, t: W.time };
  },
  // the GetItem goal, on the strategist's timer
  getItemThink(S) {
    const g = this.getItem, W = this.W;
    if (!g) return;
    const u = g.unit, it = g.item;
    const end = () => { if (u) this.release([u]); this.getItem = null; };
    if (u && (!u.alive || u.owner !== this.p)) return end();
    switch (g.phase) {
      case 'new': {
        const cls = RUNNER[this.p.tribe];
        const r = S.pool.find((x) => x.name === cls && !x.item && !x.inside && W.canCarry(x));
        if (!r) {
          // the army FindItem_1: one runner, trained (CAiTaskBuildSquad); tried again on the next thinks
          if (!g.ordered) g.ordered = this.addOnTop(cls, '', { unique: false });
          if (W.time - g.t > 120) end();
          return;
        }
        g.unit = r;
        this.claim([r], g);
        g.phase = 'running';
      }
      // falls through
      case 'running':
        if (!it.alive || (it.item.carrier && it.item.carrier !== g.unit)) return end();
        if (this.itemDanger(it.pos, 60)) return end();
        W.order([g.unit], { type: 'pickup', target: it, auto: true });
        g.phase = 'checking'; g.n = 0; g.steps = 0;
        return;
      case 'checking':
        if (u.item === it) return this.itemHome(g);
        if (!it.alive || (it.item.carrier && it.item.carrier !== u)) return end();
        g.n++;
        if (!u.item && u.task.type === 'idle' && ++g.steps >= 15) return this.itemHome(g);
        if (g.n > 30) g.phase = 'running';
        return;
      case 'home':
        if (Math.hypot(u.pos.x - g.home.x, u.pos.z - g.home.z) < 30) return end();
        if (u.task.type === 'idle') W.order([u], { type: 'move', x: g.home.x, z: g.home.z, auto: true });
        if (W.time - g.t > 600) end();
    }
  },
  itemHome(g) {
    const S = this.S || this.census();
    g.phase = 'home';
    g.home = this.start || S.home;
    this.W.order([g.unit], { type: 'move', x: g.home.x, z: g.home.z, auto: true });
  },
  // an enemy unit or building, or a hostile wild animal, within r of p (GetItem.CheckForEnemy)
  itemDanger(p, r) {
    const W = this.W;
    for (const e of W.units) {
      if (!e.alive || e.inside || Math.hypot(e.pos.x - p.x, e.pos.z - p.z) > r) continue;
      if (this.isEnemyEntity(e) || (e.wild && e.def && e.def.aggressive === 1)) return true;
    }
    for (const b of W.buildings) if (this.isEnemyEntity(b) && Math.hypot(b.pos.x - p.x, b.pos.z - p.z) <= r) return true;
    return false;
  },
  // AiTaskAttackObject: a squad picks up what lies on its way (skirmish maps)
  squadPickup(us) {
    if (!this.multimap) return;
    const W = this.W;
    for (const u of us) {
      if (u.item || !W.canCarry(u) || u.task.type === 'pickup') continue;
      const it = W.items.find((x) => x.alive && !x.item.carrier && Math.hypot(x.pos.x - u.pos.x, x.pos.z - u.pos.z) <= 30);
      if (it) W.order([u], { type: 'pickup', target: it, auto: true });
      return;
    }
  },
};
