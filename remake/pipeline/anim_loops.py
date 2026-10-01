"""Clips made of a start, a loop and an end part ("S/L/E", e.g. the walk of the SEAS Black widow or an animal's rest):
the GSF animation chunks mark the loop (pwexport.gsf writes it into the animation extras). The original engine plays
the start once, repeats the loop while the action lasts and plays the end when it stops; looping the whole clip makes
a unit stop for a moment every cycle. Writes manifest.models[m].loops = {clip: [t0, t1]} (the loop part in seconds,
pwexport.glb.walk_loops); the game cuts the clips into their parts (engine/assets.js splitLoops, game/anim.js).
Usage: python3 tools/anim_loops.py [dist]"""
import json, sys, os
try:
    from . import paths
except ImportError:
    import paths
from pwexport import glb   # noqa: E402


def main(log=lambda *a: None):
    DIST = paths.OUT
    MAN = os.path.join(DIST, 'assets', 'manifest.json')
    man = json.load(open(MAN))
    found = 0
    for name, m in man['models'].items():
        if not m.get('nanims'): continue
        p = os.path.join(DIST, 'assets', 'models', name + '.glb')
        if not os.path.exists(p): continue
        j, b = glb.load(p)
        loops = glb.walk_loops(j, b)
        if loops:
            m['loops'] = loops; found += 1
            log(name, loops)
        elif 'loops' in m: del m['loops']
    json.dump(man, open(MAN, 'w'), indent=1)
    log(found, 'models with start/loop/end clips')


if __name__ == '__main__':
    paths.configure(paths.DATA or '.', sys.argv[1])
    main(print)
