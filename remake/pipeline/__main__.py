"""python -m remake.pipeline <ParaWorld folder or its Data folder> <output folder> [step ...] [--force]

Without steps: builds what is out of date (--force: everything). With steps: runs exactly those."""
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
    rec = pipeline.build(game.data, args[1], progress=prog, log=print, steps=args[2:] or None, force='--force' in sys.argv)
    print('ok' if rec['ok'] else 'FAILED: %s' % rec.get('error'), rec.get('steps'), rec.get('seconds'), 's',
          'up to date: %s' % ', '.join(rec['skipped']) if rec.get('skipped') else '',
          'still out of date: %s' % ', '.join(rec['todo']) if rec.get('todo') else '')
    sys.exit(0 if rec['ok'] else 1)
