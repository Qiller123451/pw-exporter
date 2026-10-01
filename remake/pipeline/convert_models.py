"""Step "models": convert every model archive (.gsf) of the installation into .glb files for the asset build.

Uses the Model Exporter's GSF reader (pwexport/gsf.py), so a fix to the exporter is a fix here.
Output: <CONV>/<archive>/<model>.glb (+ <archive>/textures), every part kept with its flags (all_parts).
The folder stays between builds: <CONV>/stamps.json records for every archive what it was converted from (the
archive's size and time, the textures, the converter's code), and an archive is only converted again when one of
those changed. Deleting <CONV> is safe (everything is converted again on the next build).
Standalone: python remake/pipeline/convert_models.py <Data folder> <output folder>
"""
import json
import os
import shutil
import sys
import time

try:
    from . import paths, stamps
except ImportError:
    import paths
    import stamps
from pwexport import gsf                      # noqa: E402
from pwexport.install import Install          # noqa: E402


def inputs(game):
    """the game files this step reads: the archives and the texture folders the converter looks in"""
    from pwexport.install import _ci_join
    return [_ci_join(os.path.join(game.data, m), 'GSF') for m in game.model_mods] + gsf.texture_roots(game.data, None)


def _load(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=1, sort_keys=True)
    os.replace(tmp, path)


def run(log=print, progress=None):
    game = Install(paths.DATA)
    os.makedirs(paths.CONV, exist_ok=True)
    stamp_file = os.path.join(paths.CONV, 'stamps.json')
    old = _load(stamp_file)
    code = stamps.code_hash(os.path.abspath(__file__))
    tex = stamps.tree_hash(game.data, gsf.texture_roots(game.data, None))
    arch = sorted(game.archives().items())
    names = {a for a, _ in arch}
    # folders of archives that are no longer in the installation (the asset step reads every folder in CONV)
    keep = {os.path.splitext(os.path.basename(p))[0].lower() for _, p in arch}
    for e in os.listdir(paths.CONV):
        if os.path.isdir(os.path.join(paths.CONV, e)) and e.lower() not in keep:
            shutil.rmtree(os.path.join(paths.CONV, e), ignore_errors=True)
    new = {}
    finders = {}
    t0 = time.time()
    n = done = 0
    for k, (name, path) in enumerate(arch):
        if progress:
            progress('Converting models: %s' % name, k / len(arch))
        st = os.stat(path)
        folder = os.path.splitext(os.path.basename(path))[0]
        key = stamps.combine(code, tex, os.path.relpath(path, game.data).lower(), st.st_size, int(st.st_mtime))
        prev = old.get(name) or {}
        if prev.get('key') == key and os.path.isdir(os.path.join(paths.CONV, prev.get('dir') or folder)):
            new[name] = prev
            n += prev.get('models', 0)
            continue
        # forget the old conversion before touching its folder: an interrupted build converts this archive again
        old.pop(name, None)
        _save(stamp_file, dict({a: v for a, v in old.items() if a in names}, **new))
        shutil.rmtree(os.path.join(paths.CONV, prev.get('dir') or folder), ignore_errors=True)
        t = time.time()
        res = gsf.convert_file(path, paths.CONV, data_dir=game.data, all_parts=True, finders=finders, log=lambda *a: None)
        n += len(res)
        done += 1
        new[name] = {'key': key, 'dir': folder, 'models': len(res)}
        _save(stamp_file, dict({a: v for a, v in old.items() if a in names}, **new))
        log('%-28s %4d models  %5.1f s' % (name, len(res), time.time() - t))
    _save(stamp_file, new)
    log('done: %d models, %d of %d archives converted (the others were up to date) in %.0f s -> %s'
        % (n, done, len(arch), time.time() - t0, paths.CONV))


if __name__ == '__main__':
    paths.configure(sys.argv[1], os.path.dirname(os.path.abspath(sys.argv[2])), sys.argv[2])
    run()
