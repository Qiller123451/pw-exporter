"""Step "models": convert every model archive (.gsf) of the installation into .glb files for the asset build.

Uses the Model Exporter's GSF reader (pwexport/gsf.py), so a fix to the exporter is a fix here.
Output: <CONV>/<archive>/<model>.glb (+ <archive>/textures), every part kept with its flags (all_parts).
Standalone: python remake/pipeline/convert_models.py <Data folder> <output folder>
"""
import os
import sys
import time

try:
    from . import paths
except ImportError:
    import paths
from pwexport import gsf                      # noqa: E402
from pwexport.install import Install          # noqa: E402


def run(log=print, progress=None):
    game = Install(paths.DATA)
    finders = {}
    t0 = time.time()
    n = 0
    arch = sorted(game.archives().items())
    for k, (name, path) in enumerate(arch):
        if progress:
            progress('Converting models: %s' % name, k / len(arch))
        t = time.time()
        res = gsf.convert_file(path, paths.CONV, data_dir=game.data, all_parts=True, finders=finders, log=lambda *a: None)
        n += len(res)
        log('%-28s %4d models  %5.1f s' % (name, len(res), time.time() - t))
    log('done: %d models in %.0f s -> %s' % (n, time.time() - t0, paths.CONV))


if __name__ == '__main__':
    paths.configure(sys.argv[1], os.path.dirname(os.path.abspath(sys.argv[2])), sys.argv[2])
    run()
