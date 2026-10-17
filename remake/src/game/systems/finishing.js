// Finishing moves: a fighter whose next blow would kill an enemy it fights - and that fights it - kills it with a
// move of its own: the pair of animations of Scripts/Server/settings/FinishingMoves.txt, the victim pulled to the
// fighter's link point and carried along until the move ends.
//
// Reference: misc/FinishingMoveMgr.usl, task/FinishingMove.usl, task/Fight.usl:419-437, FightingObj.InitFinishingMove
// (FO:7250); docs/spec/combat.md §7. Data: gamedata.json "finishing" (pipeline/build_data.py finishing_moves):
// fighter class -> [{e: victim classes, a: [[fighter anim, victim anim]], link, delay, del}].
//
// The check comes with every blow (after the special moves): the fighter is not in a transport and not already in a
// move, the victim is not the last it finished, the victim's hit points are no more than the blow's damage (the
// victim's last damage taken, else the fighter's), the fighter has a move against the victim's class and its link,
// and each is the other's enemy. Then the victim dies at once (skulls, no death cry: OnKill + DieFastAndSilent) -
// a character as a corpse, an animal as a carcass - and plays its part of the move; the fighter is invulnerable
// until its animation ends. Moves with DeleteCorpse leave nothing.
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

export const Finishing = {
  finishingMoveOf(u, V) {
    const all = this.data.extra.finishing;
    const moves = all && all[String(u.name).toLowerCase()];
    if (!moves) return null;
    const v = String(V.name).toLowerCase();
    return moves.find((m) => m.e.includes(v)) || null;
  },
  // Fight.usl: before the blow; true = the move replaces it
  startFinishingMove(u, V, w) {
    if (!V || !V.alive || V.kind !== 'unit' || u.inside || V.inside || u.finishing || V.finish || u.lastFinishVictim === V) return false;
    const mv = this.finishingMoveOf(u, V);
    if (!mv) return false;
    const blow = Math.ceil(V.dmgCache || (u.cs(w || u.weapon) || {}).dmg || 0);
    if (!(V.hp <= blow)) return false;
    if (!(V.task.type === 'attack' && V.task.target === u)) return false;          // each the other's current enemy
    const link = u.findLink(mv.link);
    if (!link) return false;
    const pairs = mv.a.filter(([fa]) => u.anim.has(fa));
    if (!pairs.length) return false;
    const [fa, ea] = pairs[Math.floor(Math.random() * pairs.length)];
    // the victim: dead at once, its part of the move
    u.lastFinishVictim = V;
    V.finish = { by: u, anim: ea && V.anim.has(ea) ? ea : null, link: mv.link, t0: this.time, delay: mv.delay || 0.4, from: V.pos.clone(), del: !!mv.del, linked: false };
    V.invulnT = 0;
    this.kill(V, u);
    // the fighter: its animation, invulnerable meanwhile
    const len = u.anim.duration(fa) || 2;
    u.finishing = true;
    u.task = { type: 'finish', victim: V, until: this.time + len, user: !!(u.task && u.task.user) };
    u.path = []; u.vel.set(0, 0, 0);
    u.busyAnim = true;
    u.anim.play(fa, { loop: false, restart: true, fade: 0.05 });
    this.emit('finishingMove', { unit: u, victim: V });
    return true;
  },
  finishUpdate(u) {
    const t = u.task;
    u.vel.set(0, 0, 0);
    if (this.time < t.until && u.alive) return;
    u.finishing = false;
    u.busyAnim = false;
    const V = t.victim;
    if (V && V.finish) this.finishDone(V);
    u.task = { type: 'attack', target: V, user: t.user };
    this.endAttack(u);
  },
  // the victim (a dead unit) during the move: pulled to the link in `delay` s, then carried by it
  finishedUpdate(V) {
    const f = V.finish, A = f.by;
    if (!A || !A.alive || !A.finishing) { this.finishDone(V); return; }
    const link = A.findLink(f.link);
    if (!link || !V.obj) return;
    A.obj.updateMatrixWorld(true);
    const k = Math.min(1, (this.time - f.t0) / Math.max(0.01, f.delay));
    if (k < 1) {
      link.getWorldPosition(_p);
      V.obj.position.lerpVectors(f.from, _p, k);
      return;
    }
    // linked: the victim's model frame (its first child: the native Z-up frame) on the link's frame
    f.linked = true;
    const model = V.model, frame = model && model.children[0];
    _m.copy(link.matrixWorld);
    if (model) { _inv.copy(model.matrix); if (frame) _inv.multiply(frame.matrix); _m.multiply(_inv.invert()); }
    V.obj.matrixAutoUpdate = false;
    V.obj.matrix.copy(_m);
    V.obj.matrixWorldNeedsUpdate = true;
  },
  // the move is over: the victim lies where the link left it (or is gone: DeleteCorpse)
  finishDone(V) {
    const f = V.finish;
    V.finish = null;
    if (!V.obj) return;
    if (!V.obj.matrixAutoUpdate) {
      V.obj.matrix.decompose(_p, _q, _s);
      V.obj.position.copy(_p); V.obj.quaternion.copy(_q);
      V.obj.matrixAutoUpdate = true;
    }
    V.pos.set(V.obj.position.x, this.height(V.obj.position.x, V.obj.position.z), V.obj.position.z);
    V.obj.position.y = V.pos.y;
    if (f && f.del) { V.silentDeath = true; if (V.corpseNode && V.corpseNode.alive) this.depleteNode(V.corpseNode); }
  },
};
