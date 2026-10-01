"""Load the game headless and evaluate a JS snippet file: python3 tests/evaljs.py file.js [url options]"""
import sys, time
from playwright.sync_api import sync_playwright
url = 'http://127.0.0.1:8411/index.html?manual&reveal' + (sys.argv[2] if len(sys.argv) > 2 else '&tribe=Hu&enemy=Aje')
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
    print(pg.evaluate('(async () => {' + open(sys.argv[1]).read() + '})()'))
    for l in logs[-15:]: print(l[:300])
    b.close()
