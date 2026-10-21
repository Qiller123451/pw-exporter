// The actors of an in-engine cutscene (docs/SEQUENCE_FORMAT.md §8-9; the data: pwexport/campaign.py seq_play):
// which world objects take part, where each one is at a moment of the timeline, and where they are left.
//
//   * Binding (client 0x52dc24): the actor's object by GUID (the map object of that GUID); else the first world
//     object of the binding's class (or its equivalent of the player's tribe), owner (-1 none, -2 any), level (-1
//     any) and name ('' any) that no other actor took; else the actor is temporary - drawn for the scene only, with
//     the attachments of its state (weapons, shields: ui/cutscene.js).
//   * Pose at time t: its start pose, then every walk / recorded path / beam that began by t (a walk or path between
//     its keys; heading from the path's turns, else from the direction of the walk); a turn adds its angle. A walk is
//     straight from waypoint to waypoint (the server's walk of a cutscene does no path finding, PWServer 0x464ed0 ->
//     0x4a3180) at the times the editor stored, which are the server's own result for those waypoints (the client
//     re-times the waypoints from it, 0x51d600); with its flag bit 1 (most walks) on the terrain, else at the
//     waypoints' heights (0x489fc0).
//   * End (0x501820): without snap_actors_back every bound actor stays where the scene left it (the server sets
//     position and turn, stops its walk); with it everybody goes back to where it was before.
// Positions are map metres (x east, y south, z up); poses here are the game's (x, z, heading).
import { headingTo } from '../entities.js';
import { mapHeading } from '../maps/frame.js';

const lc = (s) => String(s == null ? '' : s).toLowerCase();

export class SeqActors {
  constructor(C, play) {
    this.C = C; this.play = play;
    this.list = [];                 // {a, rec, e (unit / building), prop, temp, start {x, z, h, visible}}
    this.bind();
  }
  bind() {
    const C = this.C, taken = new Set();
    const recs = C.objects && C.objects.guids ? [...C.objects.guids.values()] : [];
    const objOf = (rec) => rec && (rec.entity && rec.entity.alive ? rec.entity : null);
    const live = (rec) => rec && (objOf(rec) || rec.prop);
    for (const a of this.play.actors || []) {
      let rec = C.objects && C.objects.guids ? C.objects.guids.get(a.guid) : null;
      if (!live(rec) || taken.has(rec)) rec = null;
      if (!rec) {
        const b = a.bind || {}, owner = b.owner >= 0 ? C.player(b.owner) : null;
        // the class, or its equivalent of the player's tribe: an object given to the player in a mission played with
        // another tribe became that tribe's (setup.js convert) - mission 1's freed spearmen in sc_1040
        const cls = lc(b.cls || a.cls), own = C.ownClass ? lc(C.ownClass(b.cls || a.cls)) : cls;
        rec = recs.find((r) => !taken.has(r) && live(r) && (lc(r.cls) === cls || lc(r.cls) === own) &&
          (b.owner === -2 || (objOf(r) ? (objOf(r).owner || null) === owner : b.owner < 0)) &&
          (!(b.level >= 0) || !objOf(r) || (objOf(r).level || 1) - 1 === b.level) &&
          (!b.name || lc(r.name) === lc(b.name))) || null;
      }
      if (rec) taken.add(rec);
      const e = objOf(rec), prop = !e && rec ? rec.prop : null;
      const at = e || prop;
      this.list.push({ a, rec, e, prop, temp: !at,
        start: at ? { x: at.pos.x, z: at.pos.z, y: at.pos.y, h: e ? (e.kind === 'building' ? e.rot : e.heading) : prop.obj.rotation.y, visible: at.obj ? at.obj.visible : true } : null });
    }
  }
  // map -> game
  game(mx, my) { return this.C.toGame(mx, my); }
  // the pose of an actor at time t: {x, z, mz (map height), ground (on the terrain, else at mz), h, walk (the walk
  // item it is in, or null)}
  pose(A, t) {
    const a = A.a;
    let [x, z] = this.game(a.pos[0], a.pos[1]), mz = a.pos[2], h = mapHeading(a.rot), walk = null, ground = true;
    for (const it of a.items) {
      if (it.t > t) continue;
      if ((it.k === 'walk' || it.k === 'path') && it.keys && it.keys.length) {
        const lt = Math.min(t - it.t, it.keys[it.keys.length - 1][0]);
        const K = it.keys;
        let i = 0;
        while (i < K.length - 2 && K[i + 1][0] < lt) i++;
        const k0 = K[i], k1 = K[Math.min(i + 1, K.length - 1)];
        const f = k1[0] > k0[0] ? Math.max(0, Math.min(1, (lt - k0[0]) / (k1[0] - k0[0]))) : 1;
        const mx = k0[1] + (k1[1] - k0[1]) * f, my = k0[2] + (k1[2] - k0[2]) * f;
        mz = k0[3] + (k1[3] - k0[3]) * f;
        ground = it.k !== 'walk' || it.ground !== false;
        [x, z] = this.game(mx, my);
        if (it.rots && it.rots.length) {
          let r = it.rots[0][1];
          for (const [rt, rv] of it.rots) if (rt <= lt) r = rv;
          h = mapHeading(r);
        } else if (k1 !== k0 && Math.hypot(k1[1] - k0[1], k1[2] - k0[2]) > 0.05) h = headingTo(k1[1] - k0[1], k1[2] - k0[2]);
        if (it.k === 'walk' && t - it.t < it.len && f < 1) walk = it;
      } else if (it.k === 'beam') {
        [x, z] = this.game(it.pos[0], it.pos[1]); mz = it.pos[2]; h = mapHeading(it.rot); ground = true;
      } else if (it.k === 'turn') {
        h += (it.angle || 0) * (it.len > 0 ? Math.min(1, (t - it.t) / it.len) : 1);
      }
    }
    return { x, z, mz, ground, h, walk };
  }
  // hidden at time t (the scene's attribute items)
  hidden(A, t) {
    let hid = null;
    for (const it of A.a.items) if (it.k === 'attr' && it.t <= t && it.hidden != null) hid = it.hidden;
    return hid;
  }
  // the end: bound actors stay where the scene left them (or go back: snap_actors_back); shown again
  finish(snapBack) {
    const C = this.C, W = C.world, t = this.play.end;
    for (const A of this.list) {
      if (A.temp) continue;
      const at = A.e || A.prop;
      if (!at || (A.e && !A.e.alive)) continue;
      if (at.obj && A.start) at.obj.visible = A.start.visible;
      if (snapBack) { if (this.moved) this.place(A, A.start.x, A.start.z, A.start.h); continue; }
      const moves = A.a.items.some((it) => it.k === 'walk' || it.k === 'path' || it.k === 'beam' || it.k === 'turn');
      if (!moves) continue;
      const p = this.pose(A, t);
      this.place(A, p.x, p.z, p.h);
    }
  }
  place(A, x, z, h) {
    const W = this.C.world;
    if (A.e && A.e.kind === 'unit') { W.teleport(A.e, x, z, h); return; }
    if (A.prop) {
      const P = A.prop;
      P.pos.set(x, W.height(x, z), z);
      if (P.obj) { P.obj.position.copy(P.pos); P.obj.rotation.y = h; }
    }
  }
}
