// Mission UI (src/ui/mission.js) driven through its contract with the data of a real mission:
//   python3 tests/evaljs.py tests/mission_ui.js "&campaign=1"
// quests + news ticker + quest log, info bar, timers, minimap markers, question marks, dialogue scenes (queue, timing,
// close, mentor), cutscenes (?manual: over on the next tick; presentation with M.manual = false), skipAll, end screen.
const C = G.campaign, M = G.mission, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
if (!C || !M) { check('campaign + mission UI', false, G.error || 'G.campaign / G.mission missing'); return out.join('\n'); }
const D = C.data, $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const shown = (e) => !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
const frame = (dt = 0.016) => M.update(dt);
try {
// ---------------------------------------------------------------- start
check('mission UI built: quest button, columns, timers map', !!$('#hud .corner.tr .qbtn') && !!$('#hud .mleft .dlg') && !!$('#hud .mtop .ibar') && !!$('div.cine') && C.timers instanceof Map && M.manual === true);
check('contract methods', ['questChanged', 'infoBar', 'marker', 'removeMarker', 'playDialog', 'playSequence', 'busy', 'tick', 'update', 'skipAll'].every((k) => typeof M[k] === 'function') && Array.isArray(M.log) && Array.isArray(M.markers));
check('?manual: no title card by itself', !shown($('.mtitle')));
M.showTitle(); frame();
check('title card: mission name and description', shown($('.mtitle')) && $('.mtitle h1').textContent === C.map.title && $('.mtitle p').textContent === C.map.description, $('.mtitle h1').textContent);
frame(6.5); const fading = $('.mtitle').classList.contains('out'); frame(1);
check('title card fades and goes', fading && !shown($('.mtitle')));

// ---------------------------------------------------------------- quests
const q = (n) => D.quests.find((x) => x.name === n);
const qa = q('L01MQ01_find_stina'), qb = q('L01MQ02_vanish_the_blood_hu'), qc = q('L01SQ01_suprise_attack');
check('quests of mission 1', !!qa && !!qb && !!qc && qa.main && !qc.main, D.quests.length);
for (const x of [qa, qb, qc]) { x.visible = true; M.questChanged(x, 'shown'); }
frame();
let nts = $$('.nticker .nt');
check('news ticker: three "New quest" lines with the headlines', nts.length === 3 && nts[0].textContent.includes('New quest') && nts[0].textContent.includes(qa.headline) && nts[2].textContent.includes(qc.headline), nts.map((e) => e.textContent));
check('quest button flashes', $('.qbtn').classList.contains('new') && M.unread);
check('log: quest requests', M.log.filter((l) => l[0] === 'quest').map((l) => l[1] + ':' + l[2]).join() === [qa, qb, qc].map((x) => x.name + ':shown').join());
const wasPaused = G.paused;
check('quest log opens', M.openLog() === true && G.menuOpen && M.logOpen && shown($('.modal')) && G.paused === true);
let groups = $$('.qlist .qg').map((e) => e.firstChild.textContent), rows = $$('.qlist .q');
check('log: main quests under their group titles, side quests under "Subquests"', groups.join('|') === [qa.group_title, qb.group_title, 'Subquests'].join('|') && rows.length === 3 && rows.every((r) => r.classList.contains('open') && r.classList.contains('new')), groups);
check('log: headline and description of the selected quest', $('.qtext b').textContent === qa.headline && $('.qtext .qdesc').textContent === qa.description && $('.qlist .q.on span').textContent === qa.headline);
check('log: points 0 of the three bonuses', $('.qtotal').textContent === `Points: 0 / ${[qa, qb, qc].reduce((s, x) => s + x.bonus.medium, 0)}`, $('.qtotal').textContent);
rows[2].click();
check('log: a click selects a quest', $('.qtext b').textContent === qc.headline && rows[2].classList.contains('on') && !rows[0].classList.contains('on'));
M.closeLog();
check('log closed: game runs again, button calm', !G.menuOpen && !M.logOpen && G.paused === wasPaused && !$('.qbtn').classList.contains('new'));
qa.accomplished = true; M.questChanged(qa, 'done');
qc.unaccomplishable = true; M.questChanged(qc, 'failed');
frame();
nts = $$('.nticker .nt');
check('news ticker: accomplished + unaccomplishable', nts.length === 5 && nts[3].classList.contains('good') && nts[3].textContent.includes('Quest accomplished') && nts[4].classList.contains('bad') && nts[4].textContent.includes(qc.headline), nts.slice(3).map((e) => e.textContent));
check('L opens the log', M.key({ code: 'KeyL' }) === true && M.logOpen);
rows = $$('.qlist .q');
check('log: accomplished ticked, failed crossed out, open one no longer new', rows[0].classList.contains('done') && rows[1].classList.contains('open') && !rows[1].classList.contains('new') && rows[2].classList.contains('failed') && getComputedStyle(rows[2].querySelector('span')).textDecorationLine === 'line-through',
  rows.map((r) => r.className));
check('log: points of the accomplished quest', $('.qtotal').textContent.startsWith(`Points: ${qa.bonus.medium} /`) && $$('.qlist .qg em')[0].textContent === `${qa.bonus.medium}/${qa.bonus.medium}`, $('.qtotal').textContent);
check('L closes the log', M.key({ code: 'KeyL' }) === true && !M.logOpen && !G.menuOpen);
nts[0].click();
check('a click on a quest line opens the log at that quest', M.logOpen && $('.qtext b').textContent === qa.headline && $$('.nticker .nt').length === 4);
G.closeMenu();
frame(11.5); const fade = $$('.nticker .nt.fade').length; frame(1);
check('ticker lines fade and go after their time', fade === 4 && $$('.nticker .nt').length === 0, fade);
qb.visible = false; M.questChanged(qb, 'hidden'); frame();
check('a hidden quest: no ticker line, not in the log', $$('.nticker .nt').length === 0 && M.questGroups().every((g) => !g.quests.includes(qb)));
qb.visible = true;

// ---------------------------------------------------------------- info bar, timers
M.infoBar('Mammoths saved: 2 of 5'); frame();
check('info bar shows the line', shown($('.ibar')) && $('.ibar').textContent === 'Mammoths saved: 2 of 5' && M.bar === 'Mammoths saved: 2 of 5');
const msgTop = parseFloat(G.hud.msgs.style.top);
check('HUD messages moved below the info bar', msgTop > $('.ibar').getBoundingClientRect().bottom - 1, msgTop);
C.timers.set(1, { id: 1, left: 75.2, show: 1, label: 'Until the attack', paused: false });
C.timers.set(2, { id: 2, left: 3725, show: true, label: 'Pumping station', paused: true });
C.timers.set(0, { id: 0, left: 30, show: 0, label: 'hidden wave timer', paused: false });
frame();
let tm = $$('.mtimers .mtimer');
check('timers: two shown with time and label, the hidden one not', tm.length === 2 && tm[0].textContent === '01:16Until the attack' && tm[1].textContent === '1:02:05Pumping station' && tm[1].classList.contains('paused') && !tm[0].classList.contains('low'), tm.map((e) => e.textContent));
C.timers.get(1).left = 8.4; C.timers.delete(2); frame();
tm = $$('.mtimers .mtimer');
check('timers: follow the map (last seconds red, deleted timer gone)', tm.length === 1 && tm[0].firstChild.textContent === '00:09' && tm[0].classList.contains('low'), tm.map((e) => e.textContent));
C.timers.clear(); M.infoBar(''); frame();
check('info bar and timers cleared', !shown($('.ibar')) && $$('.mtimers .mtimer').length === 0 && G.hud.msgs.style.top === '');

// ---------------------------------------------------------------- minimap markers
const cam = G.rtscam, hero = G.world.units.find((u) => u.alive && u.owner === G.me);
M.marker({ id: 'main', x: -200, z: -100, entity: null, color: 0xff0000, kind: 'SPMainQuest', extended: 1, ttl: 0, repeats: 0, interval: 0 });
M.marker({ id: 'opt', x: 200, z: -100, entity: null, color: 0xff0000, kind: 'SPOptQuest', extended: 1, ttl: 0, repeats: 0, interval: 0 });
M.marker({ id: 'hint', x: -200, z: 100, entity: null, color: 0xff0000, kind: 'SPHint', extended: 0, ttl: 0, repeats: 0, interval: 0 });
M.marker({ id: 'attack', x: 200, z: 100, entity: null, color: 0xff0000, kind: 'Attack', extended: 0, ttl: 4, repeats: 2, interval: 1 });
M.marker({ id: 'fixed', x: 0, z: 0, entity: hero, color: 0x3060ff, kind: 'FixedColor', extended: 1, ttl: 0, repeats: 0, interval: 0 });
M.marker({ id: 'main', x: 0, z: -250, entity: null, color: 0, kind: 'SPMainQuest', extended: 0, ttl: 0, repeats: 0, interval: 0 });
const col = (id) => M.markers.find((m) => m.id === id).color;
check('markers: colours of the original types, fixed colour kept', M.markers.length === 6 && col('main') === 0xffc864 && col('opt') === 0xc8c8c8 && col('hint') === 0x007800 && col('attack') === 0xff0000 && col('fixed') === 0x3060ff);
const fx = M.markers.find((m) => m.id === 'fixed');
check('marker on an entity starts at its place', !!hero && fx.x === hero.pos.x && fx.z === hero.pos.z);
G.minimap.update(0, true);
const px = (m) => { const [x, y] = G.minimap.w2m(m.x, m.z); const d = G.minimap.ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data; return [d[0], d[1], d[2]]; };
const near = (a, c) => Math.abs(a[0] - (c >> 16 & 255)) + Math.abs(a[1] - (c >> 8 & 255)) + Math.abs(a[2] - (c & 255)) < 40;
check('minimap draws the markers in their colours', ['main', 'opt', 'hint', 'attack', 'fixed'].every((id) => { const m = M.markers.find((x) => x.id === id); return near(px(m), m.color); }), ['main', 'opt', 'hint', 'attack', 'fixed'].map((id) => px(M.markers.find((x) => x.id === id))));
frame();
check('extended markers have a ring in the world', M.rings.filter((r) => r.visible).length === 3, M.rings.filter((r) => r.visible).length);
const atk = M.markers.find((m) => m.id === 'attack');
G.step(84, 0.05);                                  // 4.2 s: the blinking marker is in its dark second
G.minimap.update(0, true);
check('blinking marker: dark between its repeats', Math.abs(atk.age - 4.2) < 0.06 && !M.markerOn(atk) && !near(px(atk), atk.color), atk.age);
G.step(30, 0.05);                                  // 5.7 s: lit again
check('blinking marker: lit again', M.markerOn(atk));
G.step(180, 0.05);                                 // 14.7 s: 3 x 4 s + 2 x 1 s are over
check('timed marker is gone after its repeats, permanent ones stay', !M.markers.includes(atk) && M.markers.length === 5);
if (hero) { check('marker follows its entity', fx.x === hero.pos.x && fx.z === hero.pos.z); }
M.removeMarker('main');
check('removeMarker: every marker with that id', M.markers.length === 3 && !M.markers.some((m) => m.id === 'main'));
for (const id of ['opt', 'hint', 'fixed']) M.removeMarker(id);
frame();
check('all markers removed, rings hidden', M.markers.length === 0 && M.rings.every((r) => !r.visible));

// ---------------------------------------------------------------- question marks
const qm = C.questionMarks[0];
check('question marks start invisible', C.questionMarks.length > 0 && M.marks.size === 0, C.questionMarks.length);
C.setQuestionMark(qm.name, 'QM_STATE_YELLOW', '_TTQ_G_10');
let sp = M.marks.get(qm);
check('yellow question mark floats over its place', !!sp && sp.parent === G.scene && Math.abs(sp.position.x - qm.x) < 0.01 && Math.abs(sp.position.z - qm.z) < 0.01 && sp.position.y > G.world.height(qm.x, qm.z) + 3);
const tex = sp.material.map;
C.setQuestionMark(qm.guid, 2); const tex2 = sp.material.map;
C.setQuestionMark(qm, 'EC_STATE_YELLOW'); const tex3 = sp.material.map;
C.setQuestionMark(qm, 'QM_STATE_RED');
check('states: one sprite, a picture per state', M.marks.size === 1 && M.marks.get(qm) === sp && new Set([tex, tex2, tex3, sp.material.map]).size === 4 && qm.tooltip === '_TTQ_G_10');
cam.x = qm.x; cam.z = qm.z; G.renderOnce(); G.renderOnce();
const scr = G.overlay.toScreen(sp.position);
G.input.mouse.x = scr.x; G.input.mouse.y = scr.y; G.input.mouse.inside = true;
M.hoverT = 0; frame(0.2);
check('question mark is on screen and visible', sp.visible && scr.x > 0 && scr.x < innerWidth && scr.y > 0 && scr.y < innerHeight && scr.z < 1, [Math.round(scr.x), Math.round(scr.y)]);
check('hover shows its tooltip', shown(G.hud.tip) && G.hud.tip.textContent === D.texts._TTQ_G_10, G.hud.tip.textContent);
G.input.mouse.x = 5; G.input.mouse.y = innerHeight / 2; M.hoverT = 0; frame(0.2);
check('tooltip goes when the mouse leaves', !shown(G.hud.tip));
const wasAll = G.fow.revealAll, ex = G.fow.explored_;
G.fow.revealAll = false; G.fow.explored_ = () => false; frame();
const hiddenInFog = !sp.visible;
G.fow.explored_ = ex; G.fow.revealAll = wasAll; frame();
check('question mark respects the fog of war', hiddenInFog && sp.visible);
C.setQuestionMark(qm, 'STATE_INVISIBLE');
check('invisible state removes the mark', M.marks.size === 0 && sp.parent === null);

// ---------------------------------------------------------------- dialogue scenes
const dA = D.dialogs['Cpn_single_001/single_01/ds_1020.dlg'], dB = D.dialogs['Cpn_single_001/single_01/ds_1030.dlg'];
const dM = Object.values(D.dialogs).find((d) => d.mentor && d.frames.length);
check('dialogue data of mission 1', !!dA && dA.frames.length === 2 && !!dB && dB.frames.length === 4 && !!dM, Object.keys(D.dialogs).length);
check('frame length: 0.25 s per vowel group, the sound if longer, a spoken-length estimate without sound',
  M.frameLength('banana', 9) === 9 && M.frameLength('Fight now, talk later. Please!', 0.5) === 1.5 && M.frameLength('Hi') === 1.5 && M.frameLength('x'.repeat(40)) === 0.6 + 0.065 * 40 && M.frameLength(dA.frames[0].text) > 0.25 * 9);
const ends = [];
M.playDialog(dA, () => ends.push('A'));
M.playDialog(dB, () => ends.push('B'));
M.playDialog(dA, () => ends.push('A2'));
check('dialogue queued: nothing shown before the next tick, not busy', !shown($('.dlg')) && !M.busy() && M.queue.length === 3);
G.step(1, 0.05); frame();
check('scene A frame 0: name, text, portrait', shown($('.dlg')) && $('.dname').textContent === 'Cole:' && $('.dtext').textContent === dA.frames[0].text && /url\(/.test($('.dpor').style.backgroundImage) && !M.busy(), [$('.dname').textContent, $('.dtext').textContent]);
const steps = (s) => G.step(Math.ceil(s / 0.05), 0.05);
steps(M.frameLength(dA.frames[0].text) - 0.2);
check('frame 0 lasts its length (game time)', M.scene.i === 0 && $('.dtext').textContent === dA.frames[0].text && G.paused === wasPaused);
steps(0.3);
check('then frame 1 of the second speaker', M.scene.i === 1 && $('.dname').textContent === 'Warrior:' && $('.dtext').textContent === dA.frames[1].text && ends.length === 0, $('.dname').textContent);
steps(M.frameLength(dA.frames[1].text) + 0.1);
check('scene A over: onEnd once, scene B starts', ends.join() === 'A' && M.scene && M.scene.scene === dB && $('.dtext').textContent === dB.frames[0].text, ends);
$('.dlg .dclose').click();
check('close button ends scene B (onEnd once)', ends.join() === 'A,B' && !M.scene);
G.step(1, 0.05);
check('the queued third scene plays', M.scene && M.scene.scene === dA && shown($('.dlg')));
steps(M.frameLength(dA.frames[0].text) + M.frameLength(dA.frames[1].text) + 0.3);
check('all scenes over in order, box hidden', ends.join() === 'A,B,A2' && !M.scene && !shown($('.dlg')) && M.queue.length === 0, ends);
G.step(40, 0.05);
check('no second onEnd', ends.length === 3);
M.playDialog(dM, () => ends.push('M')); G.step(1, 0.05);
check('mentor hint: shown with the mentor look', shown($('.dlg')) && $('.dlg').classList.contains('mentor') && $('.dname').textContent === 'Mentor:' && $('.dtext').textContent === dM.frames[0].text, $('.dname').textContent);
M.skipAll();
G.settings.mentor = false;
M.playDialog(dM, () => ends.push('M2')); G.step(1, 0.05);
const hiddenMentor = !shown($('.dlg')) && !!M.scene;
G.step(dM.frames.length * 10 + 2, 0.05);
G.settings.mentor = true;
check('mentor hints switched off: not shown, the scene still ends', hiddenMentor && ends.join() === 'A,B,A2,M,M2' && !M.scene, ends);
M.playDialog(null, () => ends.push('null')); G.step(1, 0.05);
check('unknown scene ends at once', ends[ends.length - 1] === 'null' && !M.scene);

// ---------------------------------------------------------------- cutscenes
const sq = Object.values(D.sequences).find((s) => s.id === 'sc_1050') || Object.values(D.sequences).find((s) => s.lines && s.lines.length >= 4);
check('sequence data of mission 1', !!sq && sq.lines.length >= 4, sq && sq.id);
const sEnds = [];
M.playSequence(sq, { camera: null, snapBack: true }, () => sEnds.push('m1'));
check('?manual: sequence queued, busy', M.busy() && sEnds.length === 0);
G.step(1, 0.05);
check('?manual: over on the next tick (onEnd once, no pause, nothing shown)', sEnds.join() === 'm1' && !M.busy() && !G.paused && !shown($('div.cine')));
G.step(5, 0.05);
check('?manual: no second onEnd', sEnds.length === 1);
// the presentation, driven by hand: update(dt) = real time
M.manual = false;
const c0 = { x: cam.x, z: cam.z }, target = { x: c0.x + 30, z: c0.z - 20 };
M.playSequence(sq, { camera: target, snapBack: false, title: 'Test scene' }, () => sEnds.push('p1'));
M.playSequence(null, {}, () => sEnds.push('p2'));
M.playSequence({ id: 'empty', lines: [] }, {}, () => sEnds.push('p3'));
M.playSequence(sq, { camera: null, snapBack: true }, () => sEnds.push('p4'));
frame();
check('cutscene on screen: game paused, HUD away, letterbox', !!M.cine && M.busy() && G.paused === true && document.body.classList.contains('cine') && shown($('div.cine')) && !shown($('#hud')) && $('.ctitle').textContent === 'Test scene');
check('first subtitle line with its speaker', $('.ctext').textContent === sq.lines[0].text.replace(/\s*\n\s*/g, ' ') && $('.cname').textContent === cap(sq.lines[0].speaker) + ':', [$('.cname').textContent, $('.ctext').textContent]);
check('no quest log during a cutscene', M.openLog() === false && !G.menuOpen);
frame(0.8);
const mid = { x: cam.x, z: cam.z };
frame(1.0);
check('camera eases to the scene position', mid.x > c0.x + 1 && mid.x < target.x - 1 && Math.abs(cam.x - target.x) < 0.01 && Math.abs(cam.z - target.z) < 0.01, [mid.x - c0.x, cam.x - c0.x]);
check('the line stays for its reading time', M.cine.i === 0 && M.cine.len >= 2.4);
frame(M.cine.len);
check('then the next line comes by itself', M.cine.i === 1 && $('.ctext').textContent === sq.lines[1].text.replace(/\s*\n\s*/g, ' '));
M.next();
check('next(): third line', M.cine.i === 2 && $('.ctext').textContent === sq.lines[2].text.replace(/\s*\n\s*/g, ' '));
check('Space: next line; other keys are swallowed', M.key({ code: 'Space', preventDefault() {} }) === true && M.cine && M.cine.i === 3 && M.key({ code: 'KeyA' }) === true && M.key({ code: 'KeyL' }) === true && !G.menuOpen);
check('Esc skips the scene: onEnd once, camera stays at the scene', M.key({ code: 'Escape' }) === true && sEnds.join() === 'm1,p1' && !M.cine && Math.abs(cam.x - target.x) < 0.01 && G.paused === wasPaused, sEnds);
frame();
check('sequences without lines / unknown end at once, the next one shows', sEnds.join() === 'm1,p1,p2,p3' && !!M.cine && M.cine.i === 0 && G.paused === true, sEnds);
$('div.cine').click();
check('a click on the screen: next line', M.cine && M.cine.i === 1);
cam.x += 15;                                        // (as if the scene had moved the camera)
M.skip(); frame();
check('last scene skipped: snapBack returns the camera, game runs, HUD back', sEnds.join() === 'm1,p1,p2,p3,p4' && Math.abs(cam.x - target.x) < 0.01 && !M.busy() && G.paused === wasPaused && !document.body.classList.contains('cine') && !shown($('div.cine')) && shown($('#hud')), sEnds);
M.manual = true;

// ---------------------------------------------------------------- skipAll
const order = [];
M.playDialog(dA, () => order.push('d1'));
M.playSequence(sq, {}, () => order.push('s1'));
M.playDialog(dB, () => order.push('d2'));
M.playSequence(sq, {}, () => order.push('s2'));
M.skipAll();
check('skipAll: everything ended once, in the order asked for', order.join() === 'd1,s1,d2,s2' && !M.busy() && !M.scene && M.queue.length === 0, order);
G.step(20, 0.05);
check('skipAll: nothing left to end', order.length === 4 && !shown($('.dlg')));
check('log of requests', ['quest', 'news', 'infobar', 'marker', 'unmarker', 'questionmark', 'dialog', 'frame', 'dialogEnd', 'sequence', 'line', 'sequenceEnd', 'title'].every((k) => M.log.some((l) => l[0] === k)),
  [...new Set(M.log.map((l) => l[0]))]);

// ---------------------------------------------------------------- end of the mission
G.endMission(false, { text: D.texts._GAOV_L0802 || 'A hero is dead!', delay: 0, points: 300 });
const end = $('.pwwin').textContent;
check('end screen: result, mission, reason of the defeat, bonus points, quests', G.over && end.includes('Mission has failed.') && end.includes(C.map.title) && end.includes('A hero is dead!') && end.includes('Bonus points: 300') && end.includes(qa.headline) && end.includes('Try again') && !end.includes('Next mission'), end.slice(0, 160));
} catch (e) { check('exception', false, String(e && e.stack || e)); }
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
return out.join('\n');
