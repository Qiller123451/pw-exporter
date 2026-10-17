// The skirmish setup window (the original's pre-game window in skirmish mode: PlayerListWindow with its Players and
// Settings pages, LobbySettingsPage, PlayerInfoSlot; docs/spec/ui_groups7_9.md §10): the map and the game
// options on top, the eight player slots below. The setup (game/skirmish.js) is kept in the settings
// (settings.skirmishSetup) and handed to the menu's start hook as the game's config.
//
//   skirmishWindow(menu)   opens it in the menu's window

import { PLAYER_COLORS } from '../game/colors.js';
import { MAX_SLOTS, MODES, MODE_OF_TYPE, PERSONALITIES, POINTS, TRIBES, activeSlots, applyMode, loadSetup, openSlot, validate } from '../game/skirmish.js';
import { mpSettings } from '../game/maps/source.js';
import { MAX_PLAYERS as GENERATED_PLAYERS } from '../game/mapgen.js';
import { listMaps, loadMapInfo, drawPreview } from './mappreview.js';
import { TRIBE_INFO, saveSettings } from './menu.js';
import { armyPage } from './pointbuy.js';
import { PointBuy } from '../game/pointbuy.js';

const esc = (t) => String(t == null ? '' : t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const opts = (list, cur) => list.map(([v, label]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(label)}</option>`).join('');
const range = (a, b, step = 1) => { const r = []; for (let v = a; v <= b; v += step) r.push(v); return r; };
const POINT_NAMES = { '-1': 'Predefined', 1000: '1000', 3000: '3000', 10000: '10000' };
// the map list's game types: a map without them (an older toolkit's list) is a deathmatch map
const mapModes = (m) => (m.modes && m.modes.length ? m.modes : ['Deathmatch']).map((t) => MODE_OF_TYPE[t]).filter(Boolean);

export function skirmishWindow(menu) {
  const s = menu.G.settings;
  const setup = s.skirmishSetup = loadSetup(s.skirmishSetup, s.skirmish);
  const D = menu.G.data, PB = new PointBuy(D, menu.G.aiData);
  // the chosen map: {maxPlayers, modes, slots (tribes of each start location)}; the random jungle: up to 4 players
  let mp = { maxPlayers: GENERATED_PLAYERS, gameTypes: ['Deathmatch'], slots: {} }, maps = [], mapError = null;
  const save = () => saveSettings(s);

  menu.open('Skirmish', `<div class="skirm">
    <div class="pwgrp sk-map"><b>Map</b><div class="mapsel">
      <canvas id="k_prev" width="150" height="150"></canvas>
      <div class="mapinfo">
        <select class="pwsel" id="k_map"></select>
        <label class="pwbtn small mapfile">Open map file…<input type="file" id="k_file" accept=".ula" hidden></label>
        <div class="seedrow" id="k_seedrow"><span>Seed</span> <input class="pwsel" id="k_seed" type="number" value="${+setup.seed || 1}" style="width:90px"></div>
        <div class="mapdesc" id="k_desc"></div>
      </div></div></div>
    <div class="pwgrp sk-opts"><b>Settings</b><div class="set">
      <span>Game type</span><select class="pwsel" id="k_mode">${opts(Object.entries(MODES), setup.mode)}</select>
      <span>Defender countdown (minutes)</span><select class="pwsel" id="k_defmin">${opts(range(5, 300, 5).map((v) => [v, v]), setup.defenderMin)}</select>
      <span>Teams</span><select class="pwsel" id="k_teams"></select>
      <span>Points</span><select class="pwsel" id="k_points">${opts(POINTS.map((v) => [v, POINT_NAMES[v]]), setup.points)}</select>
      ${check('k_warp', 'Warp gate victory (epoch V: hold a finished warp gate for 10 minutes)')}
      ${check('k_fog', 'Disable fog of war')}
      ${check('k_lock', 'Lock diplomacy settings')}
      ${check('k_hcap', 'Allow player handicap')}
      ${check('k_hq', 'Choose headquarters position')}
      ${check('k_debug', 'Debug mode: everything is free and builds instantly (for you, not the computer)')}
    </div></div>
    <div class="pwgrp sk-players"><b>Players</b><table class="slots"><thead><tr>
      <th data-col="name">Player</th><th data-col="tribe">Tribe</th><th data-col="army">Army</th><th data-col="level">AI level</th>
      <th data-col="team">Team</th><th data-col="color">Colour</th><th data-col="hp">HP</th><th data-col="hq">HQ</th></tr></thead>
      <tbody id="k_slots"></tbody></table>
      <div class="sk-err" id="k_err"></div></div>
  </div>
  <div class="btns row">${menu.btn('back', 'Back', 'small')}${menu.btn('start', 'Start game', 'small')}</div>`, { title: true });
  const W = menu.win, $ = (q) => W.querySelector(q);
  W.classList.add('wide');
  const leave = () => W.classList.remove('wide');

  function check(id, label) { return `<label class="pwcheck full"><input type="checkbox" id="${id}"><i></i>${label}</label>`; }

  // ------------------------------------------------------------ game options
  const optionInputs = () => {
    const m = setup.mode, act = activeSlots(setup).length;
    $('#k_mode').value = m;
    $('#k_defmin').value = setup.defenderMin;
    $('#k_defmin').disabled = m !== 'defender';
    // teams: 1..players, at least 2 with locked diplomacy (CheckNumTeams LSP:453-474); Defender: two sides
    const lo = setup.lockDiplomacy || m === 'defender' ? 2 : 1, hi = m === 'defender' ? 2 : Math.max(lo, act);
    setup.teams = Math.min(hi, Math.max(lo, setup.teams));
    $('#k_teams').innerHTML = opts(range(lo, hi).map((v) => [v, v]), setup.teams);
    $('#k_teams').disabled = m === 'defender';
    if (!PB.ready) setup.points = -1;                  // game data from before the army budget: rebuild it
    $('#k_points').value = setup.points;
    $('#k_points').disabled = !PB.ready;
    const box = (id, v, off) => { const c = $(id); c.checked = !!v; c.disabled = !!off; c.parentElement.classList.toggle('off', !!off); };
    box('#k_warp', setup.warpgate);
    box('#k_fog', !setup.fog);
    box('#k_lock', setup.lockDiplomacy, m !== 'deathmatch' || setup.teams < 2);
    box('#k_hcap', setup.handicap);
    box('#k_hq', setup.chooseHQ, m === 'defender');
    box('#k_debug', setup.debug);
  };
  $('#k_mode').onchange = () => { applyMode(setup, $('#k_mode').value); fillMaps(); refresh(); };
  $('#k_defmin').onchange = () => { setup.defenderMin = +$('#k_defmin').value; refresh(); };
  $('#k_teams').onchange = () => { setup.teams = +$('#k_teams').value; refresh(); };
  $('#k_points').onchange = () => { setup.points = +$('#k_points').value; refresh(); };
  $('#k_warp').onchange = () => { setup.warpgate = $('#k_warp').checked; refresh(); };
  $('#k_fog').onchange = () => { setup.fog = !$('#k_fog').checked; refresh(); };
  $('#k_lock').onchange = () => { setup.lockDiplomacy = $('#k_lock').checked; refresh(); };
  // unchecking the handicap resets every slot to 100 % (LSP:611-630), unchecking "choose HQ" numbers them 1.. (LSP:567-588)
  $('#k_hcap').onchange = () => { setup.handicap = $('#k_hcap').checked; if (!setup.handicap) setup.slots.forEach((sl) => { sl.hp = 100; }); refresh(); };
  $('#k_hq').onchange = () => { setup.chooseHQ = $('#k_hq').checked; if (!setup.chooseHQ) setup.slots.forEach((sl, i) => { sl.hq = i; }); refresh(); };
  $('#k_debug').onchange = () => { setup.debug = $('#k_debug').checked; refresh(); };
  $('#k_seed').onchange = () => { setup.seed = +$('#k_seed').value || 1; save(); };

  // ------------------------------------------------------------ the player slots
  // the tribes a slot may play: those of its start location on the map (Restrictions/Base/Tribes), with random head
  // quarters those of any start location; "Random" when there is a choice (PIS:383-415)
  const tribesOf = (sl) => {
    const slotTribes = (hq) => ((mp.slots[hq] && mp.slots[hq].tribes) || TRIBES).filter((t) => TRIBES.includes(t));
    const list = setup.chooseHQ ? slotTribes(sl.hq) : [...new Set(range(0, mp.maxPlayers - 1).flatMap(slotTribes))];
    return list.length ? list : TRIBES;
  };
  const swatches = (sl, i) => PLAYER_COLORS.map((c) => `<i class="pc ${c.id === sl.color ? 'on' : ''}" data-slot="${i}" data-c="${c.id}" title="${c.name}" style="background:rgb(${c.light.join(',')})"></i>`).join('');
  const slotRow = (sl, i) => {
    const closed = sl.type === 'closed', ai = sl.type === 'ai', tribes = tribesOf(sl);
    if (!closed && sl.tribe !== 'Random' && !tribes.includes(sl.tribe)) sl.tribe = tribes.length > 1 ? 'Random' : tribes[0];
    sl.team = Math.min(Math.max(1, sl.team), setup.teams);
    const icon = TRIBE_INFO[sl.tribe] ? TRIBE_INFO[sl.tribe].icon : 4;
    const name = i === 0 ? '<span class="you">You</span>' : `<select class="pwsel" data-f="type">${opts([['ai', 'Computer'], ['closed', 'Closed']], sl.type)}</select>`;
    if (closed) return `<tr class="closed" data-i="${i}"><td>${name}</td><td colspan="7"></td></tr>`;
    const tribeOpts = [...(tribes.length > 1 ? [['Random', 'Random']] : []), ...tribes.map((t) => [t, TRIBE_INFO[t].name])];
    const team = setup.mode === 'defender' ? `<span>${!setup.chooseHQ ? '?' : sl.hq === 0 ? 'Defender' : 'Attacker'}</span>`
      : `<select class="pwsel" data-f="team">${opts(range(1, setup.teams).map((v) => [v, v]), sl.team)}</select>`;
    return `<tr data-i="${i}"><td>${name}</td>
      <td class="tribecell"><i class="ticon" style="background-position:0 -${icon * 21}px"></i><select class="pwsel" data-f="tribe">${opts(tribeOpts, sl.tribe)}</select></td>
      <td>${ai ? `<select class="pwsel" data-f="personality">${opts(Object.keys(PERSONALITIES).map((k) => [k, k]), sl.personality)}</select>` : armyCell(sl)}</td>
      <td>${ai ? `<select class="pwsel" data-f="level">${opts(range(0, 9).map((v) => [v, v]), sl.level)}</select>` : ''}</td>
      <td>${team}</td>
      <td class="pcolors">${swatches(sl, i)}</td>
      <td><select class="pwsel" data-f="hp" ${setup.handicap ? '' : 'disabled'}>${opts(range(50, 150, 10).map((v) => [v, v + ' %']), sl.hp)}</select></td>
      <td>${setup.chooseHQ ? `<select class="pwsel" data-f="hq">${opts(range(0, mp.maxPlayers - 1).map((v) => [v, v + 1]), sl.hq)}</select>` : '<span class="dim">random</span>'}</td></tr>`;
  };
  // the human's army (PIS:566-598): with points the default presets of that budget (Standard, Boomer, Rusher) or the
  // army bought on the "My Army" page; "Predefined" without points
  const ownArmy = (sl) => sl.army && sl.armyTribe === sl.tribe && sl.armyPoints === setup.points;
  function armyCell(sl) {
    if (setup.points < 0 || !PB.ready) return `<span class="dim">${esc(D.ui('_pb_locked', 'Predefined'))}</span>`;
    const kinds = ['standard', 'boomer', 'rusher'].map((k) => [k, D.ui('_pb_' + k, k)]);
    if (ownArmy(sl)) kinds.push(['custom', D.ui('_MyArmy', 'My Army')]);
    const cur = sl.preset === 'custom' && !ownArmy(sl) ? 'standard' : sl.preset || 'standard';
    return `<select class="pwsel" data-f="preset">${opts(kinds, cur)}</select>` +
      (sl.tribe === 'Random' ? '' : ` <button class="pwbtn small sk-army" data-army="1" title="${esc(D.ui('_UI_Tab_MyArmy_TT'))}">…</button>`);
  }
  function openArmy(i) {
    const sl = setup.slots[i], tribe = sl.tribe, credits = setup.points, total = PB.total(credits, tribe);
    const fresh = () => PB.load(PB.preset(tribe, credits, sl.preset && sl.preset !== 'custom' ? sl.preset : 'standard'), tribe, total);
    save();
    armyPage(menu, { tribe, credits, total, shown: credits, army: ownArmy(sl) ? JSON.parse(JSON.stringify(sl.army)) : fresh(), mp: true, buildings: true,
      back: () => skirmishWindow(menu),
      done: (army) => { Object.assign(sl, { army, armyTribe: tribe, armyPoints: credits, preset: 'custom' }); save(); skirmishWindow(menu); } });
  }
  const NUM = new Set(['level', 'team', 'hp', 'hq']);
  const slotInputs = () => {
    const tb = $('#k_slots');
    tb.innerHTML = setup.slots.slice(0, MAX_SLOTS).map(slotRow).join('');
    tb.querySelectorAll('select[data-f]').forEach((sel) => {
      sel.onchange = () => {
        const i = +sel.closest('tr').dataset.i, sl = setup.slots[i], f = sel.dataset.f;
        if (f === 'type') { if (sel.value === 'ai') openSlot(setup, i); else sl.type = 'closed'; } else sl[f] = NUM.has(f) ? +sel.value : sel.value;
        menu.click();
        refresh();
      };
    });
    tb.querySelectorAll('[data-army]').forEach((b) => { b.onclick = () => { menu.click(); openArmy(+b.closest('tr').dataset.i); }; });
    tb.querySelectorAll('.pc').forEach((c) => {
      c.onclick = () => { setup.slots[+c.dataset.slot].color = c.dataset.c; menu.click(); refresh(); };
    });
  };

  // ------------------------------------------------------------ validation (PLW:334-456: the offending column turns red)
  const COLUMN = [[/room for/, 'name'], [/colour/, 'color'], [/headquarters|defend/, 'hq'], [/teams/, 'team']];
  const problem = () => {
    if (mapError) return mapError;
    if (!mapModes(mp.gameTypes ? { modes: mp.gameTypes } : {}).includes(setup.mode)) return `This map has no ${MODES[setup.mode]} game.`;
    return validate(setup, mp.maxPlayers);
  };
  const showProblem = () => {
    const err = problem();
    $('#k_err').textContent = err || '';
    const col = err && (COLUMN.find(([re]) => re.test(err)) || [])[1];
    W.querySelectorAll('.slots th').forEach((th) => th.classList.toggle('bad', th.dataset.col === col));
    $('[data-a="start"]').classList.toggle('off', !!err);
    return err;
  };
  function refresh() {
    optionInputs();
    slotInputs();
    showProblem();
    save();
  }

  // ------------------------------------------------------------ maps: those of the chosen game type, "open file", the random jungle
  const sel = $('#k_map'), file = $('#k_file');
  function fillMaps() {
    sel.innerHTML = '';
    if (setup.mode === 'deathmatch') { const o = document.createElement('option'); o.value = ''; o.textContent = `Random jungle (${GENERATED_PLAYERS})`; sel.appendChild(o); }
    let group = null, lastFolder = null;
    for (const m of maps) {
      if (m.type && m.type !== 'multiplayer') continue;                // the campaign's maps: not offered (open them as a file)
      if (!mapModes(m).includes(setup.mode)) continue;
      if (m.folder !== lastFolder) { group = document.createElement('optgroup'); group.label = m.folder || 'Maps'; sel.appendChild(group); lastFolder = m.folder; }
      const o = document.createElement('option'); o.value = m.path; o.textContent = m.file.replace(/\.ula$/i, '') + (m.players ? ` (${m.players})` : ''); group.appendChild(o);
    }
    if (setup.map === 'file:' && setup.mapName) {
      const o = document.createElement('option'); o.value = 'file:'; o.textContent = setup.mapName + ' (file)'; sel.insertBefore(o, sel.firstChild);
    }
    const had = setup.map;
    sel.value = [...sel.options].some((o) => o.value === (setup.map || '')) ? (setup.map || '') : (sel.options[0] ? sel.options[0].value : '');
    setup.map = sel.value;
    if (setup.map !== had) showMap();
  }
  sel.onchange = () => { setup.map = sel.value; menu.click(); showMap(); };
  file.onchange = async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const buf = await f.arrayBuffer();
    try {
      // kept for "Restart" (the page reloads); maps are a few hundred KB
      let bin = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      sessionStorage.setItem('pwr.mapfile', btoa(bin));
    } catch (e) { /* too big for sessionStorage: restart will ask again */ }
    await loadMapInfo('file:' + f.name, buf);
    setup.map = 'file:'; setup.mapName = f.name;
    fillMaps();
    showMap();
  };
  const mapDesc = (html, bad) => { const d = $('#k_desc'); if (d) { d.innerHTML = html; d.classList.toggle('bad', !!bad); } };
  async function showMap() {
    const cv = $('#k_prev');
    if (!cv) return;
    mapError = null;
    $('#k_seedrow').style.display = setup.map ? 'none' : '';
    const ctx = cv.getContext('2d');
    if (!setup.map) {
      mp = { maxPlayers: GENERATED_PLAYERS, gameTypes: ['Deathmatch'], slots: {} };
      ctx.fillStyle = '#29401c'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#e0c890'; ctx.font = 'bold 13px Trebuchet MS'; ctx.textAlign = 'center'; ctx.fillText('random', cv.width / 2, cv.height / 2);
      mapDesc(`A new jungle for every seed: up to ${GENERATED_PLAYERS} bases, forests, herds of dinosaurs.`);
      refresh();
      return;
    }
    mapDesc('Reading the map…');
    const want = setup.map;
    try {
      const md = await loadMapInfo(want === 'file:' ? 'file:' + setup.mapName : want);
      if ($('#k_prev') !== cv || setup.map !== want) return;
      await drawPreview(cv, md);
      mp = mpSettings(md);
      const i = md.info, starts = md.objects.filter((o) => o.type === 'SLOC').length;
      mapDesc(`<b>${esc(md.name)}</b><br>${md.setting} · ${md.hx * 2} × ${md.hy * 2} m · ${mp.maxPlayers} players` +
        ` · ${mp.gameTypes.map((t) => MODES[MODE_OF_TYPE[t]] || t).join(', ')}` +
        (i.Author ? `<br>by ${esc(i.Author)}` : '') + (i.Description ? `<br><i>${esc(i.Description).slice(0, 160)}</i>` : '') +
        (starts < 2 ? '<br>No start locations - the bases are placed automatically.' : ''));
    } catch (e) {
      mapError = 'This map could not be read: ' + e.message;
      mapDesc(esc(mapError), true);
    }
    refresh();
  }

  menu.bind({
    back: () => { leave(); save(); menu.title(); },
    start: () => {
      setup.seed = +$('#k_seed').value || 1;
      if (showProblem()) return;
      save();
      leave();
      menu.close();
      if (menu.hooks.start) menu.hooks.start(JSON.parse(JSON.stringify(setup)));
    },
  });
  refresh();
  listMaps().then((list) => {
    if ($('#k_map') !== sel) return;                                   // the player went elsewhere meanwhile
    maps = list;
    fillMaps();
    showMap();
  });
}
