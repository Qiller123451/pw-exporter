"""Find walk/run clips that are "start + loop + stop" in one (e.g. the SEAS Black widow): the clip begins and ends in
the stand pose, and a stretch in the middle loops seamlessly. The original engine loops only that stretch; looping the
whole clip makes the unit stop for a moment every cycle. Writes manifest.models[m].loops = {clip: [t0, t1]}.
The detection itself is pwexport.glb.walk_loops (shared with the Model Exporter, which offers the same trimming).
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
    log(found, 'models with start/loop/stop walk clips')


if __name__ == '__main__':
    paths.configure(paths.DATA or '.', sys.argv[1])
    main(print)
