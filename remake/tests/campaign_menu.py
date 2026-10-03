"""The campaign the way a player starts it: title menu -> Campaign -> pick a mission and a difficulty -> Start
(real frame loop), then the end screen with "Play again" and "Next mission" (both reload the page into a mission).
python3 tests/campaign_menu.py [mission=11] [shot.png]     prints ok / FAIL lines"""
import os as _os
try:
    import fcntl as _f; _lk = open(_os.environ.get('PWR_LOCK', '/tmp/pwr_browser.lock'), 'w'); _f.flock(_lk, _f.LOCK_EX)   # one headless browser at a time (memory)
except ImportError:
    pass
import sys, time
from playwright.sync_api import sync_playwright
mission = int(sys.argv[1]) if len(sys.argv) > 1 else 11
shot = sys.argv[2] if len(sys.argv) > 2 else ''


def check(name, ok, info=''):
    print(('ok   ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''))


def wait(pg, expr, secs=300):
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            v = pg.evaluate(expr)
        except Exception:                 # the page is reloading
            v = None
        if v:
            return v
        time.sleep(0.5)
    return None


with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text) if m.type in ('error',) else None)
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.goto('http://127.0.0.1:' + _os.environ.get('PWR_PORT', '8411') + '/index.html?allmissions', timeout=120000)
    wait(pg, '!!(window.G && (G.titleReady || G.error))', 120)
    check('title screen has a Campaign entry', pg.locator('.pwwin [data-a="campaign"]').count() == 1)
    pg.click('.pwwin [data-a="campaign"]')
    n = wait(pg, 'document.querySelectorAll("#c_list div[data-id]").length', 30)
    check('mission list', n == 17, n)
    pg.click('#c_list div[data-id="%d"]' % mission)
    title = pg.evaluate('document.querySelector("#c_text b").textContent')
    desc = pg.evaluate('document.querySelector("#c_text").textContent.length')
    check('localised title and description', title.startswith('Mission %d' % mission) and desc > 80, title)
    pg.select_option('#c_diff', '2')
    if shot:
        pg.screenshot(path=shot.replace('.png', '_menu.png'))
    pg.click('.pwwin [data-a="start"]')
    st = wait(pg, 'G.ready ? "ready" : G.error ? "error:" + G.error : ""', 600)
    check('mission started from the menu', st == 'ready', st)
    time.sleep(4)
    r = pg.evaluate('({ id: G.campaign && G.campaign.id, diff: G.campaign && G.campaign.difficulty, t: G.world.time, msg: document.body.textContent.includes("Build up your settlement"), saved: JSON.parse(localStorage.getItem("pwr.settings")).campaign })')
    check('the chosen mission and difficulty run in real time', r['id'] == mission and r['diff'] == 2 and r['t'] > 0.1 and not r['msg'] and r['saved']['mission'] == mission, r)
    pg.evaluate('G.openMenu()')
    check('pause menu says "Restart mission"', 'Restart mission' in pg.evaluate('document.querySelector(".pwwin").textContent'))
    pg.evaluate('G.closeMenu()')
    pg.evaluate('G.endMission(true, { text: "The test is over.", delay: 0 })')
    txt = pg.evaluate('document.querySelector(".pwwin").textContent')
    check('end screen: victory, reason, next mission', 'Victory' in txt and 'The test is over.' in txt and ('Next mission' in txt) == (mission < 16), txt[:60])
    if shot:
        pg.screenshot(path=shot.replace('.png', '_end.png'))
    # Play again: the page reloads into the same mission
    pg.evaluate('window.__old = 1')
    pg.click('.pwwin [data-a="restart"]')
    st = wait(pg, '!window.__old && window.G && (G.ready ? "ready" : G.error ? "error:" + G.error : "")', 600)
    r = pg.evaluate('({ id: G.campaign && G.campaign.id, diff: G.campaign && G.campaign.difficulty, over: G.over })')
    check('"Play again" restarts the mission', st == 'ready' and r['id'] == mission and r['diff'] == 2 and not r['over'], r)
    if mission < 16:
        pg.evaluate('G.endMission(true, { delay: 0 })')
        pg.evaluate('window.__old = 1')
        pg.click('.pwwin [data-a="next"]')
        st = wait(pg, '!window.__old && window.G && (G.ready ? "ready" : G.error ? "error:" + G.error : "")', 900)
        r = pg.evaluate('({ id: G.campaign && G.campaign.id, diff: G.campaign && G.campaign.difficulty })')
        check('"Next mission" starts the following mission', st == 'ready' and r['id'] == mission + 1 and r['diff'] == 2, r)
        pg.evaluate('G.endMission(false, { text: "Cole has died.", delay: 0 })')
        txt = pg.evaluate('document.querySelector(".pwwin").textContent')
        check('defeat screen: reason, try again, no next mission', 'Defeat' in txt and 'Cole has died.' in txt and 'Try again' in txt and 'Next mission' not in txt, txt[:50])
    for l in [x for x in logs if 'PropertyBinding' not in x][-10:]:
        print(l[:400])
    b.close()
