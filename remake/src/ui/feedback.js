// Player feedback for world events: sounds (original sound events), effects, messages, minimap pings.
// Mirrors the original client scripts: Game/mgr/UISndMgr.usl (selection/order acknowledgements with the
// "voice_<class>_<type>" -> "voice_<type>" fallback chain) and Game/Game.usl (Placed, Delivered, NextAge, ...).
import * as THREE from 'three';

const EPOCH = ['', 'I', 'II', 'III', 'IV', 'V'];
const ORDER_TYPE = { move: 'task_goto', attack: 'task_attack', attackmove: 'task_attack_walk', amove: 'task_attack_walk',
  build: 'task_build', heal: 'task_healing', rally: 'task_goto', wood: 'task_get_wood', stone: 'task_get_stone', food: 'task_get_food' };

export class Feedback {
  constructor(G) {
    this.G = G;
    this.alertT = -99;
    this.rep = { e: null, n: 0 };
  }
  get audio() { return this.G.audio; }
  // the unit whose voice answers for a selection: the highest level one (UISndMgr.GetSoundEvent)
  voiceUnit(list) {
    let best = null;
    for (const e of list) if (e && e.alive && e.kind === 'unit' && (!best || e.level > best.level)) best = e;
    return best || list.find((e) => e && e.alive) || null;
  }
  names(e, type) {
    const cls = e.name;
    return {
      voice: [`voice_${cls}_${type}`, `voice_${type}`],
      ui: [`ui_${cls}_${type}`, `ui_${type}`],
    };
  }
  selected(list) {
    const A = this.audio, G = this.G;
    if (!A || !list.length) return;
    const e = this.voiceUnit(list);
    if (!e) return;
    if (e.owner !== G.me) { A.playFirst(['ui_enemy_selected', 'ui_neutral_selected', 'ui_selected']); return; }
    const n = this.names(e, 'selected');
    // clicking the same unit again and again makes it complain ("gag")
    if (this.rep.e === e) this.rep.n++; else this.rep = { e, n: 0 };
    A.playFirst(n.ui);
    if (this.rep.n >= 3 && A.has(`voice_${e.name}_gag`)) { A.ack([`voice_${e.name}_gag`]); this.rep.n = 0; } else A.ack(n.voice);
  }
  ordered(type, units) {
    const A = this.audio;
    const e = this.voiceUnit(units);
    if (!A || !e) return;
    const t = ORDER_TYPE[type] || type;
    const n = this.names(e, t);
    A.playFirst(n.ui);
    A.ack(n.voice);
  }
  ui(name) { if (this.audio) this.audio.playFirst([name, 'ui_click', 'UI_click']); }
  error() { if (this.audio) { this.audio.playFirst(['ui_click_error']); this.audio.ack(['voice_click_error']); } }

