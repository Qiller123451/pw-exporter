"""The remake's game data, built on the player's computer from their own ParaWorld installation.

Nothing of the game ships with the toolkit: the first start of the remake runs these steps (about 5-10 minutes),
later starts reuse the result until the installation or the toolkit's asset version changes.

    from remake import pipeline
    pipeline.build(data_dir, out_dir, progress=lambda stage, frac: ..., log=print)
    pipeline.status(data_dir, out_dir)   -> {'ready': bool, 'reason': ...}

Steps (each module has run(log, progress) and a command line for running it alone):
    rules     build_data.py      tech tree + scripts -> techtree.json, gamedata.json
    models    convert_models.py  every .gsf archive -> .glb (scratch folder _conv, removed at the end)
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
import shutil
import time
import traceback

from . import paths

# bump when a step's output changes: installations built with an older version are rebuilt on the next start
ASSET_VERSION = '2026.10.2'
STEPS = [('rules', 'build_data', 0.02), ('models', 'convert_models', 0.45), ('assets', 'build_assets', 0.25),
         ('ui', 'build_ui', 0.05), ('menu', 'build_menu', 0.03), ('cursors', 'build_cursors', 0.01),
         ('terrain', 'build_terrain', 0.15), ('sounds', 'build_sounds', 0.04)]


def _signature(data_dir):
    """what the build depends on: the archives, scripts and textures of the installation (size + time)"""
    from pwexport.install import Install
    game = Install(data_dir)
    sig = []
    for name, p in sorted(game.archives().items()):
        st = os.stat(p)
        sig.append('%s:%d:%d' % (name, st.st_size, int(st.st_mtime)))
    tt = game.file('Scripts/Server/settings/techtree/_TechTree.ttree')
    if tt:
        st = os.stat(tt)
        sig.append('tt:%d:%d' % (st.st_size, int(st.st_mtime)))
    import zlib
    return '%08x' % (zlib.crc32('|'.join(sig).encode()) & 0xffffffff)


def status(data_dir, out_dir):
    f = os.path.join(out_dir, 'build.json')
    try:
        with open(f, encoding='utf-8') as fh:
            b = json.load(fh)
    except (OSError, ValueError):
        return {'ready': False, 'reason': 'not built'}
    if b.get('version') != ASSET_VERSION:
        return {'ready': False, 'reason': 'toolkit updated', 'built': b}
    if b.get('ok') is not True:
        return {'ready': False, 'reason': 'last build failed', 'built': b}
    try:
        if b.get('signature') != _signature(data_dir):
            return {'ready': False, 'reason': 'game files changed', 'built': b}
    except (OSError, ValueError) as e:
        return {'ready': False, 'reason': str(e)}
    return {'ready': True, 'built': b}


def build(data_dir, out_dir, progress=None, log=None, steps=None, keep_conv=False):
    """run the steps; progress(stage, fraction 0..1), log(*args). Returns the build record (also out/build.json)."""
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
    rec = {'version': ASSET_VERSION, 'started': time.strftime('%Y-%m-%d %H:%M:%S'), 'data': data_dir, 'ok': False, 'steps': {}}
    try:
        rec['signature'] = _signature(data_dir)
        for name, mod, share in STEPS:
            if steps and name not in steps:
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
            m.run(_log, sub)
            rec['steps'][name] = round(time.time() - t, 1)
            done += share
        rec['ok'] = True
    except Exception as e:
        rec['error'] = '%s: %s' % (type(e).__name__, e)
        _log(traceback.format_exc())
    finally:
        if not keep_conv and os.path.isdir(paths.CONV):
            shutil.rmtree(paths.CONV, ignore_errors=True)
        rec['seconds'] = round(time.time() - t0, 1)
        with open(os.path.join(out_dir, 'build.json'), 'w', encoding='utf-8') as f:
            json.dump(rec, f, indent=1)
        with open(os.path.join(out_dir, 'build.log'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))
        if progress:
            progress('done' if rec['ok'] else 'failed', 1.0)
    return rec
