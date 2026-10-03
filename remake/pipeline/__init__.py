"""The remake's game data, built on the player's computer from their own ParaWorld installation.

Nothing of the game ships with the toolkit: the first start of the remake runs these steps (about 5-10 minutes).
Later builds are incremental: a step runs again only when its code changed, the game files it reads changed, a step
it builds on ran again, or its output is missing (fingerprints in build.json, see stamps.py).

    from remake import pipeline
    pipeline.build(data_dir, out_dir, progress=lambda stage, frac: ..., log=print)   # what is out of date
    pipeline.build(data_dir, out_dir, force=True)                                    # everything again
    pipeline.build(data_dir, out_dir, steps=['ui', 'menu'])                          # exactly these steps
    pipeline.status(data_dir, out_dir)   -> {'ready': bool, 'reason': ..., 'todo': [steps that would run]}

Steps (each module has run(log, progress) and a command line for running it alone):
    rules     build_data.py      tech tree + scripts -> techtree.json, gamedata.json
    models    convert_models.py  every .gsf archive -> .glb (scratch folder _conv, kept between builds)
    assets    build_assets.py    the models the game needs -> assets/models, assets/tex, assets/manifest.json
    ui        build_ui.py        HUD textures + icon atlas -> assets/ui
    menu      build_menu.py      menu art -> assets/ui/menu
    cursors   build_cursors.py   mouse cursors -> assets/ui/cur
    terrain   build_terrain.py   ground textures of every setting -> assets/terrain
    sounds    build_sounds.py    sound events -> assets/sounds.json (the wavs stay in the game folder)
Music (Audio/Music/*.mp3) and the maps are read straight from the installation by the server.
"""
import json
import os
import time
import traceback

from . import paths, stamps

# bump only to force a full rebuild of every installation (code changes are noticed by the fingerprints)
ASSET_VERSION = '2026.10.4'
# name, module, share of the progress bar, steps it builds on, game folders / files it reads (below Data/<mod>/),
# outputs (below the output folder) that must exist
STEPS = [
    ('rules', 'build_data', 0.02, [], ['Scripts/Server', 'Scripts/Game/misc', '../locale'], ['techtree.json', 'gamedata.json']),
    ('models', 'convert_models', 0.45, [], ['GSF', 'Texture'], ['_conv/stamps.json']),
    ('assets', 'build_assets', 0.25, ['rules', 'models'], ['GSF'], ['assets/manifest.json', 'assets/models']),
    ('ui', 'build_ui', 0.05, [], ['UI/hud', 'UI/All_def.txt'], ['assets/ui/atlas.json']),
    ('menu', 'build_menu', 0.03, [], ['UI/menue'], ['assets/ui/menu']),
    ('cursors', 'build_cursors', 0.01, [], ['Cursors'], ['assets/ui/cur']),
    ('terrain', 'build_terrain', 0.15, [], ['Texture/Scape'], ['assets/terrain']),
    ('sounds', 'build_sounds', 0.04, ['assets'], ['Scripts/Server/init', 'Scripts/Game/misc'], ['assets/sounds.json']),
    # the computer player's tables (docs/COMPUTER_PLAYER.md): the AI scripts and settings, and the server scripts with
    # the difficulty handicaps
    ('ai', 'build_ai', 0.01, [], ['Scripts/Ai', 'Scripts/Server/settings/Techtree/_AI_ObjectData.txt', 'Scripts/Server/misc',
                                 'Scripts/Server/classes/task/Action.usl', 'Scripts/Server/classes/FightingObj/FightingObj.usl'],
     ['ai.json']),
]
HERE = os.path.dirname(os.path.abspath(__file__))


def _inputs(data_dir, rels):
    """the paths Data/<mod>/<rel> of every mod folder (missing ones count as missing in the hash)"""
    from pwexport.install import Install, _ci_join
    game = Install(data_dir)
    out = []
    for m in game.model_mods:
        for rel in rels:
            base = data_dir if rel.startswith('../') else os.path.join(data_dir, m)
            p = _ci_join(base, rel[3:] if rel.startswith('../') else rel)
            if p:
                out.append(p)
    return out


def fingerprints(data_dir, max_age=0):
    """{step: {'code', 'files', 'fp'}} as the installation and the toolkit are now"""
    fps = {}
    for name, mod, _, needs, rels, _ in STEPS:
        code = stamps.code_hash(os.path.join(HERE, mod + '.py'))
        files = stamps.tree_hash(data_dir, _inputs(data_dir, rels), max_age=max_age)
        fps[name] = {'code': code, 'files': files, 'fp': stamps.combine(code, files, *[fps[n]['fp'] for n in needs])}
    return fps


