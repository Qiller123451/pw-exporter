"""The Workshop without the browser (docs/WORKSHOP.md "For developers").

    python -m workshop templates <game> [--base MIRAGE] [--kind unit|building|animal|decoration]
    python -m workshop build <project folder> <game> <out folder>
    python -m workshop install <project folder> <game> [--no-langs]
    python -m workshop uninstall <mod id> <game>
"""
import argparse
import json
import os
import sys

from . import build as B, install as I, project as P
from .gamedata import GameData


def main(argv=None):
    ap = argparse.ArgumentParser(prog='workshop', description='ParaWorld Workshop: new objects for the game and the remake')
    sub = ap.add_subparsers(dest='cmd', required=True)
    t = sub.add_parser('templates', help='list the objects a new one can be made from')
    t.add_argument('game'); t.add_argument('--base', default=''); t.add_argument('--kind', default='')
    b = sub.add_parser('build', help='build a project into a mod folder')
    b.add_argument('project'); b.add_argument('game'); b.add_argument('out')
    i = sub.add_parser('install', help='build a project and install it into the game')
    i.add_argument('project'); i.add_argument('game'); i.add_argument('--no-langs', action='store_true')
    u = sub.add_parser('uninstall', help='remove an installed mod from the game')
    u.add_argument('mod'); u.add_argument('game')
    a = ap.parse_args(argv)
    if a.cmd == 'templates':
        for o in GameData(a.game, a.base).templates():
            if not a.kind or o['kind'] == a.kind:
                print('%-10s %-8s %-40s %-28s %s' % (o['kind'], o['tribe'], o['id'], o['script'], o['gfx']))
        return 0
    if a.cmd == 'build':
        r = B.build(P.Project.load(a.project), a.game, a.out)
        print(json.dumps(r, indent=1))
        return 0
    if a.cmd == 'install':
        p = P.Project.load(a.project)
        out = os.path.join(p.folder, 'build')
        r = B.build(p, a.game, out)
        for w in r['warnings']:
            print('warning:', w)
        for f in I.install(out, a.game, p.id, langs=not a.no_langs):
            print('installed', f)
        return 0
    if a.cmd == 'uninstall':
        for f in I.uninstall(a.game, a.mod):
            print('removed', f)
        return 0
    return 1


if __name__ == '__main__':
    sys.exit(main())
