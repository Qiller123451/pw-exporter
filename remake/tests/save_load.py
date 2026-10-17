"""A saved game loads as it was: play a while, save, load the save in a fresh page, compare the whole state, play on.
python3 tests/save_load.py "<url options>" [seconds before saving] [seconds after loading]
(PWR_PORT / PWR_PAGE as for evaljs.py)"""
import os, sys, time, json
import fcntl
_lk = open(os.environ.get('PWR_LOCK', '/tmp/pwr_browser.lock'), 'w'); fcntl.flock(_lk, fcntl.LOCK_EX)
from playwright.sync_api import sync_playwright
base = 'http://127.0.0.1:' + os.environ.get('PWR_PORT', '8411') + '/' + os.environ.get('PWR_PAGE', 'index.html')
opts = sys.argv[1] if len(sys.argv) > 1 else '&tribe=Hu&enemy=Aje'
before = float(sys.argv[2]) if len(sys.argv) > 2 else 120
after = float(sys.argv[3]) if len(sys.argv) > 3 else 60
DIFF = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'save_diff.js')).read()
def wait(pg):
    t0 = time.time()
    while time.time() - t0 < 900:
        st = pg.evaluate('window.G && (G.ready ? "ready" : G.error ? "error:" + G.error : "loading")')
        if st and st != 'loading': return st
        time.sleep(1)
    return 'timeout'
out = []
check = lambda name, ok, info='': out.append(('ok   ' if ok else 'FAIL ') + name + ('  ' + json.dumps(info)[:600] if info != '' else ''))
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text))
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.goto(base + '?manual&reveal' + opts, timeout=120000)
    check('the game starts', wait(pg) == 'ready')
    r = pg.evaluate('''async (sec) => {
      for (let t = 0; t < sec; t += 10) G.step(100, 0.1);
      const snap = G.saveState();
      window.__cam = { x: G.rtscam.x, z: G.rtscam.z };
      const meta = await G.saveGame('test save');
      window.__snap = snap;
      return { id: meta.id, problems: snap.problems, n: snap.table.length, bytes: JSON.stringify(snap).length, t: G.world.time,
        units: G.world.units.filter((u) => u.alive).length, buildings: G.world.buildings.filter((b) => b.alive).length };
    }''', before)
    check('saved', r['n'] > 100, {k: r[k] for k in ('n', 'bytes', 't', 'units', 'buildings')})
    check('nothing left out', not r['problems'], r['problems'][:12])
    snap1 = pg.evaluate('() => JSON.stringify(window.__snap)')
    shots = os.environ.get('SHOTS')
    def shot(name):
        if not shots: return
        pg.evaluate('() => { G.rtscam.update(0.016); for (let i = 0; i < 4; i++) G.drawNow(0.05); }')
        pg.screenshot(path=shots + name + '.png')
    shot('_saved')
    flags = ''.join('&' + f for f in ('aivai', 'notriggers') if '&' + f in opts)      # page flags that are not part of the game's settings
    pg.goto(base + '?manual&reveal&load=' + r['id'] + flags, timeout=120000)
    check('the saved game loads', wait(pg) == 'ready', [l for l in logs if 'PAGEERROR' in l or l.startswith('error')][-5:])
    shot('_loaded')
    d = pg.evaluate('(s1) => { const a = JSON.parse(s1), b = G.saveState(); ' + DIFF + ' return diff(a, b); }', snap1)
    check('the loaded state is the saved one', not d['diffs'], d)
    r2 = pg.evaluate('''(sec) => { const t0 = G.world.time; for (let t = 0; t < sec; t += 10) G.step(100, 0.1);
      return { t: G.world.time - t0, units: G.world.units.filter((u) => u.alive).length, errors: (G.campaign && G.campaign.errors || []).slice(0, 3) }; }''', after)
    errs = [l for l in logs if 'PAGEERROR' in l or 'loopError' in l or 'Error' in l and l.startswith('error')]
    check('the game goes on', r2['t'] >= after - 1 and not r2['errors'] and not errs, {'r': r2, 'errors': errs[-6:]})
    b.close()
print('\n'.join(out))
