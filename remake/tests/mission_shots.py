"""Screenshots of the mission UI in a running mission (real time, no ?manual): python3 tests/mission_shots.py <out dir> [mission] [port]
The trigger engine is not needed: the script drives G.mission through its contract with the mission's own data.
Writes title, hud, log, dialog_mentor, sequence, end ... as PNG at 1280x720, a small window (820x520) and with the
interface at 150 %."""
import os as _os
try:
    import fcntl as _f; _lk = open(_os.environ.get('PWR_LOCK', '/tmp/pwr_browser.lock'), 'w'); _f.flock(_lk, _f.LOCK_EX)   # one headless browser at a time (memory)
except ImportError:
    pass
import sys, time
from playwright.sync_api import sync_playwright

out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/mission_shots'
mission = int(sys.argv[2]) if len(sys.argv) > 2 else 1
port = sys.argv[3] if len(sys.argv) > 3 else _os.environ.get('PWR_PORT', '8411')
_os.makedirs(out, exist_ok=True)
url = f'http://127.0.0.1:{port}/index.html?quick&campaign={mission}&difficulty=1'

SETUP = r'''(() => {
  const C = G.campaign, M = G.mission, D = C.data, cam = G.rtscam;
  window.__ends = [];
  const vis = D.quests.filter((q) => q.main).slice(0, 4).concat(D.quests.filter((q) => !q.main).slice(0, 2));
  for (const q of vis) { q.visible = true; M.questChanged(q, 'shown'); }
  if (vis[0]) { vis[0].accomplished = true; M.questChanged(vis[0], 'done'); }
  if (vis[5]) { vis[5].unaccomplishable = true; M.questChanged(vis[5], 'failed'); }
  M.infoBar('Mammoths saved: 2 of 5');
  C.timers.set(1, { id: 1, left: 95, show: 1, label: 'Until the next attack', paused: false });
  C.timers.set(2, { id: 2, left: 7, show: 1, label: 'Pumping station 2', paused: false });
  const hero = G.world.units.find((u) => u.alive && u.owner === G.me);
  if (hero) { cam.x = hero.pos.x; cam.z = hero.pos.z; }
  const P = (dx, dz) => ({ x: cam.x + dx, z: cam.z + dz });
  M.marker({ id: 'm1', ...P(14, -6), entity: null, color: 0, kind: 'SPMainQuest', extended: 1, ttl: 0, repeats: 0, interval: 0 });
  M.marker({ id: 'm2', ...P(-250, 120), entity: null, color: 0, kind: 'SPOptQuest', extended: 1, ttl: 0, repeats: 0, interval: 0 });
  M.marker({ id: 'm3', ...P(300, 200), entity: null, color: 0, kind: 'SPHint', extended: 0, ttl: 0, repeats: 0, interval: 0 });
  M.marker({ id: 'm4', ...P(-150, -250), entity: null, color: 0, kind: 'Attack', extended: 0, ttl: 4, repeats: 30, interval: 1 });
  M.marker({ id: 'm5', ...P(350, -150), entity: null, color: 0x40a0ff, kind: 'FixedColor', extended: 0, ttl: 0, repeats: 0, interval: 0 });
  // question marks: move the first four next to the hero so that they are in view
  const st = ['QM_STATE_YELLOW', 'QM_STATE_GREEN', 'QM_STATE_RED', 'EC_STATE_YELLOW'];
  C.questionMarks.slice(0, 4).forEach((m, i) => { m.x = cam.x - 12 + i * 8; m.z = cam.z - 10 - (i % 2) * 4; C.setQuestionMark(m, st[i], Object.keys(D.texts).find((k) => k.startsWith('_TTQ_')) || ''); });
  const ds = Object.values(D.dialogs).filter((d) => !d.mentor && d.frames.length > 1 && d.frames.some((f) => f.text.length > 90))[0] || Object.values(D.dialogs)[0];
  window.__ds = ds;
  M.playDialog(ds, () => __ends.push('d'));
  return { quests: vis.length, marks: C.questionMarks.length, dialog: ds && ds.id, hero: !!hero, s: G.hud.s };
})()'''


def shot(pg, name):
    pg.wait_for_timeout(400)
    pg.screenshot(path=_os.path.join(out, name + '.png'), timeout=300000)
    print('shot', name)