  // world events emitted by the simulation (World.emit)
  handle(events) {
    const G = this.G, W = G.world, fx = G.fx, A = this.audio, me = G.me;
    const vis = (p) => G.fow.visible(p.x, p.z);
    for (const e of events) {
      switch (e.type) {
        case 'msg': if (e.player === me) G.hud.message(e.text); break;
        case 'storagefull': if (e.player === me) { G.hud.message('Storage full', 'warn'); A && A.playFirst([`ui_no_${e.res}`, 'ui_no_storage']); } break;
        case 'placed': if (e.building.owner === me && A) { A.playFirst(['ui_' + me.tribe.toLowerCase() + '_placed', 'ui_placed']); A.ack(['voice_' + me.tribe.toLowerCase() + '_placed', 'voice_placed']); } break;
        case 'built':
          if (e.building.owner === me) { G.hud.message(`${G.data.text(e.building.name).name} completed`); A && A.play('FX_CBuildingReadyFX', e.building.pos); }
          break;
        case 'delivered':
          if (e.unit.owner === me && A && G.input.onScreen(e.unit)) A.playFirst([`ui_${e.unit.name}_delivered`]);
          break;
        case 'trained':
          if (e.unit.owner === me && A) A.play('FX_CTecFX_CharacterSpawnFX', e.unit.pos) || A.play('Confirmping_Build_Character_Fx');
          break;
        case 'upgrade': {
          const a = e.action;
          if (/^age_\d$/.test(a.id)) {
            const txt = `Epoch ${EPOCH[+a.id.slice(4)]}`;
            G.hud.message(e.player === me ? `${txt} reached!` : `The ${e.player.name} have reached ${txt}`, e.player === me ? 'good' : 'warn');
            if (e.player === me && A) { A.playFirst(['ui_nextage']); A.ack(['voice_nextage']); }
          } else if (e.player === me) { G.hud.message(`${G.data.text(a.id).name} researched`, 'good'); A && A.playFirst(['ui_invention']); }
          break;
        }
        case 'levelup':
          if (vis(e.unit.pos)) {
            fx.spawn('glow', e.unit.pos.clone().setY(e.unit.pos.y + e.unit.height * 0.6), { size: 3, size1: 7, life: 0.8 });
            A && A.play(e.unit.cls === 'CHTR' ? 'FX_CLevelUpFX' : 'FX_CLevelUpFX_Transport', e.unit.pos);
          }
          break;
        case 'attacked': {
          const en = e.entity;
          if (en.owner === me) {
            A && A.combatEvent(W.time);
            if (W.time - this.alertT > 12 && !G.input.onScreen(en)) {
              this.alertT = W.time;
              G.hud.message(en.kind === 'building' ? 'Your base is under attack!' : 'Your units are under attack!', 'bad');
              G.pings.push({ x: en.pos.x, z: en.pos.z, t: W.time });
              A && A.playFirst(['ui_warn_under_attack']);
            }
          } else if (e.by && e.by.owner === me && A) A.combatEvent(W.time);
          break;
        }
        case 'died': {
          const en = e.entity;
          if (vis(en.pos)) {
            const p = en.pos.clone(); p.y += en.height * 0.4;
            if (en.cls === 'VHCL') { fx.explosion(p, 1); A && A.play('FX_CVehicleExplosion', en.pos); } else fx.blood(p, 12);
            if (A) {
              if (!A.play(`voice_${en.name}_die`, en.pos, 'sfx')) {
                if (en.name === 'aje_allosaurus' || en.name === 'Allosaurus') A.play('FX_CAllosaurusDying', en.pos);
                else if (/brachio/i.test(en.name)) A.play('FX_CBrachioDying', en.pos);
              }
            }
          }
          if (en.owner === me) { const L = G.input.groups; for (const k in L) L[k] = L[k].filter((x) => x !== en); }
          G.sel.delete(en);
          break;
        }
        case 'destroyed': {
          const en = e.entity;
          G.sel.delete(en);
          if (e.silent) break;                    // removed without a fight (a gate / tower took the wall piece's tile)
          if (G.fow.explored_(en.pos.x, en.pos.z)) {
            for (let i = 0; i < 4; i++) fx.explosion(en.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * en.radius, en.ht * 0.3, (Math.random() - 0.5) * en.radius)), 1.5);
            fx.dust(en.pos.clone(), en.radius * 2);
            A && A.play(en.owner && en.owner.tribe === 'Aje' ? 'FX_CAje_Tent_Dem_Fx' : 'FX_CBigBuildingExplosion', en.pos);
            if (G.input.onScreen(en)) G.rtscam.shake = 1.2;
          }
          if (en.owner === me) G.hud.message(`${G.data.text(en.name).name} destroyed`, 'bad');
          break;
        }
        case 'shoot': {
          if (!vis(e.pos)) break;
          const id = (e.weapon.projectile || '').toLowerCase();
          if (/bullet|mg|gun|rocket|rpg/.test(id)) fx.muzzle(e.pos, null);
          break;
        }
        case 'impact': {
          if (!vis(e.pos)) break;
          const sp = e.big ? 10 : e.weapon ? e.weapon.splash : 0;     // e.big: mines / torpedo turtle blasts
          if (e.splash) { fx.explosion(e.pos, sp > 6 ? 1.2 : 0.6); A && A.play(sp > 6 ? 'FX_CMedExplo02' : 'FX_CMedExplo01', e.pos); }
          else { fx.dust(e.pos, 0.6); if (!e.target && e.weapon) A && A.hit(e.weapon.fx, 'Ground', e.pos); }
          break;
        }
        case 'hit': {
          const t = e.target;
          if (!vis(t.pos)) break;
          const p = t.pos.clone(); p.y += (t.height || 2) * 0.5;
          if (t.kind === 'unit' && t.cls !== 'VHCL') fx.blood(p, 4);
          A && A.hit(e.weapon && e.weapon.fx, (t.def && t.def.fx) || 'Unit', t.pos);
          break;
        }
        case 'healfx':
          if (vis(e.to.pos)) fx.spawn('glow', e.to.pos.clone().setY(e.to.pos.y + e.to.height * 0.6), { size: 1.2, size1: 2.5, life: 0.5, color: 0x9dffa0 });
          break;
        case 'revealarea': if (e.player === me) (G.reveals || (G.reveals = [])).push({ x: e.x, z: e.z, r: e.r, until: e.until }); break;
        case 'trap': if (e.victim.owner === me) G.hud.message('A trap was sprung!', 'bad'); break;
        case 'warpgate': {
          const mine = e.building.owner === me;
          const txt = { started: 'A warp gate is being built', finished: 'A warp gate is complete - it must be destroyed within 10 minutes', destroyed: 'A warp gate was destroyed', won: 'The warp gate has opened' }[e.state];
          if (txt) G.hud.message((mine ? 'Your warp gate: ' : 'Enemy warp gate: ') + txt, mine ? 'good' : 'bad');
          if (e.state !== 'destroyed') G.pings.push({ x: e.building.pos.x, z: e.building.pos.z, t: W.time });
          break;
        }
        case 'boarded': if (e.unit.owner === me && A) A.playFirst(['ui_board', 'ui_click']); break;
        case 'treefall': if (vis(e.node.pos)) { fx.dust(e.node.pos.clone(), 3); A && A.play('FX_CLandScapeHit', e.node.pos); } break;
      }
    }
  }
}
