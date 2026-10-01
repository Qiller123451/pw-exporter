"""python -m remake.pipeline <ParaWorld folder or its Data folder> <output folder> [step ...] [--keep-conv]"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from remake import pipeline                     # noqa: E402
from pwexport.install import Install            # noqa: E402

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 2:
        print(__doc__)
        sys.exit(2)
    game = Install(args[0])
    last = [0]

    def prog(stage, f):
        p = int(f * 100)
        if p != last[0]:
            last[0] = p
            print('[%3d%%] %s' % (p, stage), flush=True)
    rec = pipeline.build(game.data, args[1], progress=prog, log=print, steps=args[2:] or None, keep_conv='--keep-conv' in sys.argv)
    print('ok' if rec['ok'] else 'FAILED: %s' % rec.get('error'), rec.get('steps'), rec.get('seconds'), 's')
    sys.exit(0 if rec['ok'] else 1)
