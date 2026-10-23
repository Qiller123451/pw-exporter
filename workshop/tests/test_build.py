"""Build a mod with one object of each kind from a game installation and read every file back.

    python workshop/tests/test_build.py <ParaWorld folder> [--base MIRAGE] [--remake]

Checks: the tech tree and the class lists parse and hold the new objects (with their weapons, level bonuses, build
actions on a free button place), the archive holds the models under the new names and pwexport converts them, the help
and icon entries are there, install / uninstall into a copy of the installation (symbolic links to its folders) and,
with --remake, the remake's data pipeline (rules + ui steps) of the installed mod sees the objects.
Prints ok / FAIL lines."""
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, ROOT)

from workshop import build as B, install as I, project as P, ttree, gsfedit   # noqa: E402
from workshop.gamedata import GameData   # noqa: E402

FAIL = []


def check(name, ok, info=''):
    print(('ok   ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)
    if not ok:
        FAIL.append(name)


def fake_install(game, tmp):
    """a copy of the installation to install into: links to its Data folders, a copy of Data/Info"""
    d = os.path.join(tmp, 'game', 'Data')
    os.makedirs(os.path.join(d, 'Info'))
    src = os.path.join(game, 'Data')
    for e in os.listdir(src):
        if e.lower() != 'info':
            os.symlink(os.path.join(src, e), os.path.join(d, e))
    for f in os.listdir(os.path.join(src, 'Info')):
        shutil.copyfile(os.path.join(src, 'Info', f), os.path.join(d, 'Info', f))
    return os.path.join(tmp, 'game')


def main():
    game = sys.argv[1]
    base = sys.argv[sys.argv.index('--base') + 1] if '--base' in sys.argv else ''
    tmp = tempfile.mkdtemp(prefix='pww_')
    try:
        data = GameData(game, base)
        T = {k: [t for t in data.templates() if t['kind'] == k] for k in ('unit', 'building', 'animal', 'decoration')}
        for k, v in T.items():
            check('templates: %s' % k, len(v) > 0, len(v))
        pick = {'unit': next((t for t in T['unit'] if t['id'] == 'hu_warrior'), T['unit'][0]),
                'building': next((t for t in T['building'] if t['id'] == 'hu_warehouse'), T['building'][0]),
                'animal': next((t for t in T['animal'] if t['id'].lower() == 'stegosaurus'), T['animal'][0]),
                'decoration': T['decoration'][0]}
        p = P.create('WsBuildTest', 'Build test', base, 'uk', base=tmp)
        for k, t in pick.items():
            o = P.new_object('wsbuildtest_' + k, k, t['id'])
            o['texts'] = {'name': 'Test ' + k, 'short': '• one\n• two', 'long': 'A test.'}
            if k == 'unit':
                o['stats'] = {'hitpoints': 444}
                o['cost'] = {'food': 77}
                o['weapon'] = {'damage': 33}
            p.objects.append(o)
        p.save()
        out = os.path.join(tmp, 'out')
        r = B.build(p, game, out)
        check('built', r['objects'] == [o['id'] for o in p.objects], r['warnings'])
        mod = os.path.join(out, 'Data', 'WsBuildTest')
        tt = ttree.load(os.path.join(mod, 'Scripts', 'Server', 'settings', 'Techtree', '_TechTree.ttree'))
        objs = {}
        for t in tt.get('Root/StartTT/Objects').blocks():
            for c in t.blocks():
                for o in c.blocks():
                    objs[o.key] = (t.key, c.key, o)
        for o in p.objects:
            if o['kind'] == 'decoration':
                continue
            ok = o['id'] in objs and objs[o['id']][2].val('gfx') == o['id']
            check('tech tree: %s' % o['id'], ok)
        u = objs.get('wsbuildtest_unit')
        if u:
            tribe = u[0]
            check('unit hit points', u[2].val('hitpoints') == '444', u[2].val('hitpoints'))
            ws = [w for w in tt.get('Root/StartTT/Objects/%s/Weapons' % tribe).blocks() if any(x.value == 'wsbuildtest_unit' for x in (w.get('Users').children if w.get('Users') else []))]
            check('unit weapons (own copies)', ws and all(len(w.get('Users').children) == 1 for w in ws) and float(ws[0].val('damage')) == 33, [(w.key, w.val('damage')) for w in ws])
            acts = [a for c in tt.get('Root/StartTT/Actions/%s/Build' % tribe).blocks() for a in c.blocks()
                    if any(x.value and x.value.endswith('/wsbuildtest_unit') for x in (a.get('results').children if a.get('results') else []))]
            check('unit build actions', acts and all(a.val('conditions/rescosts/food') == '77' for a in acts), [a.key for a in acts])
            places = {(a.get('locations').children[0].value, a.val('locations/0/uiposition/page'), a.val('locations/0/uiposition/place')) for a in acts}
            check('one button for the unit\'s levels', len(places) == 1, places)
            ups = tt.get('Root/Filters/%s/Upgrades/wsbuildtest_unit' % tribe)
            tid = pick['unit']['id']
            olds = [w.key[len('wsbuildtest_unit_'):] for w in ws]
            if ups:
                paths = [n.value for n, _ in ups.find_all(lambda n, p: n.key == 'path')]
                bad = [x for x in paths if '/%s/' % tid in x or any('/Weapons/%s/' % w in x for w in olds)]
                check('level bonuses point at the new object and its weapons', paths and not bad, bad[:3])
            # the upgrades of other buildings (the smithy's) reach the new weapons too
            for w in olds[:1]:
                orig = [n for n, _ in tt.get('Root/Filters').find_all(lambda n, p: n.key == 'path' and n.value and '/Weapons/%s/' % w in n.value and 'wsbuildtest' not in p)]
                mine = [n for n, _ in tt.get('Root/Filters').find_all(lambda n, p: n.key == 'path' and n.value and '/Weapons/wsbuildtest_unit_%s/' % w in n.value)]
                check('every filter on %s has its copy' % w, len(mine) == len(orig), (len(orig), len(mine)))
        cl = ttree.load(os.path.join(mod, 'Scripts', 'Server', 'classes', 'wsbuildtest', 'wsbuildtest_objects.txt'))
        names = [c.key for c in cl.get('Root').blocks()]
        check('class list', all(o['id'] in names for o in p.objects), names)
        idx = ttree.load(os.path.join(mod, 'Scripts', 'Server', 'classes', 'classes.txt'))
        check('class index', any(c.value == 'wsbuildtest.txt' for c in idx.get('Root').children))
        arch = os.path.join(mod, 'GSF', 'wsbuildtest.gsf')
        models = {m['name']: m for m in gsfedit.describe(arch)}
        check('archive models', all(o['id'] in models for o in p.objects), list(models))
        from pwexport import gsf
        a = gsf.Archive(arch)
        for o in p.objects:
            try:
                res = a.export(o['id'], os.path.join(tmp, o['id'] + '.glb'), data_dir=os.path.join(game, 'Data'), all_parts=True, log=lambda *x: None)
                check('converts: %s' % o['id'], res and res.get('meshes', 0) > 0, res)
            except Exception as e:                  # noqa: BLE001
                check('converts: %s' % o['id'], False, e)
        with open(os.path.join(mod, 'GSF', '_gsfs.txt')) as f:
            check('archive list', 'wsbuildtest.gsf' in f.read().split())
        helps = ''
        hd = os.path.join(mod, 'Locale', 'uk', 'Texts', 'Help')
        for f in os.listdir(hd):
            with open(os.path.join(hd, f), encoding='utf-8-sig') as fh:
                helps += fh.read()
        for o in p.objects:
            if o['kind'] != 'decoration':
                check('help item: %s' % o['id'], '\\{helpitem -name _%s Test %s}' % (o['id'], o['kind']) in helps)
        with open(os.path.join(mod, 'UI', 'All_def.txt'), encoding='latin-1') as f:
            atlas = f.read()
        check('icons', all(('source\t%s\t' % o['id']) in atlas for o in p.objects if o['kind'] != 'decoration'))
        # install into a copy of the installation, read it as a configuration, uninstall
        g2 = fake_install(game, tmp)
        I.install(out, g2, 'WsBuildTest')
        d2 = GameData(g2, 'WsBuildTest')
        check('the installed mod is a configuration', 'WsBuildTest' in d2.game.mods, d2.game.mods)
        check('its objects are templates there', {o['id'] for o in p.objects if o['kind'] != 'decoration'} <= {t['id'] for t in d2.templates()})
        loc = open(os.path.join(g2, 'Data', 'Info', 'Locale_UK.info'), encoding='latin-1').read() if os.path.exists(os.path.join(g2, 'Data', 'Info', 'Locale_UK.info')) else ''
        check('texts registered', not loc or 'data/WsBuildTest/locale/uk/' in loc)
        if '--remake' in sys.argv:
            import subprocess
            rb = os.path.join(tmp, 'rb')
            subprocess.run([sys.executable, '-m', 'remake.pipeline', g2, rb, 'rules', 'ui', '--mod=WsBuildTest'], cwd=ROOT, check=True, capture_output=True)
            ttj = json.load(open(os.path.join(rb, 'techtree.json')))
            have = {n for t in ttj['StartTT']['Objects'].values() for c in t.values() if isinstance(c, dict) for n in c}
            check('remake rules', {o['id'] for o in p.objects if o['kind'] != 'decoration'} <= have)
            gd = json.load(open(os.path.join(rb, 'gamedata.json')))
            check('remake texts', all(o['id'] in gd['texts'] for o in p.objects if o['kind'] != 'decoration'))
            check('remake script classes', all(o['id'] in gd['script'] for o in p.objects))
            at = json.load(open(os.path.join(rb, 'assets', 'ui', 'atlas.json')))
            check('remake icons', all(o['id'] in at for o in p.objects if o['kind'] != 'decoration'))
        I.uninstall(g2, 'WsBuildTest')
        check('uninstalled', not os.path.exists(os.path.join(g2, 'Data', 'WsBuildTest')) and 'WsBuildTest' not in open(os.path.join(g2, 'Data', 'Info', 'Locale_UK.info'), encoding='latin-1').read())
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print('%d failed' % len(FAIL))
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
