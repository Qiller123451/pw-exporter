import os as _os
try:
    import fcntl as _f; _lk = open(_os.environ.get('PWR_LOCK', '/tmp/pwr_browser.lock'), 'w'); _f.flock(_lk, _f.LOCK_EX)   # one headless browser at a time (memory)
except ImportError:
    pass
import sys, time, json
from playwright.sync_api import sync_playwright
url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:' + __import__('os').environ.get('PWR_PORT', '8411') + '/index.html?manual'
out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/pwr_shot.png'
script = sys.argv[3] if len(sys.argv) > 3 else ''
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1600, 'height': 900})
    logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text))
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.goto(url)
    t0 = time.time()
    while time.time() - t0 < 300:
        st = pg.evaluate('window.G && (G.ready ? "ready" : G.error ? "error:" + G.error : "loading")')
        if st and st != 'loading': break
        time.sleep(1)
    print('state', st, 'after', round(time.time() - t0, 1), 's')
    if script:
        r = pg.evaluate(script)
        print('script ->', r)
    pg.evaluate('G.renderOnce && G.renderOnce()')
    t1=time.time(); pg.evaluate('G.renderOnce && G.renderOnce()'); print('render s', round(time.time()-t1,2), pg.evaluate('JSON.stringify(G.renderer && G.renderer.stats)'))
    pg.screenshot(path=out, timeout=300000)
    for l in logs[-40:]: print(l[:400])
    b.close()
