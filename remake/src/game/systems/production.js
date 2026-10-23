// Production: training units, researching upgrades (player-wide and "local" ones on a single building),
// hiring heroes, and the army pyramid (levels bought with skulls).
//
// Reference: docs/spec/buildings.md 1.9 & 5, docs/spec/units.md 2-3 (Action.usl, RequirementsMgr.usl, NewPyramid.usl).
//
// An upgrade's results name filters of the tech tree:
//   class "player" -> the filter changes the player's tree (all buildings/units of that player)
//   class "local"  -> the filter changes only the building that researched it (its own LocalTree)
//   type  "activate" / "deactivate" switches the filter on or off (e.g. the three Aje farm modes exclude each other)
import { headingTo, AMPHIBIOUS } from '../entities.js';
import { LocalTree } from '../techtree.js';
import { active } from './effects.js';
import { UPGRADE_HOOKS } from './moves_mirage.js';

const MAX_QUEUE = 6;

const HULL_OPEN = 2.4;          // s until the carrier's front hull is open (seas_carrier work_finished)
export const Production = {
  // why an action can't be queued right now (null = ok): req | level | done | cost | housing | level | unique
  canQueue(p, action, producer) {
    if (action.freeMain) return null;                 // (a waiting mobile base: main.js G.buildActions)
    const owner = producer && producer.rulesOwner ? producer.rulesOwner() : p;
    const why0 = this.data.check(owner, action, producer && producer.kind === 'unit' ? producer : producer);
    if (why0) return why0 === 'hidden' || why0 === 'disabled' ? 'req' : why0;
    if (producer && producer.kind === 'building' && !producer.built) return 'req';
    if (action.kind === 'Upgrades') {
      const local = action.results.some((r) => r.cls === 'local');
      if (local ? producer.queue.some((q) => q.action.id === action.id) : (p.techs.has(action.id) || this.anyQueued(p, action.id))) return 'done';
    }
    if (!p.canAfford(action.cost)) return 'cost';
    if (action.kind === 'Build' && action.cat !== 'Build/BLDG') {
      const name = action.results[0].obj;
      if (this.data.def(name, p) && this.data.def(name, p).unique && (p.heroes.has(name) || this.anyQueuedObj(p, name))) return 'unique';
      // while one hero is being hired the others can't be (<hero>_RemoveMe filters)
      if (this.data.def(name, p) && this.data.def(name, p).unique && producer.queue.some((q) => q.action.results[0] && this.data.def(q.action.results[0].obj, p) && this.data.def(q.action.results[0].obj, p).unique)) return 'unique';
      const lv = this.unitStartLevel(action, p);
      const why = p.slotFree(lv, this.pyramidFor(p));
      if (why) return why;
    }
    return null;
  },
  unitStartLevel(action, p) { return Math.max(this.data.startLevel(action), this.data.minLevel(action.results[0].obj, p)); },
  queueAction(producer, action) {
    const p = producer.owner;
    if (producer.st && active(producer, 'deaf', this.time)) return 'deaf';     // deafened (MIRAGE: no commands)
    // instant actions (Moves on buildings, e.g. buy_food / Open / Kill) are handled by the moves system
    if (action.kind === 'Moves') return this.useMove ? this.useMove(producer, action, null) : 'req';
    const why = this.canQueue(p, action, producer);
    if (why) return why;
    if (producer.queue.length >= MAX_QUEUE) return 'full';
    p.pay(action.cost);
    const item = { action, t: 0, total: this.productionTime(action, p), level: 0 };
    if (action.kind === 'Build') {
      item.level = this.unitStartLevel(action, p);
      p.queuedAtLevel[item.level - 1]++; p.queuedUnits++;
    }
    producer.queue.push(item);
    if (action.kind === 'Build' && this.prewarm) this.prewarm(action.results[0].obj, p);     // (main.js: its shaders now)
    return null;
  },
  // duration of production / research; debug mode: instant. A computer player's actions are faster from difficulty 5
  // on, except the first epoch upgrade (Action.usl:346-382, "AIHelp"; player.aiMods). The tribe's modifier
  // /Modifications/<tribe>/Build/<type>/duration (or /<kind>/duration) shortens it (FightingObj.GetTechTreeActionModifier:
  // Ada's chief bonus, ...)
  productionTime(action, p) {
    if (p && p.debug) return 0.05;
    const m = p && p.aiMods;
    const k = !m || action.id === 'age_2' ? 1 : action.kind === 'Upgrades' ? m.researchTime || 1 : m.buildTime || 1;
    const tm = p && p.tt ? p.tt.num(`/Modifications/${p.tribe}/${action.kind}${action.kind === 'Build' ? '/' + action.type : ''}/duration`, 1) : 1;
    const sp = p && p.cheat && p.cheat.speed > 0 ? p.cheat.speed : 1;      // (debug option: game/cheats.js)
    return Math.max(0.5 / sp, (action.time || 1) * k * tm / sp);
  },
  // pyramid slots per level: the game's, plus the extra slots of a computer player at difficulty 7-9
  // (RequirementsMgr.usl:213-241)
  pyramidFor(p) {
    const m = p && p.aiMods;
    const base = (p && p.pyramid) || this.data.pyramid;        // a mission's own limits (campaign unit_limits / BLSL)
    if (!m || !m.pyramid) return base;
    if (!m.pyramidAbs || m.pyramidAbs.src !== m.pyramid || m.pyramidAbs.base !== base) { m.pyramidAbs = base.map((v, i) => v + (m.pyramid[i] || 0)); m.pyramidAbs.src = m.pyramid; m.pyramidAbs.base = base; }
    return m.pyramidAbs;
  },
  cancelQueue(producer, i) {
    const item = producer.queue[i];
    if (!item) return;
    producer.queue.splice(i, 1);
    if (item.buildDown) { this.buildDownFilter(producer, false); return; }
    const p = producer.owner;
    p.refund(item.action.cost);
    if (item.level) { p.queuedAtLevel[item.level - 1]--; p.queuedUnits--; }
  },
  anyQueued(p, id) { for (const e of [...this.buildings, ...this.units]) if (e.alive && e.owner === p && e.queue && e.queue.some((q) => q.action.id === id)) return true; return false; },
  anyQueuedObj(p, obj) { for (const e of [...this.buildings, ...this.units]) if (e.alive && e.owner === p && e.queue && e.queue.some((q) => q.action.results[0] && q.action.results[0].obj === obj)) return true; return false; },
  productionUpdate(e, dt) {
    if (!e.queue.length || (e.kind === 'building' && !e.built)) return;
    const item = e.queue[0];
    if (item.buildDown) {
      item.t = Math.min(item.total, item.t + dt);
      e.onWork(this.time);
      if (item.t >= item.total) this.buildDownDone(e, item);
      return;
    }
    // a unit can't come out while the population is full; it waits at 100 %
    item.t = Math.min(item.total, item.t + dt);
    if (e.kind === 'building') e.onWork(this.time);
    if (item.t < item.total) return;
    // buildings that open up to let the unit out (SEAS carrier: work_finished = the front hull opens, fully open
    // after HULL_OPEN s; Building.OnWorkFinished). The unit appears once the hull is open.
    if (e.kind === 'building' && item.action.kind === 'Build' && e.anim && e.anim.has('work_finished') && !e.anim.pick('work', 'work_1')) {
      if (item.hullT === undefined) {
        item.hullT = this.time + HULL_OPEN;
        e.anim.play('work_finished', { loop: false, restart: true, onDone: () => (e.sail && e.anim ? e.anim.play(e.anim.pick('swim_1', 'standanim')) : e.idleAnim()) });
      }
      if (this.time < item.hullT) return;
    }
    const p = e.owner;
    const a = item.action;
    if (a.kind === 'Upgrades') {
      e.queue.shift();
      this.completeUpgrade(e, a);
      return;
    }
    e.queue.shift();
    p.queuedAtLevel[item.level - 1]--; p.queuedUnits--;
    const name = a.results[0].obj;
    const tgt = e.rally ? e.rally : [e.pos.x + 10, e.pos.z + 10];
    // ships and amphibians leave on their own grid (harbour dock)
    const info = this.data.info(name) || {};
    const nv = this.navFor({ naval: info.type === 'SHIP' && !AMPHIBIOUS.test(name), amphib: AMPHIBIOUS.test(name) });
    // the carrier: inside the hull at Spwn, out through the open front (Ex_1)
    const hull = e.kind === 'building' && item.hullT !== undefined ? [e.linkWorld('Spwn'), e.linkWorld('Ex_1')] : null;
    const [x, z] = hull && hull[0] ? [hull[0].x, hull[0].z] : e.kind === 'building' ? e.spawnPoint(tgt[0], tgt[1], nv) : [e.pos.x + (e.radius + 2), e.pos.z + (e.radius + 2)];
    const u = this.spawnUnit(name, p, x, z, item.level, headingTo(tgt[0] - x, tgt[1] - z));
    if (!u) return;
    if (e.kind === 'building') e.spawnAnim();
    this.emit('trained', { unit: u, producer: e });
    // a trade cart's home is the market it came out of (TransportObj.usl: the CTheLite event sets m_xHome); it
    // trades when it is sent to another market (the Dock order)
    if (e.kind === 'building' && this.isTradeBuilding(e)) u.tradeHome = e;
    if (hull && hull[1]) {
      const then = e.rally ? { type: 'move', x: e.rally[0], z: e.rally[1] } : null;
      this.order([u], { type: 'move', x: hull[1].x, z: hull[1].z, then });
      // straight out through the open bow (the pathfinder can't start deep inside the hull's own footprint)
      u.path = [[hull[1].x, hull[1].z]]; u.goal = [hull[1].x, hull[1].z];
      return;
    }
    // the rally point (CTheLite): a worker sent to a resource or a building does what it means there (NextJob); one
    // sent to open ground looks for work around the point when it arrives (rallyJob)
    if (e.rally) {
      const rt = e.rallyTarget;
      if (rt && u.isWorker && this.nextJob(u, rt)) return;
      this.order([u], { type: 'move', x: e.rally[0], z: e.rally[1], then: u.isWorker ? { type: 'rallyJob', x: e.rally[0], z: e.rally[1] } : null });
    } else if (e.kind === 'building') {
      const [ex, ez] = e.exitPoint(tgt[0], tgt[1], nv);
      this.order([u], { type: 'move', x: ex, z: ez });
    }
  },
  // an upgrade finished: switch its filters (player-wide or on this building only)
  completeUpgrade(e, a) {
    const p = e.owner;
    let local = false;
    for (const r of a.results) {
      const path = (r.path || '').replace(/^\/?Filters\//, '');
      if (!path) continue;
      if (r.cls === 'local') { local = true; this.localFilter(e, path, r.type !== 'deactivate'); }
      else if (r.type === 'deactivate') p.tt.disable(path);
      else p.tt.enable(path);
    }
    if (!a.results.length) p.tt.enable(a.path.replace(/^\/Actions\//, ''));
    if (!local) p.techs.add(a.id);
    if (UPGRADE_HOOKS[a.id]) UPGRADE_HOOKS[a.id](this, e, a);
    this.emit('upgrade', { player: p, action: a, local, entity: e });
  },
  // enable / disable a filter on one object only (its own tree follows the owner's tree)
  localFilter(e, path, on) {
    if (!e.localTT) {
      if (!on || !e.owner || !e.owner.tt) return;
      e.localTT = new LocalTree(e.owner.tt);
    }
    if (on) { if (!e.localTT.has(path)) e.localTT.enable(path); } else e.localTT.disable(path);
    if (e.refreshRules) e.refreshRules();
    this.recomputeCaps(e.owner);
  },
  // "resultactions" of a build action: an upgrade applied right after construction (aje_medium_farm etc.)
  applyResultAction(e, path) {
    const a = this.data.actions(e.owner).find((x) => x.path === path);
    if (a) this.completeUpgrade(e, a);
  },

  // ------------------------------------------------------------------ army pyramid (NewPyramid.usl, FightingObj.SetLevel)
  levelUp(u) { return this.changeLevel(u, u.level + 1); },
  // skull cost from level a to level b: sum of the per-level costs 25 / 50 / 100 / 300
  skullCost(a, b) { let c = 0; for (let l = a + 1; l <= b; l++) c += this.data.levelupSkulls[l - 2] || 0; return c; },
  canHaveLevel(u, nl) { const st = this.data.stats(u.name, nl, u.owner); return !!st && st.exists && !u.illusion; },
  // move a unit to a higher pyramid row (drag & drop onto a free slot), for the skulls of every level on the way. As
  // the original's pyramid (NewPyramid.usl SwapSlotsAndCards): a card never goes to a lower row - a unit keeps the
  // level it reached - and cards on different rows do not swap; the target row needs a free slot
  changeLevel(u, nl) {
    const p = u.owner;
    if (!p || !u.alive || nl === u.level) return 'same';
    if (nl < u.level) return 'down';
    if (nl > 5) return 'max';
    if (!this.canHaveLevel(u, nl)) return 'max';
    if (p.atLevel[nl - 1] + p.queuedAtLevel[nl - 1] >= this.pyramidFor(p)[nl - 1]) return 'level';
    const cost = p.debug ? 0 : this.skullCost(u.level, nl);          // (debug mode: free level-ups)
    if (p.res.skulls < cost) return 'skulls';
    p.res.skulls -= cost;
    this.applyLevel(u, nl);
    return null;
  },
  applyLevel(u, nl) {
    const p = u.owner, ol = u.level;
    p.atLevel[ol - 1]--; p.atLevel[nl - 1]++;
    const task = u.task;
    this.levelFilters(u, ol, false);
    u.applyLevel(nl);
    this.levelFilters(u, nl, true);
    u.task = ['attack', 'move', 'gather', 'build', 'heal'].includes(task.type) ? task : { type: 'idle' };
    if (nl > ol) {
      // full heal; the level-up animation and invulnerable while it plays (2.5 s for characters, 1.5 s otherwise) - only
      // with a "level_up" animation, not in a transport or trapped (DoLevelUpAnim: character.usl:948, FO:3532)
      if (!u.inside && !active(u, 'trapped', this.time) && u.anim.has('level_up')) {
        u.st.t.levelInvul = this.time + (u.cls === 'CHTR' ? 2.5 : 1.5);
        u.busyAnim = true;
        u.anim.play('level_up', { loop: false, onDone: () => { u.busyAnim = false; } });
      }
      this.emit('levelup', { unit: u });
    }
  },
};
