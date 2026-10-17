// The computer player's trade route (goals/AiGoalManageMarketPlaces.usl; docs/spec/ai_group6.md §3): a market at
// home and one at an outpost 150-250 m away, towers along the way, carts shuttling between them.
//
//   * Only a Schnecke on a skirmish map from epoch 2, when the map's AI options allow a market outpost
//     ("markplace_outpost"; EM:527-537). SEAS has no cart (its steelwork trades nothing): no route.
//   * The place (MP:279-410): an outpost or a stone deposit 150-250 m from the start location, else a point of a ring
//     there, the farther the better; the way there must exist, end within 8 m of it, be at most 350 m long, and its
//     security points - every 60 m beyond the first 60 - lie away from enemies (64 m) and hunting animals (32 m).
//     Then an EmptyOutpost there (ai/outposts.js). Five failures: no trade.
//   * A small tower at every security point that has none within 68 m; a market at home and at the outpost.
//   * Trading: every third think (about 30-40 s) one more cart - an idle one of the village, else trained at the
//     home market - at most 6 (the original has no limit: its carts would starve the army of the remake, whose carts
//     really earn); idle carts go to the market farther from them. With a cart the route is "ready" (the outposts'
//     fighters go home).
//   * A damaged outpost market calls a quick attack on the enemies at it (the original's has no targets: MP:793-818).
const R_ROUTE = [150, 250], MAX_PATH = 350, SEC = 60, MAX_CARTS = 6;
const MARKET = { Hu: 'hu_warehouse', Aje: 'aje_bazaar', Ninigi: 'ninigi_warehouse' };
const CART = { Hu: 'hu_cart', Aje: 'aje_trade_dino', Ninigi: 'ninigi_cart' };
const TOWER = { Hu: 'hu_small_tower', Aje: 'aje_small_tower', Ninigi: 'ninigi_small_tower' };

