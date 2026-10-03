"""Headless end-to-end check of the toolkit (and the screenshots of the README and docs/EXPORTER.md):
    python tools/ui_test.py <toolkit url> <ParaWorld folder> <screenshot folder> [--no-remake]
Needs playwright + chromium. Walks through the launcher, the exporter (units, add-ons, animations, exports, maps)
and starts the remake (needs its game data prepared)."""
import os, re, sys, time, json
from playwright.sync_api import sync_playwright

URL, GAME, SHOTS = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(SHOTS, exist_ok=True)
out = []
def check(name, ok, info=''):
    out.append(('ok   ' if ok else 'FAIL ') + name + (' ' + str(info) if info != '' else ''))

import atexit
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1500, 'height': 900})
    logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text))
    pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
    pg.goto(URL)
    atexit.register(lambda: print('\n'.join(out + logs[-15:])))
    shot = lambda n: pg.screenshot(path=os.path.join(SHOTS, n), timeout=300000)
    # ---- launcher
    pg.wait_for_selector('.setup input, #remake-card', timeout=60000)
    if pg.is_visible('.setup input'):
        pg.fill('.setup input', '/nonexistent')
        pg.click('.setup .primary'); time.sleep(0.8)
        check('wrong folder is refused', 'ParaWorld' in pg.inner_text('.setup .err'), pg.inner_text('.setup .err'))
        pg.fill('.setup input', GAME)
        shot('01_start.png')
        pg.click('.setup .primary')
    pg.wait_for_selector('#remake-card', timeout=60000)
    for _ in range(300):
        if pg.locator('#open-exporter + .status.ok').count(): break
        time.sleep(1)
    check('exporter data loaded', pg.locator('#open-exporter + .status.ok').count() == 1)
    shot('11_launcher.png')
    pg.click('#open-exporter')
    pg.wait_for_selector('#list li', timeout=120000)
    if pg.evaluate('(async () => (await (await fetch("/api/state")).json()).mod)()'):      # a mod left selected: start from the base game
        with pg.expect_navigation(timeout=900000):
            pg.select_option('#mod-global', '')
        pg.wait_for_selector('#list li', timeout=600000)
    n = pg.locator('#list li').count()
    check('catalog listed', n > 200, n)
    # search in both languages
    pg.fill('#search', 'aje_allosaurus'); time.sleep(0.3)
    pg.click('#list li >> nth=0')
    pg.wait_for_function('document.querySelector("#busy").classList.contains("hidden") && document.querySelectorAll("#s-addons input").length > 0', timeout=120000)
    time.sleep(1.5)
    check('allosaurus shows its rider', pg.evaluate('window.__v = document.querySelectorAll("#s-addons input:checked").length') >= 1)
    shot('02_allosaurus.png')
    # an animation
    pg.click('.anims button[data-name="walk_2"]'); time.sleep(1.0)
    check('walk animation plays', 'walk_2' in pg.inner_text('.anims button.on'))
    # German
    pg.select_option('#lang-quick', 'de')
    pg.wait_for_function('document.querySelector("#s-addons h3") && document.querySelector("#s-addons h3").textContent.includes("Anbauteile")', timeout=60000)
    check('German UI and names', 'Allosaurus' in pg.inner_text('#d-head h2'))
    pg.fill('#search', 'wehrspinne'); time.sleep(0.4)
    pg.click('#list li >> nth=0')
    pg.wait_for_function('document.querySelector("#busy").classList.contains("hidden") && document.querySelector("#d-head h2").textContent.includes("Wehrspinne")', timeout=120000)
    time.sleep(1.5)
    shot('03_wehrspinne_de.png')
    pg.select_option('#lang-quick', 'en'); time.sleep(2.5)
    # titan with two ballistas
    pg.fill('#search', 'titan'); time.sleep(0.4)
    pg.click('#list li:has-text("Triceratops titan")')
    pg.wait_for_function('document.querySelector("#busy").classList.contains("hidden") && document.querySelector("#d-head h2").textContent.includes("Triceratops")', timeout=120000)
    time.sleep(2)
    shot('04_titan_addons.png')
    # export GLB with all animations
    pg.select_option('#s-export select >> nth=0', 'glb'); time.sleep(0.3)
    pg.click('#exp-go')
    pg.wait_for_selector('#s-export .result.ok, #s-export .result.bad', timeout=180000)
    r = pg.inner_text('#s-export .result')
    check('GLB export', 'Saved' in r, r)
    # OBJ of a building
    pg.fill('#search', 'ballista'); time.sleep(0.4)
    pg.fill('#search', 'large tower'); time.sleep(0.4)
    pg.click('#list li >> nth=0')
    pg.wait_for_function('document.querySelector("#busy").classList.contains("hidden")', timeout=120000)
    time.sleep(1.5)
    pg.select_option('#s-export select >> nth=0', 'obj'); time.sleep(0.3)
    pg.click('#exp-go')
    pg.wait_for_selector('#s-export .result.ok, #s-export .result.bad', timeout=180000)
    check('OBJ export', 'Saved' in pg.inner_text('#s-export .result'), pg.inner_text('#s-export .result'))
    shot('05_building_export.png')
    # visibility: 32 independent flag bits (a mesh shows when it has every ticked bit), presets, materials, mods
    ready = 'document.querySelector("#busy").classList.contains("hidden") && window.PWX.viewer && window.PWX.viewer.parts[0]'
    vis = '(() => { const r = []; PWX.viewer.parts[0].obj.traverse(o => { if (o.userData && o.userData.attr !== undefined) r.push([o.userData.attr >>> 0, o.visible]); }); return r; })()'
    ticked = '[...document.querySelectorAll("#vis-bits input:checked")].map(i => +i.dataset.bit)'
    pg.click('#tab-models'); time.sleep(0.5)
    pg.fill('#search', 'hu_fireplace'); time.sleep(0.5)
    pg.click('#list li >> nth=0'); time.sleep(0.5)
    pg.wait_for_function(ready, timeout=240000); time.sleep(1.5)
    names = pg.evaluate('[...document.querySelectorAll("#vis-bits label span")].map(s => s.textContent)')
    check('visibility: all 32 flag bits listed', len(names) == 32 and names[0] == 'LOD0' and 'Con 0' in names and any(n.startswith('bit ') for n in names), len(names))
    v0 = pg.evaluate(vis)
    check('visibility: the in-game look while nothing is ticked', pg.evaluate(ticked) == [] and any(v for a, v in v0) and not all(v for a, v in v0))
    pg.check('#vis-bits input[data-bit="0"]'); time.sleep(0.3); pg.check('#vis-bits input[data-bit="21"]'); time.sleep(0.5)
    v, m = pg.evaluate(vis), (1 << 0) | (1 << 21)
    check('visibility: LOD0 + Con 0 shows exactly the meshes with both bits', all(vv == ((a & m) == m) for a, vv in v) and any(vv for a, vv in v), '%d of %d' % (sum(1 for a, vv in v if vv), len(v)))
    shot('15_visibility_bits.png')
    pg.uncheck('#vis-bits input[data-bit="21"]'); time.sleep(0.4)
    v = pg.evaluate(vis)
    check('visibility: unticking one bit leaves the others', pg.evaluate(ticked) == [0] and all(vv == bool(a & 1) for a, vv in v))
    pg.click('#vis-clear'); time.sleep(0.4)
    check('visibility: Clear returns to the in-game look', pg.evaluate(vis) == v0)
    check('player colour in its own section', pg.locator('#s-parts .swatches button').count() >= 8 and pg.locator('#s-vis .swatches').count() == 0)
    # materials: the alpha of a texture is used only as the material flags say (low digit of MaterialAttributes1)
    mats = pg.evaluate('''(() => { const r = []; PWX.viewer.parts[0].obj.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.userData && m.userData.gsf_flags && !m.userData.gsf_sprite) r.push([parseInt(m.userData.gsf_flags.split("/")[0], 16) & 15, m.alphaTest > 0, !!m.transparent]); }); return r; })()''')
    HARD, SOFT = (1, 3, 5, 11, 13, 15), (2, 6, 7, 10, 14)
    bad = [x for x in mats if (x[1] and x[0] not in HARD) or (x[2] and x[0] not in SOFT)]
    check('materials: alpha only where the flags ask for it', mats and not bad, '%d materials, %s' % (len(mats), bad[:3]))
    check('materials listed with their flags', pg.locator('#s-mats .mat').count() > 0, pg.locator('#s-mats .mat').count())
    # a model that several mods have: the "Mod" selector (installations with one copy only have none)
    multi = pg.evaluate('(async () => (await (await fetch("/api/models")).json()).find(m => m.mods && m.mods.length > 1 && m.anims > 0))()')
    if multi:
        pg.fill('#search', multi['name']); time.sleep(0.5)
        pg.locator('#list li', has=pg.locator('b', has_text=re.compile('^' + re.escape(multi['name']) + '$'))).first.click(); time.sleep(0.5)
        pg.wait_for_function(ready + ' && PWX.cur.parts[0].info.name === %s' % json.dumps(multi['name']), timeout=240000); time.sleep(1)
        opts = pg.evaluate('[...document.querySelectorAll("#mod-sel option")].map(o => o.textContent)')
        check('mod selector lists the copies', len(opts) >= 2, opts)
        pg.select_option('#mod-sel', index=len(opts) - 1); time.sleep(0.5)
        pg.wait_for_function(ready + ' && PWX.cur.parts[0].info.mod === %s' % json.dumps(opts[-1].split(' · ')[0]), timeout=240000); time.sleep(1)
        check('mod selector loads that mod\'s copy', ('/' + opts[-1].split(' · ')[0] + '/') in pg.evaluate('PWX.cur.parts[0].info.url'), pg.evaluate('PWX.cur.parts[0].info.url'))
        shot('16_mod_selector.png')
    # all models browser
    pg.fill('#search', 'mammoth'); time.sleep(0.4)
    check('all models list', pg.locator('#list li').count() > 3, pg.locator('#list li').count())
    pg.click('#list li >> nth=0')
    pg.wait_for_function('document.querySelector("#busy").classList.contains("hidden")', timeout=120000)
    time.sleep(1.5)
    shot('06_all_models.png')
    pg.click('#btn-settings'); time.sleep(0.5); shot('07_settings.png')
    pg.click('#dialog-card .actions button >> nth=0'); time.sleep(0.3)
    pg.click('#tab-units'); time.sleep(0.3)
    def pick(q, idt):
        pg.fill('#search', q); time.sleep(0.4)
        pg.click('#list li:has(small:text-is("%s"))' % idt)
        pg.wait_for_function('document.querySelector("#busy").classList.contains("hidden") && document.querySelector("#d-head code") && document.querySelector("#d-head code").textContent == "%s"' % idt, timeout=120000)
        time.sleep(1.2)
    def addon(text):
        pg.click('#s-addons label:has-text("%s") input' % text)
        pg.wait_for_function('document.querySelector("#busy").classList.contains("hidden")', timeout=120000); time.sleep(1.5)
    pick('large tower', 'hu_large_tower'); addon('hu_large_tower_upgrade_balista')
    check('ballista tower switches to the upgraded tower', 'upgrade' in pg.eval_on_selector('#s-model select', 'e => e.options[e.selectedIndex].text'))
    shot('08_ballista_tower.png')
    pick('brachio', 'aje_brachiosaurus'); addon('aje_brachiosaurus_catapult')
    shot('09_brachiosaurus_catapult.png')
    pick('warrior', 'hu_warrior'); pg.select_option('#s-model select >> nth=1', '3'); pg.wait_for_function('document.querySelector("#busy").classList.contains("hidden")'); time.sleep(1.5)
    pg.click('.anims button[data-name="walk_3"]'); time.sleep(0.8)
    shot('10_warrior_level3.png')
    # ---- maps
    pg.fill('#search', ''); time.sleep(0.3)
    pg.click('#tab-maps')
    pg.wait_for_function('document.querySelector("#tab-maps").classList.contains("on") && [...document.querySelectorAll("#list li .badge")].some((b) => b.textContent.includes("×"))', timeout=180000)
    check('maps listed', pg.locator('#list li').count() > 50, pg.locator('#list li').count())
    pg.fill('#search', 'dschungelkrater'); time.sleep(0.4)
    pg.click('#list li >> nth=0')
    pg.wait_for_function('document.querySelector("#busy").classList.contains("hidden") && document.querySelector("#d-head h2")', timeout=180000)
    for i in range(240):
        if i > 3 and pg.evaluate('(() => { const b = document.querySelector("#map-progress"); return !!b && b.classList.contains("hidden"); })()'): break
        time.sleep(1)
    time.sleep(2)
    ships = pg.evaluate('''(async () => { const ms = await (await fetch("/api/maps")).json(); const m = ms.find(x => /anvil_jungle/i.test(x.rel)); if (!m) return null;
      const i = await (await fetch("/api/map?id=" + encodeURIComponent(m.id))).json(); return [i.water, i.object_list.filter(o => o.type === "SHIP").map(o => [o.z, o.z_map])]; })()''')
    caps = pg.evaluate('''(async () => { const ms = await (await fetch("/api/maps")).json(); const m = ms.find(x => /single_05/i.test(x.rel)); if (!m) return null;
      const i = await (await fetch("/api/map?id=" + encodeURIComponent(m.id))).json(); return i.object_list.filter(o => o.cls === "universal_captain").map(o => [o.model, o.part_of]); })()''')
    if caps:
        check('captains of transports are not drawn as standalone figures', all(mo is None and po for mo, po in caps), caps[:3])
    if ships and ships[1]:
        check('ships of a map float at the water level', all(z == ships[0] for z, zm in ships[1]) and any(zm < ships[0] for z, zm in ships[1]), ships)
    check('map shown with its info', 'Dschungelkrater' in pg.inner_text('#d-head h2'), pg.inner_text('#d-head h2'))
    shot('12_map_viewer.png')
    labels = {'surf': '.surf', 'ksy': '.ksy'}
    for k, t in labels.items():
        pg.click('#s-export label:has-text("%s") input' % t)
    pg.select_option('#s-export select >> nth=0', 'glb')
    pg.evaluate('document.querySelector("#details").scrollTop = 99999')
    pg.click('#map-go')
    pg.wait_for_selector('#s-export .result.ok, #s-export .result.bad', timeout=600000)
    r = pg.inner_text('#s-export .result')
    check('map export (GLB + height map + CSV + SURF + KSY)', 'Saved' in r and '.ksy' in r and '.surf' in r and '.glb' in r, r[:300])
    pg.evaluate('document.querySelector("#details").scrollTop = 99999'); time.sleep(0.5)
    shot('13_map_export.png')
    # forest blocks: the trees of a map's 32 m forest squares (the tutorial map has no placed tree at all)
    fo = pg.evaluate('''(async () => { const ms = await (await fetch("/api/maps")).json(); const m = ms.find(x => /ausbildungslager/i.test(x.rel)); if (!m) return null;
      const i = await (await fetch("/api/map?id=" + encodeURIComponent(m.id))).json(); const f = i.forest, t = f.trees; let low = 0, out = 0;
      for (let k = 0; k < t.length; k += 5) { if (t[k + 2] <= 16) low++; if (t[k] < 0 || t[k] > i.w || t[k + 1] < 0 || t[k + 1] > i.h || t[k + 4] > 4) out++; }
      return { blocks: f.blocks, patterns: f.patterns, trees: t.length / 5, deco: f.deco.length / 4, low, out, models: f.tree_models, deco_models: f.deco_models,
        placed: i.object_list.filter(o => o.type === "TREE").length }; })()''')
    if fo and fo['patterns']:
        check('forest blocks: the tutorial map gets its trees', fo['blocks'] > 2000 and fo['trees'] > 30000 and fo['placed'] == 0, {k: fo[k] for k in ('blocks', 'trees', 'deco', 'placed')})
        check('forest blocks: trees stand on land inside the map', fo['low'] == 0 and fo['out'] == 0, (fo['low'], fo['out']))
        check('forest blocks: every tree and undergrowth kind has a model', all(fo['models']) and len(fo['models']) == 5 and all(fo['deco_models']), (fo['models'], fo['deco_models']))
        pg.fill('#search', 'canyon'); time.sleep(0.4)
        pg.click('#list li >> nth=0')
        pg.wait_for_function('document.querySelector("#busy").classList.contains("hidden") && /canyon/i.test(PWX.cur.map && PWX.cur.map.id || "")', timeout=180000)
        pg.wait_for_function('PWX.map && PWX.map.layers.forest.children.length > 0', timeout=240000)
        for i in range(240):
            if i > 3 and pg.evaluate('(() => { const b = document.querySelector("#map-progress"); return !!b && b.classList.contains("hidden"); })()'): break
            time.sleep(1)
        n = pg.evaluate('(() => { const m = new Map(); for (const c of PWX.map.layers.forest.children) m.set(c.name, c.count); return [...m.values()].reduce((a, b) => a + b, 0); })()')
        check('forest blocks: drawn in the map viewer', n == pg.evaluate('PWX.cur.map.forest.trees.length / 5') and n > 1000, n)
        check('forest blocks: layer switches', pg.locator('#s-parts label:has-text("Forest blocks: trees") input').count() == 1 and pg.locator('#s-parts label:has-text("undergrowth") input').count() == 1)
        time.sleep(1); shot('17_forest_blocks.png')
    elif fo:
        check('forest blocks: note when the game program is missing', True, 'no PWServer.exe / PWClient.exe in this installation')
    # ---- mod configurations (Data/Info/*.info): the base game by default, a mod with what it requires on request
    st = pg.evaluate('(async () => (await fetch("/api/state")).json())()')
    mods = st.get('mods') or []
    check('mod selector: the base game is the default', st.get('mod') == '' and st.get('mod_folders') == ['Base'] and (not mods or mods[0]['id'] == ''), (st.get('mod'), st.get('mod_folders')))
    pick = next((m for m in mods if m['id'].lower() == 'mirage'), None) or next((m for m in mods if len(m['folders']) > 2), None) or (mods[1] if len(mods) > 1 else None)
    if pick:
        pg.evaluate('PWX.map && PWX.map.dispose()')
        n0 = pg.evaluate('(async () => (await (await fetch("/api/catalog")).json()).entries.length)()')
        check('mod selector lists the mods of Data/Info', pg.locator('#mod-global option').count() == len(mods) and pg.is_visible('#mod-global'), [m['id'] for m in mods])
        with pg.expect_navigation(timeout=900000):
            pg.select_option('#mod-global', pick['id'])
        pg.wait_for_selector('#list li', timeout=600000)
        pg.fill('#search', 'babbage'); time.sleep(0.5)
        if pg.locator('#list li').count() == 0: pg.fill('#search', ''); time.sleep(0.5)
        pg.click('#list li >> nth=0')
        pg.wait_for_function('document.querySelector("#busy").classList.contains("hidden") && document.querySelector("#d-head h2")', timeout=240000); time.sleep(1.5)
        shot('18_mod_selector_global.png')
        pg.fill('#search', ''); time.sleep(0.3)
        st2 = pg.evaluate('(async () => (await fetch("/api/state")).json())()')
        n1 = pg.evaluate('(async () => (await (await fetch("/api/catalog")).json()).entries.length)()')
        check('mod selector: the mod loads with everything it requires', st2.get('mod') == pick['id'] and st2.get('mod_folders') == pick['folders'], st2.get('mod_folders'))
        check('mod selector: the unit list follows the mod', n1 >= n0 and (n1 > n0 or pick['id'].lower() != 'mirage'), (n0, n1))
        top = pick['folders'][-1]
        cp = pg.evaluate('''(async (top) => { const ms = await (await fetch("/api/models")).json(); const m = ms.find(x => x.mods && x.mods.length > 1 && x.mods.includes(top) && x.anims > 0);
          if (!m) return null; const i = await (await fetch("/api/model?name=" + encodeURIComponent(m.name))).json(); return [m.name, i.mod, i.url]; })''', top)
        if cp:
            check('mod selector: a model loads as the mod\'s copy, with the mod\'s texture chain', cp[1] == top and ('tex_' + '+'.join(reversed(pick['folders']))) in cp[2], cp)
        # units of the mod get their add-ons from the mod's scripts (pwexport/modparts.py), offsets included
        du = pg.evaluate('''(async () => { const c = await (await fetch("/api/catalog")).json(); const d = c.entries.filter(e => e.addons.some(a => a.derived));
          const o = d.find(e => e.addons.some(a => a.derived && a.default && a.offset && a.pi < 0 && a.kind !== "rider")); return [d.length, o ? o.id : null]; })()''')
        if du[0]:
            check('mod units: add-ons read from the mod\'s scripts', du[0] > 0, du)
        if du[1]:
            pg.fill('#search', du[1]); time.sleep(0.6)
            pg.click('#list li >> nth=0')
            pg.wait_for_function('document.querySelector("#busy").classList.contains("hidden") && PWX.cur.entry && PWX.cur.entry.id === %s && PWX.cur.parts && PWX.cur.parts.length > 1' % json.dumps(du[1]), timeout=300000); time.sleep(2)
            pos = pg.evaluate('PWX.cur.parts.map((p, i) => p.offset ? [p.offset, PWX.viewer.parts[i].obj.children[0].position.toArray()] : null).filter(Boolean)')
            check('mod units: parts sit at the script\'s offset from their link', pos and all(max(abs(a - b) for a, b in zip(o, p)) < 1e-3 for o, p in pos), pos[:2])
            shot('19_mod_unit_addons.png')
            # parts a script links to the same point stay together: switching one off and on leaves the others on
            boxes = pg.locator('#s-addons input[type=checkbox]:checked').count()
            if boxes >= 2:
                first = pg.locator('#s-addons input[type=checkbox]:checked').first
                first.click(); time.sleep(1.5)           # (the panel is redrawn: click, not uncheck())
                off = pg.locator('#s-addons input[type=checkbox]:checked').count()
                pg.locator('#s-addons input[type=checkbox]:not(:checked)').first.click(); time.sleep(2.0)
                check('mod units: add-ons on one link can be shown together', off == boxes - 1 and pg.locator('#s-addons input[type=checkbox]:checked').count() == boxes, (boxes, off))
            pg.fill('#search', ''); time.sleep(0.3)
        ml = pg.evaluate('(async () => (await (await fetch("/api/maps")).json()).map(m => m.pack))()')
        check('mod selector: maps of the loaded folders only', ml and set(x.lower() for x in ml) <= set(f.lower() for f in pick['folders']), sorted(set(ml)))
        with pg.expect_navigation(timeout=900000):
            pg.select_option('#mod-global', '')
        pg.wait_for_selector('#list li', timeout=600000)
        st3 = pg.evaluate('(async () => (await fetch("/api/state")).json())()')
        check('mod selector: back to the base game', st3.get('mod') == '' and st3.get('mod_folders') == ['Base'], st3.get('mod_folders'))
    # ---- remake
    if '--no-remake' not in sys.argv:
        t0 = time.time()
        pg.evaluate('PWX.map && PWX.map.dispose()')          # a map with its forests keeps a software renderer busy
        pg.click('#btn-home', no_wait_after=True); pg.wait_for_selector('#remake-card', timeout=600000)
        check('back to the launcher', True, '%.1f s' % (time.time() - t0))
        if pg.locator('#play').count():
            pg.click('#play')
            st = None
            for _ in range(240):
                st = pg.evaluate('window.G && (G.titleReady ? "title" : G.error ? "error:" + G.error : null)')
                if st: break
                time.sleep(0.5)
            check('remake title screen', st == 'title', st)
            pg.mouse.click(400, 300)
            pg.evaluate('G.menu.hooks.start({...G.settings.skirmish, me: "Ninigi", ai: "Hu"})')
            for _ in range(400):
                st = pg.evaluate('G.ready ? "ready" : G.error ? "error:" + G.error : "loading"')
                if st != 'loading': break
                time.sleep(0.5)
            check('remake skirmish starts', st == 'ready', st)
        else:
            check('remake game data prepared (skipped)', True)
    errs = [l for l in logs if 'PAGEERROR' in l or l.startswith('error')]
    check('no page errors', not errs, errs[:5])
    b.close()
