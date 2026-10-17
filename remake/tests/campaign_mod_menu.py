"""The campaign menu's "Game data" choice, served by the toolkit (it needs /api/toolkit/remake/*): pick a mod
configuration, start a mission -> its data is built if needed (progress in the menu), the page of that configuration
(/remake/mod/<id>/) loads and starts the mission.
python3 tests/campaign_mod_menu.py <toolkit url, e.g. http://127.0.0.1:8430> [mod=MIRAGE] [mission=11]   prints ok / FAIL"""
import os as _os
try:
    import fcntl as _f; _lk = open(_os.environ.get('PWR_LOCK', '/tmp/pwr_browser.lock'), 'w'); _f.flock(_lk, _f.LOCK_EX)   # one headless browser at a time (memory)
except ImportError:
    pass
import sys, time
from playwright.sync_api import sync_playwright
base = sys.argv[1].rstrip('/')
mod = sys.argv[2] if len(sys.argv) > 2 else 'MIRAGE'
mission = int(sys.argv[3]) if len(sys.argv) > 3 else 11


def check(name, ok, info=''):
    print(('ok   ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


def wait(pg, expr, secs=300):
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            v = pg.evaluate(expr)
        except Exception:                 # the page is navigating
            v = None
        if v:
            return v
        time.sleep(0.5)
    return None


with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.goto(base + '/remake/index.html?allmissions', timeout=120000)
    wait(pg, '!!(window.G && (G.titleReady || G.error))', 120)
    pg.click('.pwwin [data-a="campaign"]')
    n = wait(pg, '!document.querySelector("#c_modrow").classList.contains("hidden") && document.querySelectorAll("#c_mod option").length', 30)
    opts = pg.evaluate('[...document.querySelectorAll("#c_mod option")].map((o) => o.value)')
    check('game data choice: the official game and the mods', n and opts[0] == '' and mod in opts, opts)
    pg.select_option('#c_mod', mod)
    note = pg.evaluate('document.querySelector("#c_modnote").textContent')
    check('the choice names the data folders', 'Data folders:' in note and mod in note, note)
    pg.click('#c_list div[data-id="%d"]' % mission)
    pg.click('.pwwin [data-a="start"]')
    seen = set()
    t0 = time.time()
    while time.time() - t0 < 1500 and '/mod/' not in pg.url:      # a build takes minutes
        try:
            seen.add(pg.evaluate('document.querySelector("#c_modnote") ? document.querySelector("#c_modnote").textContent.slice(0, 60) : ""'))
        except Exception:
            pass
        time.sleep(2)
    check('the page of the configuration loads', pg.url.startswith(base + '/remake/mod/%s/' % mod), pg.url)
    print('   menu said:', sorted(s for s in seen if s)[:4])
    st = wait(pg, 'window.G && (G.ready ? "ready" : G.error ? "error:" + G.error : "")', 900)
    r = pg.evaluate('({ id: G.campaign && G.campaign.id, saved: JSON.parse(localStorage.getItem("pwr.settings")).campaign })')
    check('the mission starts with the mod data', st == 'ready' and r['id'] == mission and r['saved']['mod'] == mod, [st, r])
    built = pg.evaluate('fetch("/api/toolkit/remake/state?mod=%s").then((r) => r.json()).then((s) => s.ready)' % mod)
    check('the configuration is built and up to date', built is True)
    for l in logs[-10:]:
        print(l[:300])
    b.close()
