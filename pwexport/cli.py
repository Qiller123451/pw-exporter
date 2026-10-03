"""Command line export - for scripts and batch jobs. Uses the install folder and language saved by the app
(or --install / --lang).

    python -m pwexport.cli list [--type CHTR|ANML|VHCL|SHIP|BLDG] [--tribe Hu|Aje|Ninigi|SEAS|World|Special] [--search text]
    python -m pwexport.cli export hu_warrior --format obj --out exports/ [--level 3] [--no-addons] [--anim walk_1 --time 0.5]
    python -m pwexport.cli export-model allosaurus --format glb --out exports/      (any model by its file name)
    python -m pwexport.cli export-all --type ANML --format glb --out exports/animals/

"export" uses the unit's default look: its add-ons as an owned unit shows them (rider, turret, build-ups ...).
"""
import argparse
import os
import sys

from . import mods, parts, scene, writers, blender
from .catalog import Catalog, ModelIndex
from .config import Settings
from .install import Install
from .texts import Texts


def load(a):
    s = Settings()
    path = a.install or s.get('install')
    if not path:
        sys.exit('No ParaWorld folder: run the app once or pass --install "C:/Games/ParaWorld"')
    inst = mods.ModInstall(path, mod=a.mod if a.mod is not None else (s.get('mod') or ''))
    idx = ModelIndex(inst, progress=lambda m, f: print('\r' + m.ljust(60), end='', file=sys.stderr))
    print(file=sys.stderr)
    cat = Catalog(inst, idx, mods.Texts(inst, a.lang or s.get('lang') or 'uk'))
    return inst, idx, cat


def pick_variant(ad, level, epoch=1):
    v = ad['variants']
    if ad['by'] == 'level' or ad['kind'] == 'rider' and len(v) > 1:
        return v[min(level, len(v)) - 1]
    if ad['by'] == 'epoch':
        return v[min(epoch, len(v)) - 1]
    return ad['gfx']


def entry_parts(idx, e, level=1, addons=True):
    """the default look of a catalog entry: [{model, parent (part index), link, anim}]"""
    gfx = e['models'][min(level, len(e['models'])) - 1]['gfx'] if e['models'] else None
    out = [{'model': gfx, 'parent': None, 'link': None, 'anim': None}]
    if not addons:
        return out
    placed = {}
    for ad in e['addons']:
        if not ad['default'] or ad.get('needs_link') or (ad['pi'] >= 0 and ad['pi'] not in placed):
            continue
        if ad['kind'] == 'weapon' and ad['level'] and ad['level'] > level:
            continue
        out.append({'model': pick_variant(ad, level), 'parent': placed.get(ad['pi'], 0), 'link': ad['link'], 'anim': ad.get('anim'),
                    'offset': ad.get('offset')})
        placed[ad['id']] = len(out) - 1
    return out


def do_export(idx, plist, fmt, out, name, anim=None, t=0.0, animations='all'):
    specs = []
    for p in plist:
        path = idx.convert(p['model'])
        j, _ = __import__('pwexport.glb', fromlist=['load']).load(path)
        specs.append({'glb': path, 'parent': p['parent'], 'link': p['link'], 'anim': p['anim'], 'hide': parts.hidden_nodes(j),
                      'offset': p.get('offset')})
    names = None if animations == 'all' else ([anim] if anim else [])
    sc = scene.compose(specs, animations=names)
    base = os.path.join(out, writers._safe(name))
    if fmt in writers.FORMATS:
        return writers.write(sc, base, fmt, anim, t)
    tmp = writers.write_glb(sc, base + '_tmp')[0]
    try:
        return blender.convert(blender.find(Settings().get('blender', '')), tmp, base + blender.FORMATS[fmt]['ext'], fmt)
    finally:
        os.remove(tmp)


def main():
    ap = argparse.ArgumentParser(prog='pwexport.cli', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--install'); ap.add_argument('--lang')
    ap.add_argument('--mod', help='mod configuration (id of a Data/Info/<id>.info, e.g. MIRAGE; "" = the base game); default: the app\'s setting')
    sub = ap.add_subparsers(dest='cmd', required=True)
    ls = sub.add_parser('list'); ls.add_argument('--type'); ls.add_argument('--tribe'); ls.add_argument('--search')
    for nm in ('export', 'export-model', 'export-all'):
        e = sub.add_parser(nm)
        if nm != 'export-all': e.add_argument('name')
        else: e.add_argument('--type'); e.add_argument('--tribe')
        e.add_argument('--format', default='glb', choices=list(writers.FORMATS) + list(blender.FORMATS))
        e.add_argument('--out', default='exports'); e.add_argument('--level', type=int, default=1)
        e.add_argument('--no-addons', action='store_true'); e.add_argument('--anim'); e.add_argument('--time', type=float, default=0.0)
        e.add_argument('--animations', default='all', choices=['all', 'selected', 'none'])
    a = ap.parse_args()
    inst, idx, cat = load(a)
    if a.cmd == 'list':
        for e in cat.entries:
            if a.type and e['type'] != a.type: continue
            if a.tribe and e['tribe'] != a.tribe: continue
            if a.search and a.search.lower() not in (e['name'] + ' ' + e['id']).lower(): continue
            print('%-34s %-7s %-5s %s' % (e['id'], e['tribe'], e['type'], e['name']))
        return
    os.makedirs(a.out, exist_ok=True)
    if a.cmd == 'export-model':
        files = do_export(idx, [{'model': a.name, 'parent': None, 'link': None, 'anim': None}], a.format, a.out, a.name, a.anim, a.time, a.animations)
        print('\n'.join(files)); return
    ents = [cat.entry(a.name)] if a.cmd == 'export' else \
        [e for e in cat.entries if (not a.type or e['type'] == a.type) and (not a.tribe or e['tribe'] == a.tribe)]
    if not ents or ents[0] is None:
        sys.exit('unknown unit/building %s (see "list")' % getattr(a, 'name', ''))
    for e in ents:
        try:
            files = do_export(idx, entry_parts(idx, e, a.level, not a.no_addons), a.format, a.out,
                              '%s_level%d' % (e['id'], a.level) if a.level > 1 else e['id'], a.anim, a.time, a.animations)
            print(files[0])
        except Exception as ex:
            print('! %s: %s' % (e['id'], ex), file=sys.stderr)


if __name__ == '__main__':
    main()
