"""python -m pwexport.hd <prepared data folder> <model> [<model> ...] [--only hd|remodel] [--out <folder>] [--blender <exe>]"""
import argparse

from . import build, VARIANTS


def main():
    ap = argparse.ArgumentParser(prog='python -m pwexport.hd', description='HD versions of models of the remake\'s prepared game data')
    ap.add_argument('data', help='the prepared data folder (<toolkit data>/remake/<id>)')
    ap.add_argument('models', nargs='+')
    ap.add_argument('--only', choices=VARIANTS, help='make one variant only')
    ap.add_argument('--out', help='output folder (default: <toolkit data>/hd)')
    ap.add_argument('--cache', help='folder for the enlarged textures and the network weights')
    ap.add_argument('--blender', help='blender executable for the remodelled variant')
    ap.add_argument('--level', type=int, default=3, help='PN triangle level of the hd variant (default 3: 9 triangles each)')
    a = ap.parse_args()
    for m in a.models:
        build(m, a.data, a.out, only=(a.only,) if a.only else VARIANTS, cache=a.cache, level=a.level, blender=a.blender)


if __name__ == '__main__':
    main()
