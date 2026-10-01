"""The error banner copies its message (with stack and game info) when clicked: python3 tests/copy_error.py"""
import time
from playwright.sync_api import sync_playwright
url = 'http://127.0.0.1:8411/index.html?quick&tribe=Hu&enemy=Aje'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 720})
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin='http://127.0.0.1:8411')
    pg = ctx.new_page()
    pg.goto(url)
    t0 = time.time()
    while time.time() - t0 < 180 and not pg.evaluate('window.G && G.ready'): time.sleep(1)
    # an error inside an event handler (not caught by the game loop)
    pg.evaluate("setTimeout(() => { const o = undefined; o.toFixed(1); }, 0)")
    time.sleep(1)
    rows = pg.locator('#diag div div')
    n = rows.count()
    texts = [rows.nth(i).inner_text() for i in range(n)]
    target = next((i for i, t in enumerate(texts) if 'toFixed' in t), None)
    print('banner rows:', len(texts), 'error row:', target)
    rows.nth(target).click()
    time.sleep(0.5)
    clip = pg.evaluate('navigator.clipboard.readText()')
    print('hint after click:', rows.nth(target).inner_text().splitlines()[-1][-40:])
    print('--- clipboard ---'); print(clip)
    ok = 'toFixed' in clip and 'build ' in clip and 'game: Hu vs Aje' in clip and '\n    at ' in clip
    print('OK' if ok else 'FAIL')
    b.close()
