// Player feedback for world events: sounds (original sound events), effects, messages, minimap pings.
// Mirrors the original client scripts: Game/mgr/UISndMgr.usl (selection/order acknowledgements with the
// "voice_<class>_<type>" -> "voice_<type>" fallback chain) and Game/Game.usl (Placed, Delivered, NextAge, ...).
import * as THREE from 'three';
import { GameFx } from './gamefx.js';

const EPOCH = ['', 'I', 'II', 'III', 'IV', 'V'];
const ORDER_TYPE = { move: 'task_goto', attack: 'task_attack', attackmove: 'task_attack_walk', amove: 'task_attack_walk',
  build: 'task_build', heal: 'task_healing', rally: 'task_goto', wood: 'task_get_wood', stone: 'task_get_stone', food: 'task_get_food' };

export class Feedback {
  constructor(G) {
    this.G = G;
    this.alertT = -99;
    this.rep = { e: null, n: 0 };
  }
  // the game's effect models (ui/gamefx.js on engine/modelfx.js): made with the world
  get gfx() { const G = this.G; if (!this._gfx || this._gfx.m !== G.mfx) this._gfx = new GameFx(G, G.mfx); return this._gfx; }
  // a unit being healed glows (FightingObj.HealMe: AddFX "fx_heal_passive" on the unit, gone 2.5 s after the last heal)
  healGlow(u) {
    const m = this.G.mfx, k = 'heal:' + u.id, h = m.keyed.get(k);
    if (h) h.until = this.G.world.time + 2.5; else m.attach(u, 'fx_heal_passive', 2.5, { key: k });
  }
  // a newsticker line of the game (Texts/newsticker: "_NT_Artefact_Gain" ...; %1 = the item's name)
  ticker(e) {
    const D = this.G.data;
    let t = D.ui(e.key, e.text || e.key);
    if (/DUMMY/.test(t)) t = e.text || '';          // (_NT_PickUpFailInvFull has no text in the game)
    // %1 %2 %3: the item's name, or the arguments (one or a list)
    const args = e.item ? [D.text(e.item).name || e.item] : Array.isArray(e.arg) ? e.arg : e.arg != null ? [e.arg] : [];
    t = t.replace(/%(\d)/g, (m, i) => (args[+i - 1] != null ? String(args[+i - 1]) : ''));
    // a computer player's chat line (ai/chat.js): "<its name>: <text>"
    return e.from && e.from.name ? e.from.name + ': ' + t : t;
  }
  itemGlow(u, on) {
    const m = this.G.mfx;
    if (!m) return;
    if (on) m.attach(u, 'fx_unique_pickup', Infinity, { key: 'item:' + u.id }); else m.stop('item:' + u.id);
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
    const vis = (p) => !!p && G.fow.visible(p.x, p.z);
    const gfx = this.gfx;
    gfx.status(1 / 60);
    for (const e of events) {
      switch (e.type) {
        case 'msg': if (e.player === me) G.hud.message(e.key ? this.ticker(e) : e.text, e.kind || ''); break;
        // an item taken: its sound and the glow on its carrier while it carries it (FightingObj.AddItem: event 38,
        // AddItemName "fx_unique_pickup"); dropped: the glow goes
        case 'itemTaken': if (vis(e.unit.pos)) A && A.play('FX_CPickupItem', e.unit.pos); this.itemGlow(e.unit, true); break;
        case 'itemDropped': this.itemGlow(e.unit, false); break;
        case 'storagefull': if (e.player === me) { G.hud.message('Storage full', 'warn'); A && A.playFirst([`ui_no_${e.res}`, 'ui_no_storage']); } break;
        case 'placed': if (vis(e.building.pos)) gfx.placed(e.building); if (e.building.owner === me && A) { A.playFirst(['ui_' + me.tribe.toLowerCase() + '_placed', 'ui_placed']); A.ack(['voice_' + me.tribe.toLowerCase() + '_placed', 'voice_placed']); } break;
        case 'built':
          if (vis(e.building.pos)) gfx.built(e.building);
          if (e.building.owner === me) { G.hud.message(`${G.data.text(e.building.name, e.building.owner).name} completed`); A && A.play('FX_CBuildingReadyFX', e.building.pos); }
          break;
        case 'delivered':
          if (e.unit.owner === me && A && G.input.onScreen(e.unit)) A.playFirst([`ui_${e.unit.name}_delivered`]);
          break;
        case 'spawnfx': if (vis(e.unit.pos)) gfx.spawned(e.unit); break;      // a mission's unit leaves its building (CTheLite)
        case 'trained':
          if (vis(e.unit.pos)) gfx.spawned(e.unit);
          if (e.unit.owner === me && A) A.play('FX_CTecFX_CharacterSpawnFX', e.unit.pos) || A.play('Confirmping_Build_Character_Fx');
          if (e.unit.owner === me && G.minimap) G.minimap.marker('Finished', e.unit.pos.x, e.unit.pos.z);
          break;
        case 'upgrade': {
          const a = e.action;
          if (/^age_\d$/.test(a.id)) {
            const txt = `Epoch ${EPOCH[+a.id.slice(4)]}`;
            G.hud.message(e.player === me ? `${txt} reached!` : `The ${e.player.name} have reached ${txt}`, e.player === me ? 'good' : 'warn');
            if (e.player === me && A) { A.playFirst(['ui_nextage']); A.ack(['voice_nextage']); }
          } else if (e.player === me) { G.hud.message(`${G.data.actionText(a).name} researched`, 'good'); A && A.playFirst(['ui_invention']); }
          if (e.entity && e.entity.pos && vis(e.entity.pos)) gfx.invented(e.entity);
          if (e.player === me && e.entity && e.entity.pos && G.minimap) G.minimap.marker('Finished', e.entity.pos.x, e.entity.pos.z);     // (FeedbackEventMgr.usl:105-111)
          break;
        }
        case 'levelup':
          if (vis(e.unit.pos)) {
            if (!gfx.levelUp(e.unit)) fx.spawn('glow', e.unit.pos.clone().setY(e.unit.pos.y + e.unit.height * 0.6), { size: 3, size1: 7, life: 0.8 });
            A && A.play(e.unit.cls === 'CHTR' ? 'FX_CLevelUpFX' : 'FX_CLevelUpFX_Transport', e.unit.pos);
          }
          break;
        case 'attacked': {
          const en = e.entity;
          if (en.owner === me) {
            // the minimap's attack marker: the hits of 0.15 s gathered, one marker at their middle (FeedbackEventMgr.usl:72-103)
            if (!this.hits) { this.hits = []; this.hitsT = W.time; }
            this.hits.push([en.pos.x, en.pos.z]);
            // the warning: at most every 10 s (Player.usl WARN_UNDER_ATTACK_TIME)
            if (W.time - this.alertT > 10) {
              this.alertT = W.time;
              G.hud.message(en.kind === 'building' ? 'Your base is under attack!' : 'Your units are under attack!', 'bad');
              G.pings.push({ x: en.pos.x, z: en.pos.z, t: W.time });
              A && A.playFirst(['ui_warn_under_attack']);
            }
          }
          break;
        }
        case 'died': {
          const en = e.entity;
          if (vis(en.pos)) {
            const p = en.pos.clone(); p.y += en.height * 0.4;
            if (!gfx.died(en)) { if (en.cls === 'VHCL') fx.explosion(p, 1); else fx.blood(p, 12); }
            if (en.cls === 'VHCL' && A) A.play('FX_CVehicleExplosion', en.pos);
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
          }
          if (en.owner === me) G.hud.message(`${G.data.text(en.name, en.owner).name} destroyed`, 'bad');
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
          if (gfx.impact(e)) break;                // the game's hit effect; without its models, the drawn ones below
          const sp = e.big ? 10 : e.weapon ? e.weapon.splash : 0;     // e.big: mines / torpedo turtle blasts
          if (e.splash) { fx.explosion(e.pos, sp > 6 ? 1.2 : 0.6); A && A.play(sp > 6 ? 'FX_CMedExplo02' : 'FX_CMedExplo01', e.pos); }
          else { fx.dust(e.pos, 0.6); if (!e.target && e.weapon) A && A.hit(e.weapon.fx, 'Ground', e.pos); }
          break;
        }
        case 'hit': {
          const t = e.target;
          if (!vis(t.pos)) break;
          const p = t.pos.clone(); p.y += (t.height || 2) * 0.5;
          if (!e.melee || !gfx.melee(t, e.attacker && e.attacker.pos)) { if (t.kind === 'unit' && t.cls !== 'VHCL' && e.melee) fx.blood(p, 4); }
          A && A.hit(e.weapon && e.weapon.fx, (t.def && t.def.fx) || 'Unit', t.pos);
          break;
        }
        case 'healfx': if (e.to.kind === 'unit') this.healGlow(e.to); break;
        // deleted by a mission (world.removeEntity): no death effects, just out of the selection and the groups
        case 'removed': { const en = e.entity; if (en.owner === me) { const L = G.input.groups; for (const k in L) L[k] = L[k].filter((x) => x !== en); } if (G.sel.delete(en)) G.selChanged(true); break; }
        case 'owner': { const en = e.entity; if (e.from === me) { const L = G.input.groups; for (const k in L) L[k] = L[k].filter((x) => x !== en); if (G.sel.delete(en)) G.selChanged(true); } break; }
        // _NT_DiplChangeEnemyAttacked: an attack order on a neutral player started a war (FightingObj.usl:6613-6617)
        case 'diplomacy': if (e.attacked && !G.world.rules.multiplayer && (e.a === me || e.b === me)) G.hud.message(`You are now at war with the ${(e.a === me ? e.b : e.a).name}`, 'bad'); break;
        case 'revealarea': if (e.player === me) (G.reveals || (G.reveals = [])).push({ x: e.x, z: e.z, r: e.r, until: e.until }); break;
        case 'trap': if (e.victim.owner === me) G.hud.message('A trap was sprung!', 'bad'); break;
        case 'warpgate': {
          const mine = e.building.owner === me;
          const txt = { started: 'A warp gate is being built', finished: 'A warp gate is complete - it must be destroyed within 10 minutes', destroyed: 'A warp gate was destroyed', won: 'The warp gate has opened' }[e.state];
          if (txt) G.hud.message((mine ? 'Your warp gate: ' : 'Enemy warp gate: ') + txt, mine ? 'good' : 'bad');
          if (e.state !== 'destroyed') { G.pings.push({ x: e.building.pos.x, z: e.building.pos.z, t: W.time }); G.minimap && G.minimap.marker('Attack', e.building.pos.x, e.building.pos.z); }
          break;
        }
        case 'boarded': if (e.unit.owner === me && A) A.playFirst(['ui_board', 'ui_click']); break;
        case 'treefall': if (G.logs) G.logs.fell(e.node); break;
        case 'timbergone': if (G.logs) G.logs.gone(e.node); break;
        case 'damagestage': if (vis(e.entity.pos)) gfx.damaged(e.entity); break;
        // the MIRAGE moves (game/systems/moves_mirage.js): sounds, effect models on units / at points / flying, blasts
        case 'sfx': if (vis(e.pos) && A) A.play(e.name, e.pos); break;
        case 'fx': if (e.until > W.time) gfx.m.attach(e.entity, e.gfx, e.until - W.time, { key: e.key + ':' + e.entity.id, link: e.link, offset: e.offset || 0 }); else gfx.m.stop(e.key + ':' + e.entity.id); break;
        case 'fxAt': if (vis(e.pos)) gfx.m.at(e.gfx, e.pos, e.until - W.time, { loop: !!e.loop, rot: e.yaw }); break;
        case 'fxFly': if (vis(e.to)) gfx.m.fly(e.gfx, e.from, e.to, e.T); break;
        case 'camshake': gfx.camShake(e.cls, e.pos); break;
        case 'blast': if (vis(e.pos)) { if (!gfx.blast(e.pos)) fx.explosion(e.pos, 1.5); A && A.play('FX_CBigBuildingExplosion', e.pos); } break;
      }
    }
    if (this.hits && W.time - this.hitsT >= 0.15) {
      const n = this.hits.length, x = this.hits.reduce((s, h) => s + h[0], 0) / n, z = this.hits.reduce((s, h) => s + h[1], 0) / n;
      this.hits = null;
      if (G.minimap) G.minimap.marker('Attack', x, z);
      if (A) A.mus.attack(x, z, W.time);     // the music's combat switch (Game.usl MiniMapEvent -> MusicMgr.OnUnderAttack)
    }
  }
}
