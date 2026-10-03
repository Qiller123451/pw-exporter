"""Run the rule scenarios of tests/scenarios.js in a headless game: python3 tests/scenarios.py [url options]"""
import os as _os
try:
    import fcntl as _f; _lk = open(_os.environ.get('PWR_LOCK', '/tmp/pwr_browser.lock'), 'w'); _f.flock(_lk, _f.LOCK_EX)   # one headless browser at a time (memory)
except ImportError:
    pass
import sys, time
from playwright.sync_api import sync_playwright
url = 'http://127.0.0.1:' + __import__('os').environ.get('PWR_PORT', '8411') + '/index.html?manual&reveal' + (sys.argv[1] if len(sys.argv) > 1 else '&tribe=Hu&enemy=Aje')
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text))
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.goto(url)
    t0 = time.time()
    while time.time() - t0 < 180:
        st = pg.evaluate('window.G && (G.ready ? "ready" : G.error ? "error:" + G.error : "loading")')
        if st and st != 'loading': break
        time.sleep(1)
    print('state', st)
    pg.evaluate(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'scenarios.js')).read())
    print(pg.evaluate('runScenarios()'))
    for l in logs[-15:]: print(l[:300])
    b.close()
