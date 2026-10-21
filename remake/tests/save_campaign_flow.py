"""A campaign mission goes on after loading: mission 9 is played to the broken bridge (sequence sc_3025: the village's
fighters are made invulnerable until the heroes come), saved, loaded in a fresh page; the triggers are as saved, the
records the mission made (the heroes) are found by its queries, and the heroes walking into the village start the
dialogue, lift the invulnerability and open the quest "Rescue Mission". (Before: a loaded mission had every trigger off
and only the map's own records - its script stood still and the fight at the village never ended.)
python3 tests/save_campaign_flow.py            (PWR_PORT / PWR_LOCK as for evaljs.py)"""
import os, sys, time, json, re
import fcntl
_lk = open(os.environ.get('PWR_LOCK', '/tmp/pwr_browser.lock'), 'w'); fcntl.flock(_lk, fcntl.LOCK_EX)
from playwright.sync_api import sync_playwright
here = os.path.dirname(os.path.abspath(__file__))
base = 'http://127.0.0.1:%s/index.html' % os.environ.get('PWR_PORT', '8411')
def load(f):
    src = open(os.path.join(here, f)).read()
    m = re.match(r'//\s*include:\s*(\S+)', src)
    return (open(os.path.join(here, m.group(1))).read() + '\n' + src) if m else src
def wait(pg):
    t0 = time.time()
    while time.time() - t0 < 900:
        st = pg.evaluate('window.G && (G.ready ? "ready" : G.error ? "error:" + G.error : "loading")')
        if st and st != 'loading': return st
        time.sleep(1)
    return 'timeout'
out = []
def check(name, ok, info=None): out.append(('ok   ' if ok else 'FAIL ') + name + ('  ' + json.dumps(info) if info is not None else ''))
COUNTS = '() => { const E = G.campaign.engine; return { en: E.triggers.filter((t) => t.enabled).length, fired: E.triggers.filter((t) => t.fired > 0).length, recs: G.campaign.objects.all.length, t: Math.round(E.time) }; }'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []; pg.on('console', lambda m: logs.append(m.text)); pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
    pg.goto(base + '?manual&reveal&campaign=9', timeout=120000)
    check('mission 9 starts', wait(pg) == 'ready')
    r = json.loads(pg.evaluate('(async () => {' + load('save_flow_09a.js') + '})()'))
    before = pg.evaluate(COUNTS)
    check('played to the broken bridge and saved: the village\'s fighters are invulnerable', r['far'] == 2 and r['id'] and r['att']['invul'] > 0, r)
    pg.goto(base + '?manual&reveal&load=' + r['id'], timeout=120000)
    check('the save loads', wait(pg) == 'ready', [l for l in logs if 'PAGEERROR' in l][-3:])
    after = pg.evaluate(COUNTS)
    check('the triggers and records are as saved', after['en'] == before['en'] and after['fired'] == before['fired'] and after['recs'] == before['recs'], {'saved': before, 'loaded': after})
    r2 = json.loads(pg.evaluate('(async () => {' + load('save_flow_09b.js') + '})()'))
    check('the loaded mission goes on: the heroes reach the village, dialogue and quest "Rescue Mission", nobody invulnerable', r2['far'] == 1 and r2['q'] == 'open' and r2['att']['invul'] == 0 and r2['def']['invul'] == 0, r2)
    b.close()
print('\n'.join(out))
