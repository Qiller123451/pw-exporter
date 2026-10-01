"""Start a game the way a player does (title menu -> skirmish start, audio unlocked, real frame loop) and call
each per-frame step once, reporting the first exception of each. python3 tests/menu_start.py [tribe] [enemy]"""
import sys, time, json
from playwright.sync_api import sync_playwright
me = sys.argv[1] if len(sys.argv) > 1 else 'SEAS'
ai = sys.argv[2] if len(sys.argv) > 2 else 'Aje'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 960, 'height': 540})
    logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.goto('http://127.0.0.1:8411/index.html')
    for _ in range(120):
        if pg.evaluate('!!(window.G && (G.titleReady || G.error))'): break
        time.sleep(0.5)
    pg.mouse.click(400, 300)          # user gesture: unlocks audio
    pg.evaluate(f'G.menu.hooks.start({{...G.settings.skirmish, me: "{me}", ai: "{ai}"}})')
    for _ in range(240):
        st = pg.evaluate('G.ready ? "ready" : G.error ? "error:" + G.error : "loading"')
        if st != 'loading': break
        time.sleep(0.5)
    print('state', st)
    time.sleep(5)
    r = pg.evaluate('''(() => { const out = {}; const steps = {
      input: () => G.input.update(0.016), cam: () => G.rtscam.update(0.016), props: () => G.props.update(G.camera),
      foliage: () => G.foliage.update(G.camera.position), sun: () => G.renderer.followSun(G.rtscam.target), fx: () => G.fx.update(0.016),
      music: () => G.audio.updateMusic(G.world.time, G.me.tribe), overlay: () => G.overlay.update(0.016), hud: () => G.hud.update(0.016),
      minimap: () => G.minimap.update(0.016, true), render: () => G.renderer.render(performance.now()), step: () => G.step(1, 0.05) };
      for (const k in steps) { try { steps[k](); out[k] = 'ok'; } catch (e) { out[k] = String(e.stack || e).split('\\n').slice(0, 4).join(' | '); } }
      out.time = G.world.time; return JSON.stringify(out, null, 1); })()''')
    print(r)
    for l in [x for x in logs if 'PropertyBinding' not in x][-20:]: print(l[:600])
    b.close()
