// The statistics screen (the original's CStatisticScreen, StatisticScreen.usl 864-982; docs/spec/ui_groups7_9.md
// §4): tabs with a row per player - Overview, Economical, Military, Buildings, Fights, Invention, Quests (campaign) -
// and the time line, a graph of one category for the players ticked. Opened from the end screen ("View Statistics").
// The Overview's columns are the engine's sums in the original [?engine]: here the totals of the other tabs.

const esc = (t) => String(t == null ? '' : t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

export function statsWindow(G, back) {
  const M = G.menu, W = G.world, D = G.data, S = W.stats;
  const ui = (k, d) => D.ui('_UI_StatScre_' + k, d);
  const players = W.players.filter((p) => !(p.data && p.data.show_statistics === false));     // (a campaign level's ShowStatistics)
  const hms = (t) => (t == null ? ui('Label_Failed', 'failed') : `${Math.floor(t / 3600)}h ${Math.floor(t / 60) % 60}min ${Math.floor(t % 60)}s`);
  const C = G.campaign;
  const quests = () => {
    const q = (C && C.data && C.data.quests || []).filter((x) => x.visible);
    const main = q.filter((x) => !x.bonus || !Object.values(x.bonus).some((v) => +v > 0));
    const done = (l) => l.filter((x) => x.accomplished).length + ' / ' + l.length;
    return [done(q), done(main), done(q.filter((x) => !main.includes(x)))];
  };
  // tab -> [column label key, value(player)]
  const TABS = [
    ['Overview', 'Overview', [['Col_Economical', 'Economical', (t) => t.food + t.wood + t.stone + t.skulls], ['Col_Units', 'Units', (t) => t.workers + t.infantry + t.animals + t.vehicles + t.ships],
      ['Col_Buildings', 'Buildings', (t) => t.eco + t.mil + t.def], ['Col_Invention', 'Invention', (t) => 1 + t.epochs.filter((x) => x != null).length]]],
    ['Economical', 'Economical', [['Col_Food', 'Food', (t) => t.food], ['Col_Wood', 'Wood', (t) => t.wood], ['Col_Stone', 'Stone', (t) => t.stone], ['Col_Skulls', 'Skulls', (t) => t.skulls],
      ['Col_Workers', 'Workers', (t) => t.workers], ['Col_Tributesend', 'Send Tribute', (t) => t.tributeSent]]],
    ['Military', 'Military', [['Col_Infantry', 'Infantry', (t) => t.infantry], ['Col_Animals', 'Animals', (t) => t.animals], ['Col_Vehicles', 'Vehicles', (t) => t.vehicles], ['Col_Ships', 'Ships built', (t) => t.ships]]],
    ['Buildings', 'Buildings', [['Col_Economybuildingsbuilt', 'Economy Buildings', (t) => t.eco], ['Col_Battlebuildingsbuilt', 'Military Buildings', (t) => t.mil], ['Col_Defensebuildingsbuilt', 'Defense Building', (t) => t.def]]],
    ['Fights', 'Fights', [['Col_Unitslost', 'Units lost', (t) => t.unitsLost], ['Col_Buildingslost', 'Buildings lost', (t) => t.buildingsLost], ['Col_Enemieskilled', 'Enemies killed', (t) => t.killed],
      ['Col_Buildingsdestroyed', 'Buildings destroyed', (t) => t.razed], ['Col_Animalskilled', 'Animals killed', (t) => t.animalKills]]],
    ['Invention', 'Invention', [2, 3, 4, 5].map((n) => ['Col_Level' + n, 'Epoch ' + n, (t) => hms(t.epochs[n])])],
  ];
  if (C) TABS.push(['Quest', 'Quests', [['Col_QuestsAll', 'Quests (All)', () => quests()[0]], ['Col_QuestsMain', 'Quests (Main)', () => quests()[1]], ['Col_QuestsBonus', 'Quests (Bonus)', () => quests()[2]]]]);
  TABS.push(['TimeLine', 'TimeLine', null]);
  // the time line's categories (SS:130-145): the stock over time, or the collected total
  const GRAPHS = [['AllUnits', 'Units', (v) => v.units], ['AllCivilians', 'Civilians', (v) => v.civil], ['AllMilitary', 'Military', (v) => v.military], ['AllBuildings', 'Buildings', (v) => v.buildings],
    ['AllResource', 'Resource', (v) => v.food + v.wood + v.stone + v.skulls], ['AllFood', 'Food', (v) => v.food], ['AllWood', 'Wood', (v) => v.wood], ['AllStone', 'Stone', (v) => v.stone], ['AllSkulls', 'Skulls', (v) => v.skulls],
    ['AllResourceTotal', 'Resource(total)', (v) => v.collected.food + v.collected.wood + v.collected.stone + v.collected.skulls], ['AllFoodTotal', 'Food(total)', (v) => v.collected.food],
    ['AllWoodTotal', 'Wood(total)', (v) => v.collected.wood], ['AllStoneTotal', 'Stone(total)', (v) => v.collected.stone], ['AllSkullsTotal', 'Skulls(total)', (v) => v.collected.skulls]];
  const hex = (p) => '#' + ((p.color >>> 0) & 0xffffff).toString(16).padStart(6, '0');
  let tab = 0, graph = 0;
  const shown = new Set(players.map((p) => p.id));
  M.inGame = true;
  M.open(ui('Label_GameStatistics', 'Game Statistics'), `<div class="stats"><div class="sttabs">${TABS.map(([k, d], i) => `<div data-t="${i}">${esc(ui('Tab_' + k, d))}</div>`).join('')}</div><div class="stbody"></div></div>
    <div class="btns row">${M.btn('ok', ui('Button_OK', 'OK'), 'small')}</div>`);
  const win = M.win;
  win.classList.add('wide');
  const body = win.querySelector('.stbody');
  function draw() {
    win.querySelectorAll('.sttabs div').forEach((d) => { d.classList.toggle('on', +d.dataset.t === tab); d.onclick = () => { tab = +d.dataset.t; M.click(); draw(); }; });
    const cols = TABS[tab][2];
    if (cols) {
      body.innerHTML = `<table class="sttable"><thead><tr><th></th>${cols.map(([k, d]) => `<th>${esc(ui(k, d))}</th>`).join('')}</tr></thead><tbody>${players.map((p) => {
        const t = S.table(p);
        return `<tr><td class="nm" style="color:${hex(p)}">${esc(p.name)}</td>${cols.map((c) => `<td>${esc(c[2](t))}</td>`).join('')}</tr>`;
      }).join('')}</tbody></table>`;
      return;
    }
    body.innerHTML = `<div class="stgraph"><div class="stctl"><span>${esc(ui('Label_Category', 'Category:'))}</span><select class="pwsel">${GRAPHS.map(([k, d], i) => `<option value="${i}" ${i === graph ? 'selected' : ''}>${esc(ui('Graph_' + k, d))}</option>`).join('')}</select>
      ${players.map((p) => `<label class="pwcheck"><input type="checkbox" data-p="${p.id}" ${shown.has(p.id) ? 'checked' : ''}><i></i><span style="color:${hex(p)}">${esc(p.name)}</span></label>`).join('')}</div>
      <canvas width="668" height="372"></canvas></div>`;
    body.querySelector('select').onchange = (e) => { graph = +e.target.value; draw(); };
    body.querySelectorAll('input[data-p]').forEach((c) => { c.onchange = () => { if (c.checked) shown.add(+c.dataset.p); else shown.delete(+c.dataset.p); draw(); }; });
    plot(body.querySelector('canvas'));
  }
  // the graph (SS:16-365): 4 vertical grid lines, 5 scale values, a line per player in its colour
  function plot(cv) {
    const ctx = cv.getContext('2d'), w = cv.width, h = cv.height, L = 44, B = 22;
    ctx.fillStyle = 'rgba(12,10,7,.85)'; ctx.fillRect(0, 0, w, h);
    const series = S.series, f = GRAPHS[graph][2];
    if (series.length < 2) { ctx.fillStyle = '#e0c890'; ctx.font = '13px Trebuchet MS'; ctx.fillText('-', w / 2, h / 2); return; }
    const t0 = series[0].t, t1 = series[series.length - 1].t;
    let max = 1;
    for (const s of series) for (const p of players) if (shown.has(p.id) && s.v[p.id]) max = Math.max(max, f(s.v[p.id]));
    const X = (t) => L + (w - L - 8) * (t - t0) / Math.max(1, t1 - t0), Y = (v) => h - B - (h - B - 8) * Math.max(0, v) / max;
    ctx.strokeStyle = 'rgba(224,185,120,.25)'; ctx.fillStyle = '#c8b48a'; ctx.font = '11px Trebuchet MS';
    for (let i = 0; i <= 4; i++) {
      const x = L + (w - L - 8) * i / 4; ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, h - B); ctx.stroke();
      const t = Math.round(t0 + (t1 - t0) * i / 4); ctx.fillText(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, x - 12, h - 6);
      const v = Math.round(max * i / 4); ctx.fillText(String(v), 4, Y(v) + 4);
    }
    for (const p of players) {
      if (!shown.has(p.id)) continue;
      ctx.strokeStyle = hex(p); ctx.lineWidth = 2; ctx.beginPath();
      let first = true;
      for (const s of series) { const v = s.v[p.id]; if (!v) continue; const x = X(s.t), y = Y(f(v)); if (first) ctx.moveTo(x, y); else ctx.lineTo(x, y); first = false; }
      ctx.stroke();
    }
  }
  M.bind({ ok: () => { win.classList.remove('wide'); back(); } });
  draw();
}