with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text))
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.goto(url, timeout=120000)
    t0 = time.time()
    st = ''
    while time.time() - t0 < 600:
        st = pg.evaluate('window.G && (G.ready ? "ready" : G.error ? "error:" + G.error : "loading")')
        if st and st != 'loading': break
        time.sleep(1)
    print('state', st, round(time.time() - t0), 's')
    pg.add_style_tag(content='#diag { display: none !important; }')      # the "no graphics card" warning of the headless browser
    pg.wait_for_timeout(2500)
    shot(pg, 'title')
    print('setup', pg.evaluate(SETUP))
    pg.wait_for_timeout(1500)
    shot(pg, 'hud')
    # hover a question mark: its tooltip
    pos = pg.evaluate('(() => { const sp = [...G.mission.marks.values()][0]; const p = G.overlay.toScreen(sp.position); return [p.x, p.y]; })()')
    pg.mouse.move(pos[0], pos[1]); pg.wait_for_timeout(600)
    shot(pg, 'hud_qmark_tip')
    pg.mouse.move(640, 300)
    # a click on the ground while the HUD shows must still reach the game, a click on the dialogue box must not
    print('click-through', pg.evaluate('''(() => { const r = document.querySelector('.dlg').getBoundingClientRect(); const a = document.elementFromPoint(r.left + 40, r.top + 20), b = document.elementFromPoint(r.right + 60, r.top + 20);
      return { onBox: a && a.closest('.dlg') ? 'dlg' : a && a.tagName, beside: b && b.tagName + '.' + b.className }; })()'''))
    pg.keyboard.press('KeyL'); pg.wait_for_timeout(500)
    shot(pg, 'log')
    pg.evaluate('document.querySelectorAll(".qlist .q")[1] && document.querySelectorAll(".qlist .q")[1].click()')
    pg.keyboard.press('KeyL'); pg.wait_for_timeout(300)
    # mentor hint
    pg.evaluate('(() => { const M = G.mission; M.skipAll(); const d = Object.values(G.campaign.data.dialogs).find((x) => x.mentor && x.frames.length); if (d) M.playDialog(d, () => __ends.push("m")); })()')
    pg.wait_for_timeout(1200)
    shot(pg, 'dialog_mentor')
    # cutscene
    pg.evaluate('''(() => { const M = G.mission, D = G.campaign.data, cam = G.rtscam; const s = Object.values(D.sequences).filter((x) => x.lines && x.lines.length > 2).sort((a, b) => Math.max(...b.lines.map((l) => l.text.length)) - Math.max(...a.lines.map((l) => l.text.length)))[0];
      window.__sq = s; M.playSequence(s, { camera: { x: cam.x + 25, z: cam.z + 10 }, snapBack: true, title: G.campaign.map.title }, () => __ends.push('s')); })()''')
    pg.wait_for_timeout(3000)
    shot(pg, 'sequence')
    print('cine', pg.evaluate('({ on: !!G.mission.cine, i: G.mission.cine && G.mission.cine.i, paused: G.paused, t: G.world.time })'))
    pg.mouse.click(640, 360); pg.wait_for_timeout(700)
    shot(pg, 'sequence_line2')
    # the menu over a cutscene (F10), then back
    pg.keyboard.press('F10'); pg.wait_for_timeout(500)
    shot(pg, 'sequence_menu')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    print('after menu', pg.evaluate('({ on: !!G.mission.cine, paused: G.paused, menu: G.menuOpen })'))
    # ---- small window
    pg.set_viewport_size({'width': 820, 'height': 520}); pg.wait_for_timeout(900)
    shot(pg, 'small_sequence')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(600)
    print('skipped', pg.evaluate('({ ends: __ends, on: !!G.mission.cine, paused: G.paused, t: G.world.time })'))
    pg.evaluate('(() => { const M = G.mission; M.playDialog(__ds, () => __ends.push("d2")); const q = G.campaign.data.quests.find((x) => x.visible && !x.accomplished); M.questChanged(q, "shown"); M.questChanged(q, "shown"); })()')
    pg.wait_for_timeout(1500)
    shot(pg, 'small_hud')
    pg.keyboard.press('KeyL'); pg.wait_for_timeout(500)
    shot(pg, 'small_log')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.evaluate('G.mission.showTitle()'); pg.wait_for_timeout(700)
    shot(pg, 'small_title')
    print('game runs', pg.evaluate('({ t: G.world.time, paused: G.paused, menu: G.menuOpen, ends: __ends })'))
    # ---- interface at 150 %
    pg.set_viewport_size({'width': 1280, 'height': 720})
    pg.evaluate('(() => { G.settings.uiScale = 1.5; G.hud.scale(); const M = G.mission; M.skipAll(); M.playDialog(__ds, () => 0); const q = G.campaign.data.quests.find((x) => x.visible && !x.accomplished); M.questChanged(q, "shown"); })()')
    pg.wait_for_timeout(1500)
    shot(pg, 'scaled_hud')
    pg.evaluate('(() => { G.settings.uiScale = 0; G.hud.scale(); })()')
    # ---- the end of the mission
    pg.evaluate('G.endMission(false, { text: G.campaign.data.texts._GAOV_L0802 || "A hero is dead!", delay: 0, points: 300 })'); pg.wait_for_timeout(600)
    shot(pg, 'end_defeat')
    for l in [x for x in logs if 'PropertyBinding' not in x][-12:]:
        print(l[:300])
    b.close()