def _todo(data_dir, out_dir, built, max_age=0):
    """the steps that would run: fingerprint changed, output missing, or a step they build on is in the list"""
    now = fingerprints(data_dir, max_age)
    old = (built or {}).get('fingerprints') or {}
    todo = []
    for name, _, _, needs, _, outs in STEPS:
        if (old.get(name) or {}).get('fp') != now[name]['fp'] or any(n in todo for n in needs) \
                or not all(os.path.exists(os.path.join(out_dir, o)) for o in outs):
            todo.append(name)
    return todo, now


def status(data_dir, out_dir):
    f = os.path.join(out_dir, 'build.json')
    try:
        with open(f, encoding='utf-8') as fh:
            b = json.load(fh)
    except (OSError, ValueError):
        return {'ready': False, 'reason': 'not built', 'todo': [s[0] for s in STEPS]}
    if b.get('version') != ASSET_VERSION:
        return {'ready': False, 'reason': 'toolkit updated', 'built': b, 'todo': [s[0] for s in STEPS]}
    try:
        todo, _ = _todo(data_dir, out_dir, b, max_age=20)
    except (OSError, ValueError) as e:
        return {'ready': False, 'reason': str(e)}
    if b.get('ok') is not True:
        return {'ready': False, 'reason': 'last build failed', 'built': b, 'todo': todo or [s[0] for s in STEPS]}
    if todo:
        code = any((b.get('fingerprints', {}).get(n) or {}).get('code') not in (None, stamps.code_hash(os.path.join(HERE, m + '.py')))
                   for n, m, *_ in STEPS if n in todo)
        return {'ready': False, 'reason': 'toolkit updated' if code else 'game files changed', 'built': b, 'todo': todo}
    return {'ready': True, 'built': b, 'todo': []}


def build(data_dir, out_dir, progress=None, log=None, steps=None, force=False, keep_conv=True):
    """run the steps that are out of date (force: all of them; steps: exactly those). progress(stage, fraction 0..1),
    log(*args). Returns the build record (also out/build.json): ok, steps {name: seconds}, skipped, todo."""
    import importlib
    paths.configure(data_dir, out_dir)
    os.makedirs(out_dir, exist_ok=True)
    lines = []

    def _log(*a):
        s = ' '.join(str(x) for x in a)
        lines.append(s)
        if log:
            log(s)
    t0 = time.time()
    done = 0.0
    try:
        with open(os.path.join(out_dir, 'build.json'), encoding='utf-8') as fh:
            old = json.load(fh)
    except (OSError, ValueError):
        old = {}
    if old.get('version') != ASSET_VERSION:
        old = {}
    rec = {'version': ASSET_VERSION, 'started': time.strftime('%Y-%m-%d %H:%M:%S'), 'data': data_dir, 'ok': False,
           'steps': {}, 'skipped': [], 'fingerprints': dict(old.get('fingerprints') or {})}
    try:
        todo, now = _todo(data_dir, out_dir, old)
        run = [s[0] for s in STEPS] if force else [n for n in todo] if not steps else list(steps)
        for name, mod, share, needs, _, _ in STEPS:
            if name not in run:
                done += share
                if not steps:
                    rec['skipped'].append(name)
                continue
            m = importlib.import_module('.' + mod, __name__)
            t = time.time()
            if progress:
                progress(name, done)

            def sub(stage, f, _d=done, _s=share):
                if progress:
                    progress(stage, _d + _s * max(0.0, min(1.0, f)))
            _log('== %s' % name)
            rec['fingerprints'].pop(name, None)          # an interrupted step runs again
            m.run(_log, sub)
            rec['steps'][name] = round(time.time() - t, 1)
            # a step run by name while a step it builds on is out of date stays out of date
            if all(n not in todo or n in rec['steps'] for n in needs):
                rec['fingerprints'][name] = now[name]
            done += share
        rec['ok'] = True
    except Exception as e:
        rec['error'] = '%s: %s' % (type(e).__name__, e)
        _log(traceback.format_exc())
    finally:
        rec['seconds'] = round(time.time() - t0, 1)
        try:
            rec['todo'] = _todo(data_dir, out_dir, rec)[0]
        except Exception:                                 # noqa: BLE001
            rec['todo'] = []
        if rec['ok'] and rec['todo'] and not steps:
            rec['ok'] = False
            rec['error'] = 'still out of date after the build: %s' % ', '.join(rec['todo'])
        with open(os.path.join(out_dir, 'build.json'), 'w', encoding='utf-8') as f:
            json.dump(rec, f, indent=1)
        with open(os.path.join(out_dir, 'build.log'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))
        if progress:
            progress('done' if rec['ok'] else 'failed', 1.0)
    return rec
