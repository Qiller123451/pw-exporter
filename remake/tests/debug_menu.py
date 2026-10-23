"""The debug options the way a player sets them: title -> Campaign -> "Debug options…" -> pick some -> Done -> start the
mission; in the game the options hold, the pyramid shows the extra places and the pause menu has the debug tools.
python3 tests/debug_menu.py [mission=0] [shot prefix]     prints ok / FAIL lines"""
import os as _os
try:
    import fcntl as _f; _lk = open(_os.environ.get('PWR_LOCK', '/tmp/pwr_browser.lock'), 'w'); _f.flock(_lk, _f.LOCK_EX)   # one headless browser at a time (memory)
except ImportError:
    pass
import sys, time, json
from playwright.sync_api import sync_playwright
mission = int(sys.argv[1]) if len(sys.argv) > 1 else 0
shot = sys.argv[2] if len(sys.argv) > 2 else ''


def snap(pg, path):
    try:
        pg.screenshot(path=path, timeout=180000)
    except Exception as e:
        print('(no screenshot: %s)' % str(e)[:80])


def check(name, ok, info=''):
    print(('ok   ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


def wait(pg, expr, secs=300):
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            v = pg.evaluate(expr)
        except Exception:
            v = None
        if v:
            return v
        time.sleep(0.5)
    return None


with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800})
    logs = []
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.goto('http://127.0.0.1:' + _os.environ.get('PWR_PORT', '8411') + '/index.html?allmissions', timeout=120000)
    wait(pg, '!!(window.G && (G.titleReady || G.error))', 120)
    pg.evaluate('localStorage.removeItem("pwr.settings")')
    pg.click('.pwwin [data-a="campaign"]')
    wait(pg, 'document.querySelectorAll("#c_list div[data-id]").length', 30)
    pg.click('#c_list div[data-id="%d"]' % mission)
    check('the campaign window says the options are off', 'Debug options: off' in pg.evaluate('document.querySelector(".dbgrow").textContent'))
    pg.click('.pwwin [data-a="cheats"]')
    check('the debug page opens', pg.evaluate('document.querySelector(".pwwin h2").textContent') == 'Debug options')
    pg.fill('[data-k="res.food"]', '4000'); pg.press('[data-k="res.food"]', 'Tab')
    pg.fill('[data-k="res.skulls"]', '1500'); pg.press('[data-k="res.skulls"]', 'Tab')
    pg.fill('[data-k="pyramid.4"]', '4'); pg.press('[data-k="pyramid.4"]', 'Tab')
    pg.fill('[data-k="pyramid.3"]', '8'); pg.press('[data-k="pyramid.3"]', 'Tab')
    pg.fill('[data-k="me.dmg"]', '3'); pg.press('[data-k="me.dmg"]', 'Tab')
    pg.fill('[data-k="foe.def"]', '0.5'); pg.press('[data-k="foe.def"]', 'Tab')
    pg.select_option('[data-k="me.startEpoch"]', '3')
    pg.click('label:has([data-k="reveal"])')
    pg.click('label:has([data-k="noHousing"])')
    st = json.loads(pg.evaluate('localStorage.getItem("pwr.settings")'))['cheats']
    check('the choices are kept in the settings and turn the options on', st['on'] and st['res']['food'] == 4000 and st['pyramid'][4] == 4 and st['me']['dmg'] == 3 and st['foe']['def'] == 0.5 and st['me']['startEpoch'] == 3 and st['reveal'], st)
    if shot:
        snap(pg, shot + '_page.png')
    pg.click('.pwwin [data-a="done"]')
    row = pg.evaluate('document.querySelector(".dbgrow").textContent')
    check('back in the campaign window with the summary', 'Debug options on' in row and 'pyramid' in row, row)
    if shot:
        snap(pg, shot + '_campaign.png')
    pg.click('.pwwin [data-a="start"]')
    s = wait(pg, 'G.ready ? "ready" : G.error ? "error:" + G.error : ""', 900)
    check('mission started', s == 'ready', s)
    for _ in range(4):                    # skip the intro film / cutscene
        pg.keyboard.press('Escape'); time.sleep(1.5)
    pg.evaluate('G.menu.close()')
    r = pg.evaluate('''(() => { const me = G.me, W = G.world; return { cheats: !!W.cheats, food: me.res.food, skulls: me.res.skulls, epoch: me.epoch(), pyr: W.pyramidFor(me), reveal: G.fow.revealAll,
      maxUnits: me.maxUnits, popMax: me.popMax, cfg: !!G.config.cheats }; })()''')
    check('the options hold in the mission', r['cheats'] and r['food'] == 4000 and r['skulls'] == 1500 and r['epoch'] >= 3 and r['pyr'][4] == 4 and r['pyr'][3] == 8 and r['reveal'] and r['maxUnits'] == r['popMax'], r)
    # four level-5 and six level-4 units: the extra cards beside the pyramid
    n = pg.evaluate('''(() => { const me = G.me, W = G.world, h = G.homeEntity(); const D = G.data, a = D.actions(me).find((x) => x.kind === 'Build' && /CHTR$/.test(x.cat) && x.results[0] && !/worker/.test(x.results[0].obj));
      const cls = a ? a.results[0].obj : 'hu_warrior', at = h ? h.pos : { x: G.rtscam.x, z: G.rtscam.z };
      let n = 0; for (let i = 0; i < 10; i++) { const u = W.spawnUnit(cls, me, at.x + 8 + i * 2, at.z + 8, i < 4 ? 5 : 4, 0); if (u) n++; }
      W.recomputeCaps(me); G.hud.pyrKey = null; G.hud.refreshPyramid(); return [n, G.hud.pyr.querySelectorAll('.pcard').length, G.hud.pyr.querySelectorAll('.pxslot').length]; })()''')
    check('extra pyramid cards are drawn', n[0] == 10 and n[1] >= 10, n)
    pg.evaluate('G.setPaused && G.setPaused(false)')
    time.sleep(2)
    if shot:
        snap(pg, shot + '_game.png')
    pg.evaluate('G.menu.main()')
    check('the pause menu has the debug tools', pg.locator('.pwwin [data-a="debug"]').count() == 1)
    pg.click('.pwwin [data-a="debug"]')
    f0 = pg.evaluate('G.me.res.wood')
    pg.click('.pwwin [data-a="res"]')
    check('+1000 from the debug tools', pg.evaluate('G.me.res.wood') == f0 + 1000)
    if shot:
        snap(pg, shot + '_tools.png')
    pg.click('.pwwin [data-a="win"]')
    check('won from the debug tools', wait(pg, 'G.over && G.endInfo && G.endInfo.won', 20))
    for l in logs[-10:]:
        print(l[:300])
    check('no page errors', not [l for l in logs if 'PAGEERROR' in l], len(logs))
    b.close()