export const TradeAI = {
  tradeActive(S) {
    return !!(this.multimap && this.personality === 'Schnecke' && S.age >= 2 && this.mapOptions.markplace_outpost && MARKET[this.p.tribe] && this.start && !this.economyOff &&
      (this.gameType || 'Deathmatch') === 'Deathmatch');                       // market places only in Deathmatch (EM:527-537)
  },
  tradeThink(S) {
    if (!this.tradeActive(S)) return;
    const W = this.W, p = this.p;
    const T = this.trade || (this.trade = { state: 'planning', tries: 0, outpost: null, sec: [], n: 0 });
    if (T.state === 'off') return;
    if (T.state === 'planning') {
      const r = this.planTradeRoute(S);
      const id = r ? this.startOutpost(r.pos, 'EmptyOutpost') : null;
      if (!id) { if (++T.tries >= 5) T.state = 'off'; return; }
      T.outpost = this.outposts.find((o) => o.id === id);
      T.sec = r.sec.map((pt, i) => ({ pos: pt, id: 'sec' + i }));
      T.state = 'building';
      return;
    }
    const o = T.outpost;
    if (!o) { T.state = 'planning'; return; }
    T.n++;
    const mk = MARKET[p.tribe], cart = CART[p.tribe];
    const markets = S.blds.filter((b) => b.name === mk);
    const homeM = markets.find((b) => Math.hypot(b.pos.x - this.start.x, b.pos.z - this.start.z) < 90);
    const farM = markets.find((b) => Math.hypot(b.pos.x - o.pos.x, b.pos.z - o.pos.z) <= 60);
    // towers along the way, the markets
    for (const s of T.sec) if (!S.blds.some((b) => b.name === TOWER[p.tribe] && Math.hypot(b.pos.x - s.pos.x, b.pos.z - s.pos.z) < 68)) this.addOnTop('BLDG/' + TOWER[p.tribe], '', { pos: s.pos, outpost: s });
    if (!homeM) this.addOnTop('BLDG/' + mk, '', { pos: this.start, outpost: { pos: this.start, id: 'home' } });
    if (!farM) this.addOnTop('BLDG/' + mk, '', { pos: o.pos, outpost: o });
    T.state = homeM && homeM.built && farM && farM.built ? 'trading' : 'building';
    if (farM && farM.built && farM.hp < farM.maxHp * 0.9 && !(farM.lastHit && W.time - farM.lastHit > 20)) {
      const foes = this.wallFoes(farM.pos.x, farM.pos.z, 30);
      if (foes.length) this.requestAttack(S, 'quick', foes[0].owner || null, foes, { x: farM.pos.x, z: farM.pos.z });
    }
    if (T.state !== 'trading') return;
    // the carts
    const carts = S.units.filter((u) => u.name === cart && u.alive);
    if (carts.length) this.tradeReady = true;
    if (T.n % 3 === 0 && carts.length < MAX_CARTS && !homeM.queue.some((q) => q.action.results && q.action.results[0] && q.action.results[0].obj === cart)) {
      const X = this.trainable(S, cart);
      if (X && X.producer && this.canPay(X.action.cost, p.res)) W.queueAction(X.producer, X.action);
    }
    for (const c of carts) {
      if (c.task.type !== 'idle' || c.inside) continue;
      const to = Math.hypot(c.pos.x - homeM.pos.x, c.pos.z - homeM.pos.z) > Math.hypot(c.pos.x - farM.pos.x, c.pos.z - farM.pos.z) ? homeM : farM;
      c.tradeHome = to === homeM ? farM : homeM;
      W.order([c], { type: 'trade', target: to, auto: true });
    }
  },
  // the outpost's place and the route's security points -> {pos, sec: [{x, z}]} | null
  planTradeRoute(S) {
    const W = this.W, st = this.start;
    const dist = (q) => Math.hypot(q.x - st.x, q.z - st.z);
    const cands = [];
    for (const o of this.outposts || []) if (dist(o.pos) >= R_ROUTE[0] && dist(o.pos) <= R_ROUTE[1]) cands.push({ x: o.pos.x, z: o.pos.z, v: 2 });
    for (const n of W.resources) if (n.alive && n.res === 'stone' && !n.water && dist(n.pos) >= R_ROUTE[0] && dist(n.pos) <= R_ROUTE[1]) cands.push({ x: n.pos.x, z: n.pos.z, v: 1.5 });
    for (let r = R_ROUTE[0]; r <= R_ROUTE[1]; r += 25) for (let k = 0; k < 24; k++) {
      const x = st.x + Math.cos(k / 24 * 6.2832) * r, z = st.z + Math.sin(k / 24 * 6.2832) * r;
      if (W.nav.isFree(x, z)) cands.push({ x, z, v: 0.2 + 0.8 * (r - R_ROUTE[0]) / (R_ROUTE[1] - R_ROUTE[0]) });
    }
    cands.sort((a, b) => b.v - a.v);
    let tried = 0;
    for (const c of cands) {
      if (tried++ > 40) break;
      if (this.tradeDanger(c, 64, 32)) continue;
      const r = this.tradeRoute(c);
      if (r) return r;
    }
    return null;
  },
  tradeDanger(q, rEnemy, rBeast) {
    const W = this.W;
    for (const u of W.units) {
      if (!u.alive || u.inside) continue;
      const d = Math.hypot(u.pos.x - q.x, u.pos.z - q.z);
      if ((d <= rEnemy && this.isEnemyEntity(u) && !u.isWorker) || (d <= rBeast && u.wild && u.def.aggressive === 1)) return true;
    }
    for (const b of W.buildings) if (this.isEnemyEntity(b) && Math.hypot(b.pos.x - q.x, b.pos.z - q.z) <= rEnemy) return true;
    return false;
  },
  // CheckRoute: the way, its length, its security points
  tradeRoute(c) {
    const W = this.W, st = this.start, nav = W.nav;
    const path = nav.find(st.x, st.z, c.x, c.z, 0.7, 30000, this.p);
    if (!nav.found || !path || !path.length) return null;
    const last = path[path.length - 1];
    if (Math.hypot(last[0] - c.x, last[1] - c.z) > 8) return null;
    let len = 0, px = st.x, pz = st.z, next = SEC * 2;
    const sec = [];
    for (const [x, z] of path) {
      const d = Math.hypot(x - px, z - pz);
      // the points every 60 m beyond the first 60 m
      while (len + d >= next) { const f = (next - len) / d; sec.push({ x: px + (x - px) * f, z: pz + (z - pz) * f }); next += SEC; }
      len += d; px = x; pz = z;
    }
    if (len > MAX_PATH) return null;
    if (sec.some((q) => this.tradeDanger(q, 64, 32))) return null;
    return { pos: { x: c.x, z: c.z }, sec };
  },
};
