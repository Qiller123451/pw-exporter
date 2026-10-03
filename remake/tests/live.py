"""Play the real game loop (requestAnimationFrame) for a while, do a box selection with the mouse, and report
page errors - catches problems the stepped tests (?manual) can't see.
Usage: python3 tests/live.py [url options] [out.png]"""
import os as _os
try:
    import fcntl as _f; _lk = open(_os.environ.get('PWR_LOCK', '/tmp/pwr_browser.lock'), 'w'); _f.flock(_lk, _f.LOCK_EX)   # one headless browser at a time (memory)
except ImportError:
    pass
import sys, time
from playwright.sync_api import sync_playwright
url = 'http://127.0.0.1:' + __import__('os').environ.get('PWR_PORT', '8411') + '/index.html?quick' + (sys.argv[1] if len(sys.argv) > 1 else '&tribe=SEAS&enemy=Aje')
out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/pwr_live.png'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1600, 'height': 900})
    logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.goto(url)

    t0 = time.time()
    while time.time() - t0 < 180:
        st = pg.evaluate('window.G && (G.ready ? "ready" : G.error ? "error:" + G.error : "loading")')
        if st and st != 'loading': break
        time.sleep(1)
    print('state', st)
    time.sleep(8)
    pg.mouse.move(560, 400); pg.mouse.down(); pg.mouse.move(800, 600, steps=8); pg.mouse.move(1000, 840, steps=8); pg.mouse.up()
    time.sleep(2)
    print(pg.evaluate('JSON.stringify({sel: G.sel.size, box: (document.querySelector(".selbox")||{}).style?.display, cam: [G.camera.position.x, G.camera.position.y, G.camera.position.z].map(v=>+v.toFixed(1)), t: +G.world.time.toFixed(1)})'))
    for l in [x for x in logs if 'PropertyBinding' not in x][-30:]: print(l[:500])
    try: pg.screenshot(path=out, timeout=120000)
    except Exception as e: print('screenshot failed', e)
    b.close()
