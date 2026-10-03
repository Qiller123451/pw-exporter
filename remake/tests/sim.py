"""Headless game test: python3 tests/sim.py "&tribe=Hu&enemy=Aje&aivai" 60,120,240
Loads the game in Chromium (software GL), runs the simulation for the given steps and prints both players' state."""
import os as _os
try:
    import fcntl as _f; _lk = open(_os.environ.get('PWR_LOCK', '/tmp/pwr_browser.lock'), 'w'); _f.flock(_lk, _f.LOCK_EX)   # one headless browser at a time (memory)
except ImportError:
    pass
import sys, time
from playwright.sync_api import sync_playwright
url = 'http://127.0.0.1:' + __import__('os').environ.get('PWR_PORT', '8411') + '/index.html?manual' + (sys.argv[1] if len(sys.argv) > 1 else '')
steps = sys.argv[2] if len(sys.argv) > 2 else '60'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text))
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.on('response', lambda r: logs.append('404: ' + r.url) if r.status == 404 else None)
    pg.goto(url)
    t0 = time.time()
    st = None
    while time.time() - t0 < 180:
        st = pg.evaluate('window.G && (G.ready ? "ready" : G.error ? "error:" + G.error : "loading")')
        if st and st != 'loading': break
        time.sleep(1)
    print('state', st, 'load %.0fs' % (time.time() - t0))
    if st == 'ready':
        pg.evaluate(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'sim.js')).read())
        for s in steps.split(','):
            if not s: continue
            t1 = time.time()
            r = pg.evaluate(f'simReport({s})')
            print(f'--- +{s}s (wall {time.time()-t1:.1f}s)'); print(r)
    seen = set()
    for l in logs:
        if l in seen or l.startswith('debug'): continue
        seen.add(l); print(l[:400])
    b.close()
