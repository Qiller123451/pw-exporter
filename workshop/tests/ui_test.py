"""The Workshop in a browser, the way a modder uses it: a new mod, a unit made from the Norsemen's warrior with a
model of the game, a wild animal with an uploaded archive, then build and install. Prints ok / FAIL lines; with a
folder as the second argument it saves the screenshots of the guide (docs/screenshots/workshop).

    python3 workshop/tests/ui_test.py http://127.0.0.1:8420 [shots folder] [archive.gsf to upload]
The toolkit must run with a game folder set up; the test writes the mod "WsTest" into that game folder and removes it
again at the end."""
import os
import sys
import time
from playwright.sync_api import sync_playwright

base = sys.argv[1].rstrip('/')
shots = sys.argv[2] if len(sys.argv) > 2 else ''
upload = sys.argv[3] if len(sys.argv) > 3 else ''
MOD = 'WsTest'


def check(name, ok, info=''):
    print(('ok   ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


def shot(pg, name):
    if shots:
        time.sleep(0.6)
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
    pg = b.new_page(viewport={'width': 1360, 'height': 860})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.request.post(base + '/api/workshop/project/delete', data={'id': MOD})
    pg.request.post(base + '/api/workshop/uninstall', data={'id': MOD})
    pg.goto(base + '/workshop/')
    pg.evaluate('localStorage.clear()')
    pg.goto(base + '/workshop/')
    check('the page opens', wait(pg, 'document.querySelector("#main h1") && document.querySelector("#main h1").textContent.includes("Welcome")'))
    shot(pg, '01_welcome')
    # a new mod
    pg.click('#new-project')
    pg.fill('.modal input >> nth=0', MOD)
    pg.fill('.modal input >> nth=1', 'Workshop test')
    shot(pg, '02_new_mod')
    pg.click('.modal button.primary')
    check('the mod is made', wait(pg, f'document.querySelector("#main h1") && document.querySelector("#main h1").textContent === "Workshop test"'))
    # a unit like the Norsemen's warrior
    pg.click('#new-object')
    wait(pg, 'document.querySelectorAll(".modal tbody tr").length > 0', 60)
    pg.fill('.modal input[type=search]', 'hu_warrior')
    time.sleep(0.4)
    pg.click('.modal tbody tr:has(code:text-is("hu_warrior"))')
    pg.fill('.modal .grid input', 'wstest_champion')
    shot(pg, '03_new_object')
    pg.click('.modal button.primary')
    check('the object is added', wait(pg, 'document.querySelector("#main h1") && document.querySelector("#main h1").textContent === "wstest_champion"'))
    check('the model shows in the 3D view', wait(pg, 'document.querySelector("#view-note").textContent.includes("animations")', 240), pg.evaluate('document.querySelector("#view-note").textContent'))
    shot(pg, '04_model')
    pg.click('.steps button:has-text("Animations")')
    check('the animation table', wait(pg, 'document.querySelectorAll("#main .table tbody tr").length > 10', 60), pg.evaluate('document.querySelectorAll("#main .table tbody tr").length'))
    shot(pg, '05_animations')
    pg.click('.steps button:has-text("Numbers")')
    wait(pg, 'document.querySelector(".nums input")', 30)
    pg.fill('.nums input >> nth=0', '500')
    pg.press('.nums input >> nth=0', 'Tab')
    shot(pg, '06_numbers')
    pg.click('.steps button:has-text("Name & icon")')
    wait(pg, 'document.querySelector("#main .grid input")', 30)
    pg.fill('#main .grid input', 'Champion')
    pg.press('#main .grid input', 'Tab')
    pg.fill('#main textarea >> nth=0', '• Strong\n• Slow')
    pg.press('#main textarea >> nth=0', 'Tab')
    pg.click('#snap')
    check('an icon from the view', wait(pg, 'document.querySelector(".icon-prev") && document.querySelector(".icon-prev").style.backgroundImage.includes("files/")', 30))
    shot(pg, '07_texts')
    pg.click('.steps button:has-text("Check")')
    wait(pg, 'document.querySelectorAll("#main li").length > 2', 60)
    shot(pg, '08_check')
    # a wild animal with an uploaded archive
    if upload:
        pg.click('#new-object')
        wait(pg, 'document.querySelectorAll(".modal .k").length', 20)
        pg.click('.modal .k:has-text("Wild animal")')
        wait(pg, 'document.querySelectorAll(".modal tbody tr").length > 0', 60)
        pg.fill('.modal input[type=search]', 'stegosaurus')
        time.sleep(0.4)
        pg.click('.modal tbody tr:has(code:text-is("Stegosaurus"))')
        pg.fill('.modal .grid input', 'wstest_stego')
        pg.click('.modal button.primary')
        wait(pg, 'document.querySelector("#main h1") && document.querySelector("#main h1").textContent === "wstest_stego"')
        pg.click('.kinds .k:has-text("My model")')
        wait(pg, 'document.querySelector("#main input[type=file]")', 20)
        pg.set_input_files('#main input[type=file]', upload)
        check('the archive is read', wait(pg, 'document.querySelectorAll("#main .table tbody tr").length > 0', 120))
        check('the uploaded model shows', wait(pg, 'document.querySelector("#view-note").textContent.includes("animations")', 240), pg.evaluate('document.querySelector("#view-note").textContent'))
        shot(pg, '09_upload')
    # build and install
    pg.click('#mod-page')
    wait(pg, 'document.querySelector("#main h1").textContent === "Workshop test"')
    time.sleep(1.0)
    pg.click('#main button:has-text("Build & install")')
    check('built and installed', wait(pg, 'document.querySelector("#main").textContent.includes("installed in the game")', 300), pg.evaluate('document.querySelector(".files").textContent.slice(0, 300)'))
    shot(pg, '10_build')
    st = pg.request.get(base + '/api/workshop/project?id=' + MOD).json()
    check('the project says installed', st.get('installed') and st.get('built'), {k: st.get(k) for k in ('installed', 'built', 'problems')})
    pg.click('#main button:has-text("Uninstall")')
    check('uninstalled', wait(pg, '!document.querySelector("#main").textContent.includes("installed in the game")', 60))
    pg.goto(base + '/workshop/guide.html')
    check('the guide shows', wait(pg, 'document.querySelectorAll("#doc h2").length > 3', 30))
    shot(pg, '11_guide')
    check('no page errors', not errors, errors[:3])
    pg.request.post(base + '/api/workshop/project/delete', data={'id': MOD})
    b.close()
