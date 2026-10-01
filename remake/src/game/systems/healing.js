// Healing: healer units (druid, monk, SEAS medic), healing buildings (temples), the hermit's ranged heal.
//
// Reference: HealUnits.usl, Building.usl DoBuildingFunction, FightingObj.usl:3744 (docs/spec/moves.md 4).
//   heal per second = amount * Healing(rel) + Healing(abs) + target max hp * mod / 100
// There is no passive regeneration in ParaWorld.

export const Healing = {
  healPerSecond(src, h, target) {
    const m = src.stats.healMod || { rel: 1, abs: 0 };
    return h.amount * m.rel + m.abs + target.maxHp * (h.mod || 0) * 0.01;
  },
  // own and allied characters, animals, vehicles within 1.5 x the healing radius; lowest hit point ratio first
  healScan(u) {
    const h = u.stats.heal;
    if (!h || !u.owner) return null;
    let best = null, bh = 1;
    this.uHash.query(u.pos.x, u.pos.z, h.radius * 1.5 + 6, (o) => {
      if (o === u || !o.alive || o.inside || !o.owner || !u.owner.isFriend(o.owner) || o.hp >= o.maxHp) return;
      if (u.distTo(o) > h.radius * 1.5) return;
      if (o.stats.heal && o.task.type === 'heal') return;     // don't heal busy healers
      const r = o.hp / o.maxHp;
      if (r < bh) { bh = r; best = o; }
    });
    return best;
  },
  healUpdate(u, dt) {
    const h = u.stats.heal, t = u.task;
    let tgt = t.target;
    if (!h) { u.task = { type: 'idle' }; return; }
    if (!tgt || !tgt.alive || tgt.hp >= tgt.maxHp) {
      tgt = t.target = this.healScan(u);
      if (!tgt) { this.stopHealing(u); u.task = { type: t.hold ? 'hold' : 'idle' }; return; }
    }
    const d = u.distTo(tgt) - tgt.radius;
    if (d > h.radius) {
      if (t.hold || (!t.user && d > h.radius * 1.5)) { t.target = null; return; }
      this.stopHealing(u);
      u.repathT = (u.repathT || 0) - dt;
      if (u.repathT <= 0 || !u.path.length) { u.setPath(tgt.pos.x, tgt.pos.z); u.repathT = 0.8; }
      const sp = u.steer(dt, u.runSpeed || u.speed, 0.5);
      u.moveAnim(sp, true);
      return;
    }
    u.path = []; u.vel.set(0, 0, 0);
    u.face(tgt.pos.x, tgt.pos.z, dt);
    if (!u.healing) {
      u.healing = true;
      u.setVisFlag(16, true);          // VIS_FLAG_CHTR_ACTIVATED: the medic's glowing kit
      const a = u.anim.pick('heal_0');
      if (a) u.anim.play(a, { fade: 0.2 });
    }
    tgt.hp = Math.min(tgt.maxHp, tgt.hp + this.healPerSecond(u, h, tgt) * dt);
    t.fxT = (t.fxT || 0) - dt;
    if (t.fxT <= 0) { t.fxT = 0.5; this.emit('healfx', { from: u, to: tgt }); }
  },
  stopHealing(u) {
    if (!u.healing) return;
    u.healing = false;
    u.setVisFlag(16, false);
  },
  // temples and harbours heal friends in their radius; the hermit heals around himself (ranged_heal)
  buildingHeal(dt) {
    const heal = (src, h, filter) => {
      this.uHash.query(src.pos.x, src.pos.z, h.radius + 6, (o) => {
        if (!o.alive || o.inside || !o.owner || !src.owner.isFriend(o.owner) || o === src || o.hp >= o.maxHp) return;
        if (filter && !filter(o)) return;
        if (Math.hypot(o.pos.x - src.pos.x, o.pos.z - src.pos.z) > h.radius + o.radius) return;
        o.hp = Math.min(o.maxHp, o.hp + this.healPerSecond(src, h, o) * dt);
        if (Math.random() < 0.2) this.emit('healfx', { from: src, to: o });
      });
    };
    for (const b of this.buildings) {
      if (!b.alive || !b.built || !b.owner || !b.stats.heal || !b.stats.heal.radius) continue;
      const ships = b.def.script === 'CHarbour' || b.def.script === 'CSwimmingHarbour';
      heal(b, b.stats.heal, (o) => (ships ? o.cls === 'SHIP' : o.cls !== 'SHIP'));
    }
    for (const u of this.units) {
      const rh = u.alive && u.owner && u.stats.abilities && u.stats.abilities.ranged_heal;
      if (rh && rh.radius > 0) heal(u, rh);
    }
  },
};
