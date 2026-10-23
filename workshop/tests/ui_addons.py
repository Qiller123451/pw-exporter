"""The Workshop's Add-ons step in a browser: a mod on MIRAGE, a unit made from the Black widow - its turret shows,
a Norsemen ballista is added as a gunner turret, moved and sized with the numbers and the gizmo, the rider swapped,
the gunner's weapon picked; then the mod is built. Prints ok / FAIL lines; with a folder it saves screenshots.

    python3 workshop/tests/ui_addons.py http://127.0.0.1:8430 [shots folder]

The toolkit must run with a game folder that has MIRAGE (and PW_GSF_ADDON / blender/ for the archive code)."""
import os
try:
    import fcntl as _f
    _lk = open(os.environ.get('PWR_LOCK', '/tmp/pwr_browser.lock'), 'w')
    _f.flock(_lk, _f.LOCK_EX)                 # one headless browser at a time (memory)
except ImportError:
    pass
import sys
import time
from playwright.sync_api import sync_playwright

base = sys.argv[1].rstrip('/')
shots = sys.argv[2] if len(sys.argv) > 2 else ''
MOD = 'WsAddons'
FAIL = []


def check(name, ok, info=''):
    print(('ok   ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)
    if not ok:
        FAIL.append(name)


def shot(pg, name):
    if shots:
        time.sleep(0.8)
        pg.screenshot(path=os.path.join(shots, name + '.png'))


def wait(pg, js, secs=120):
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            v = pg.evaluate(js)
        except Exception:                     # noqa: BLE001
            v = None
        if v:
            return v
        time.sleep(0.4)
    return None


with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1500, 'height': 900})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.request.post(base + '/api/workshop/project/delete', data={'id': MOD})
    pg.goto(base + '/workshop/')
    pg.evaluate('localStorage.clear()')
    pg.goto(base + '/workshop/')
    wait(pg, 'document.querySelector("#main h1")')
    pg.click('#new-project')
    pg.fill('.modal input >> nth=0', MOD)
    pg.fill('.modal input >> nth=1', 'Add-on test')
    pg.select_option('.modal select >> nth=0', 'MIRAGE')
    pg.click('.modal button.primary')
    check('the mod is made', wait(pg, 'document.querySelector("#main h1") && document.querySelector("#main h1").textContent === "Add-on test"'))
    pg.click('#new-object')
    wait(pg, 'document.querySelectorAll(".modal tbody tr").length > 0', 60)
    pg.fill('.modal input[type=search]', 'wehrspinne')
    time.sleep(0.4)
    pg.click('.modal tbody tr:has(code:text-is("seas_wehrspinne"))')
    pg.fill('.modal .grid input', 'wsaddons_widow')
    pg.click('.modal button.primary')
    check('the object is added', wait(pg, 'document.querySelector("#main h1") && document.querySelector("#main h1").textContent === "wsaddons_widow"'))
    pg.click('.steps button:has-text("Add-ons")')
    check('the template\'s turret is listed', wait(pg, '[...document.querySelectorAll("#main tbody tr")].some((r) => r.textContent.includes("seas_wehrspinne_top"))', 120))
    check('the 3D view shows the turret and the rider', wait(pg, 'window.workshop.viewer.parts.length >= 3 && document.querySelector("#view-note").textContent.includes("add-on")', 240),
          pg.evaluate('[window.workshop.viewer.parts.length, document.querySelector("#view-note").textContent]'))
    shot(pg, '13_addons')
    # a gunner turret: the Norsemen's ballista
    pg.click('#main button:has-text("Add an add-on")')
    wait(pg, 'document.querySelectorAll(".modal tbody tr").length > 0', 60)
    pg.fill('.modal input[type=search]', 'hu_rhino_ballista_buildup_top')
    time.sleep(0.5)
    pg.click('.modal tbody tr:has(code:text-is("hu_rhino_ballista_buildup_top"))')
    pg.select_option('.modal .grid select', 'gunner')
    pg.click('.modal button.primary')
    check('the add-on is in the list', wait(pg, '(window.workshop.S.project.objects[0].addons || []).length === 2', 60))
    check('the view shows it with its gunner', wait(pg, 'window.workshop.viewer.parts.length >= 5', 240), pg.evaluate('window.workshop.viewer.parts.length'))
    check('the gizmo is on it', wait(pg, '!!(window.workshop.viewer.tc && window.workshop.viewer.tc.object)', 60))
    # numbers: move it, size it
    ins = '#xform .vec >> nth=0 >> input'
    pg.fill('#xform .vec >> nth=0 >> input >> nth=0', '1.5')
    pg.press('#xform .vec >> nth=0 >> input >> nth=0', 'Tab')
    pg.fill('#xform .grid > input[type=number]', '1.3')
    pg.press('#xform .grid > input[type=number]', 'Tab')
    a = pg.evaluate('window.workshop.S.project.objects[0].addons.find((x) => x.id === "a1")')
    check('position and size kept', a and a['pos'][0] == 1.5 and abs(a['scale'] - 1.3) < 1e-6 and a['role'] == 'gunner' and (a.get('gunner') or {}).get('link') == 'Dri1', a)
    n = pg.evaluate('''(() => { const v = window.workshop.viewer, i = window.workshop.S.parts.a1, q = v.partPlacement(i); return q; })()''')
    check('the view placed it so', n and abs(n['offset'][0] - 1.5) < 1e-3 and abs(n['scale'] - 1.3) < 1e-3, n)
    # the gizmo turns it
    pg.evaluate('''(() => { const v = window.workshop.viewer; v.tc.object.rotation.z += 0.5; v.tc.dispatchEvent({ type: 'objectChange' }); })()''')
    a = pg.evaluate('window.workshop.S.project.objects[0].addons.find((x) => x.id === "a1")')
    check('the gizmo turns it (degrees)', a and abs(a['rot'][2] - 28.648) < 0.05, a and a['rot'])
    shot(pg, '14_addons_gunner')
    # another rider
    pg.select_option('#main .card:has(h3:text-is("Rider")) select >> nth=0', 'hu_rider_b')
    check('the rider is swapped', wait(pg, '(window.workshop.S.project.objects[0].rider || {}).cls === "hu_rider_b"', 30))
    # the gunner's weapon
    pg.click('.steps button:has-text("Numbers")')
    check('the gunner card', wait(pg, '[...document.querySelectorAll("#main h3")].some((h) => h.textContent.includes("gunner turrets"))', 60))
    opt = pg.evaluate('''[...document.querySelectorAll("#main .card:has(h4) select option")].find((o) => o.textContent.includes("hu_titan_ballista")).value''')
    pg.select_option('#main .card:has(h4) select', opt)
    pg.fill('#main .card:has(h4) .nums input >> nth=0', '99')
    pg.press('#main .card:has(h4) .nums input >> nth=0', 'Tab')
    a = pg.evaluate('window.workshop.S.project.objects[0].addons.find((x) => x.id === "a1")')
    check('the gunner\'s weapon', a and a['weapon'].get('from') == opt and a['weapon'].get('damage') == 99, a and a['weapon'])
    shot(pg, '15_gunner_weapon')
    # build
    pg.evaluate('window.workshop.S.project.objects[0].texts.name = "Gun widow"')
    pg.click('#mod-page')
    wait(pg, 'document.querySelector("#main h1").textContent === "Add-on test"')
    time.sleep(1.0)
    pg.click('#main button:has-text("Build the mod")')
    check('built', wait(pg, 'document.querySelector(".files") && document.querySelector(".files").textContent.includes("Files:")', 300), pg.evaluate('(document.querySelector(".files") || {}).textContent'))
    files = pg.evaluate('document.querySelector(".files").textContent')
    check('the script and the script list are built', 'wsaddons.usl' in files and 'Server.ini' in files, files[:400])
    for e in errors[:10]:
        print('PAGEERROR', e[:300])
    check('no page errors', not errors, len(errors))
    pg.request.post(base + '/api/workshop/project/delete', data={'id': MOD})
    b.close()
print('%d failed' % len(FAIL))
sys.exit(1 if FAIL else 0)
