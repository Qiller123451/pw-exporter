"""The remake's game data, built on the player's computer from their own ParaWorld installation.

Nothing of the game ships with the toolkit: the first start of the remake runs these steps (about 5-10 minutes).
Later builds only redo what is out of date: a step runs again when the game files it reads or its code (its
module and the toolkit modules it imports, see stamps.py) changed, or when a step it builds on ran again. The
model conversion additionally keeps its output (<out>/_conv) and converts only the archives that changed.

    from remake import pipeline
    pipeline.build(data_dir, out_dir, progress=lambda stage, frac: ..., log=print)   # force=True: everything again
    pipeline.status(data_dir, out_dir)   -> {'ready': bool, 'reason': ..., 'todo': [steps that would run]}

Steps (each module has run(log, progress) and a command line for running it alone):
    rules     build_data.py      tech tree + scripts -> techtree.json, gamedata.json
    models    convert_models.py  every .gsf archive -> .glb (folder _conv, kept between builds)
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

# Code changes are noticed by themselves (stamps.code_hash), so this does NOT need a bump for them. Bump it only to
# make every installation build everything again (e.g. a new Pillow / numpy changes the output).
ASSET_VERSION = '2026.10.2'


def _mods(game, rel, mods=None):
    from pwexport.install import _ci_join
    return [_ci_join(os.path.join(game.data, m), rel) for m in (mods or game.mods)]


def _models_in(game):
    from . import convert_models
    return convert_models.inputs(game)


# name, module, share of the build time, steps whose output it reads, the game files it reads (folders, recursively),
# what it writes (below the output folder; a missing one makes the step run again)
STEPS = [
    ('rules', 'build_data', 0.02, (), lambda g: _mods(g, 'Scripts') + [g.locale_dir(l) for l in g.locales()],
     ('gamedata.json', 'techtree.json')),
    ('models', 'convert_models', 0.45, (), _models_in, ('_conv/stamps.json',)),
    ('assets', 'build_assets', 0.25, ('rules', 'models'), lambda g: [], ('assets/manifest.json', 'assets/models', 'assets/tex')),
    ('ui', 'build_ui', 0.05, (), lambda g: _mods(g, 'UI/hud', ['Base']) + _mods(g, 'UI/All_def.txt', ['Base']),
     ('assets/ui/atlas.json',)),
    ('menu', 'build_menu', 0.03, (), lambda g: _mods(g, 'UI/menue', ['Base']), ('assets/ui/menu',)),
    ('cursors', 'build_cursors', 0.01, (), lambda g: _mods(g, 'Cursors', ['Base']), ('assets/ui/cur/hotspots.json',)),
    ('terrain', 'build_terrain', 0.15, (), lambda g: _mods(g, 'Texture/Scape'), ('assets/terrain',)),
    ('sounds', 'build_sounds', 0.04, ('assets',), lambda g: _mods(g, 'Scripts/Server/init') + _mods(g, 'Audio/Sound'),
     ('assets/sounds.json',)),
]


def fingerprints(data_dir, max_age=0):
    """{step: {'code', 'files', 'fp'}}: what each step's output depends on. 'fp' also covers the steps it builds on,
    so a step is up to date exactly when its recorded fp equals the current one."""
    from pwexport.install import Install
    game = Install(data_dir)
    out = {}
    for name, mod, _, needs, inputs, _ in STEPS:
        code = stamps.code_hash(os.path.join(stamps.HERE, mod + '.py'))
        files = stamps.tree_hash(game.data, inputs(game), max_age)
        out[name] = {'code': code, 'files': files,
                     'fp': stamps.combine(ASSET_VERSION, name, code, files, *[out[n]['fp'] for n in needs])}
    return out


def _record(out_dir):
    try:
        with open(os.path.join(out_dir, 'build.json'), encoding='utf-8') as fh:
            b = json.load(fh)
        return b if isinstance(b, dict) else None
    except (OSError, ValueError):
        return None


def _todo(rec, cur, out_dir):
    """the steps that have to run: recorded fingerprint differs from the current one, or their output is gone"""
    done = (rec or {}).get('fingerprints') or {}
    if (rec or {}).get('version') != ASSET_VERSION:
        done = {}
    return [name for name, _, _, _, _, outputs in STEPS
            if (done.get(name) or {}).get('fp') != cur[name]['fp']
            or not all(os.path.exists(os.path.join(out_dir, o)) for o in outputs)]


def status(data_dir, out_dir):
    b = _record(out_dir)
    if b is None:
        return {'ready': False, 'reason': 'not built'}
    try:
        cur = fingerprints(data_dir, max_age=20)      # the launcher asks every second while something is loading
    except (OSError, ValueError) as e:
        return {'ready': False, 'reason': str(e)}
    todo = _todo(b, cur, out_dir)
    if not todo:
        return {'ready': True, 'built': b}
    done = b.get('fingerprints') or {}
    if b.get('version') != ASSET_VERSION or 'fingerprints' not in b:
        reason = 'toolkit updated'
    elif any(n in done and done[n].get('files') != cur[n]['files'] for n in todo):
        reason = 'game files changed'
    elif any(n in done and done[n].get('code') != cur[n]['code'] for n in todo):
        reason = 'toolkit updated'
    else:
        reason = 'last build failed' if b.get('ok') is not True else 'not built'
    return {'ready': False, 'reason': reason, 'built': b, 'todo': todo}


def build(data_dir, out_dir, progress=None, log=None, steps=None, keep_conv=True, force=False):
    """run the steps that are out of date (force: all of them; steps: only these, out of date or not).
    progress(stage, fraction 0..1), log(*args). Returns the build record (also out/build.json).
    keep_conv is accepted for older callers: the converted models are always kept now."""
    import importlib
    paths.configure(data_dir, out_dir)
    lines = []

    def _log(*a):
        s = ' '.join(str(x) for x in a)
        lines.append(s)
        if log:
            log(s)
    t0 = time.time()
    done = 0.0
    prev = _record(out_dir) or {}
    rec = {'version': ASSET_VERSION, 'started': time.strftime('%Y-%m-%d %H:%M:%S'), 'data': data_dir, 'ok': False,
           'steps': {}, 'skipped': [],
           'fingerprints': dict(prev.get('fingerprints') or {}) if prev.get('version') == ASSET_VERSION else {}}

    def save():
        rec['seconds'] = round(time.time() - t0, 1)
        with open(os.path.join(out_dir, 'build.json'), 'w', encoding='utf-8') as f:
            json.dump(rec, f, indent=1)
    try:
        cur = fingerprints(data_dir)
        todo = [n for n, *_ in STEPS] if force else _todo(prev, cur, out_dir)
        if steps:
            todo = [n for n, *_ in STEPS if n in steps]
        if force and 'models' in todo:
            try:
                os.remove(os.path.join(paths.CONV, 'stamps.json'))      # convert every archive again
            except OSError:
                pass
        for name, mod, share, _, _, _ in STEPS:
            if name not in todo:
                if not steps:
                    rec['skipped'].append(name)
                    _log('== %s: up to date' % name)
                done += share
                continue
            m = importlib.import_module('.' + mod, __name__)
            t = time.time()
            if progress:
                progress(name, done)

            def sub(stage, f, _d=done, _s=share):
                if progress:
                    progress(stage, _d + _s * max(0.0, min(1.0, f)))
            _log('== %s' % name)
            rec['fingerprints'].pop(name, None)      # not valid while the step is writing its files
            save()
            m.run(_log, sub)
            rec['steps'][name] = round(time.time() - t, 1)
            rec['fingerprints'][name] = cur[name]
            save()                                   # an interrupted build keeps what it finished
            done += share
        rec['ok'] = True
        rec['todo'] = _todo(rec, cur, out_dir)       # only after a build of single steps: what is still out of date
    except Exception as e:
        rec['error'] = '%s: %s' % (type(e).__name__, e)
        _log(traceback.format_exc())
    finally:
        save()
        with open(os.path.join(out_dir, 'build.log'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))
        if progress:
            progress('done' if rec['ok'] else 'failed', 1.0)
    return rec
