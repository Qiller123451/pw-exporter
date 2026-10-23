"""Add-ons (workshop/addons.py): a unit made from the Black widow whose turret is moved, with an extra gunner
(a scaled ballista of the Norsemen), a part on the turret and another rider - built, read back, installed into a
copy of the installation and read by the remake's reader of the scripts (pwexport/modparts.py).

    python workshop/tests/test_addons.py <ParaWorld folder> [--base MIRAGE] [--remake]

Prints ok / FAIL lines."""
import os
import re
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, ROOT)
sys.path.insert(0, HERE)

from workshop import addons as A, build as B, install as I, project as P, ttree, gsfedit   # noqa: E402
from workshop.gamedata import GameData   # noqa: E402
from test_build import fake_install       # noqa: E402

FAIL = []


def check(name, ok, info=''):
    print(('ok   ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)
    if not ok:
        FAIL.append(name)


def main():
    game = sys.argv[1]
    base = sys.argv[sys.argv.index('--base') + 1] if '--base' in sys.argv else ''
    tmp = tempfile.mkdtemp(prefix='pwa_')
    try:
        data = GameData(game, base)
        # ---- what the templates' scripts put on
        w = A.template_setup(data, 'seas_wehrspinne')
        check('widow: one main turret at "we"', [(p['role'], p['gfx'].lower(), p['link']) for p in w['parts']] == [('main', 'seas_wehrspinne_top', 'we')], w['parts'])
        check('widow: the rider on the turret\'s Dri1', (w['seat'] or {}).get('link') == 'Dri1' and (w['seat'] or {}).get('part') == 0, w['seat'])
        check('widow: can aim a main turret, switches attack mode', w['can_main'] and w['switch_mode'] and w['transport'])
        t = A.template_setup(data, 'hu_triceratops')
        gun = [p for p in t['parts'] if p['role'] == 'gunner']
        check('titan: two gunners with their weapon class and seat', len(gun) == 2 and all(p['weapon_class'] == 'hu_titan_ballista' and (p['gunner'] or {}).get('link') == 'Dri1' for p in gun), t['parts'])
        check('titan: the passenger platform is a part, no main turret', any(p['role'] == 'part' and 'transporter' in p['gfx'] for p in t['parts']) and not t['can_main'])
        wr = A.template_setup(data, 'hu_warrior')
        check('a warrior cannot carry add-ons', not wr['transport'])
        ws = A.all_weapons(data)
        bal = next((x for x in ws if 'hu_titan_ballista' in x['users']), None)
        check('the weapons list has the titan\'s ballista', bal is not None, len(ws))
        rid = A.riders(data)
        check('riders: captain classes first', rid and rid[0]['captain'] and any(r['cls'] == 'hu_rider_b' for r in rid), len(rid))

        # ---- a mod
        p = P.create('WsAddonTest', 'Add-on test', base, 'uk', base=tmp)
        o = P.new_object('wsaddontest_widow', 'unit', 'seas_wehrspinne')
        o['texts'] = {'name': 'Gun widow', 'short': '', 'long': ''}
        adds = A.default_addons(w)
        adds[0]['pos'] = [0.0, 0.0, 0.5]
        adds[0]['rot'] = [0.0, 0.0, 30.0]
        adds.append({'id': 'g1', 'origin': 'new', 'role': 'gunner', 'model': {'source': 'game', 'name': 'hu_rhino_ballista_buildup_top'},
                     'parent': 'body', 'link': 'we', 'pos': [1.5, 0.0, 0.3], 'rot': [0, 0, 0], 'scale': 1.3,
                     'gunner': {'link': 'Dri1'}, 'weapon': {'from': bal['path'], 'damage': 99}})
        adds.append({'id': 'p1', 'origin': 'new', 'role': 'part', 'model': {'source': 'game', 'name': 'seas_hq_machinegun_nest_top'},
                     'parent': 't1', 'link': '', 'pos': [0, 0, 1.0], 'rot': [0, 0, 0], 'scale': 1.0})
        o['addons'] = adds
        o['rider'] = dict(A.default_rider(w), cls='hu_rider_b', parent='body', link='we', pos=[0.0, -1.0, 1.0])
        check('the add-ons pass the checks', not A.check(o, w), A.check(o, w))
        p.objects.append(o)
        p.save()
        out = os.path.join(tmp, 'out')
        r = B.build(p, game, out)
        check('built', r['objects'] == ['wsaddontest_widow'], r['warnings'])
        mod = os.path.join(out, 'Data', 'WsAddonTest')
        usl = open(os.path.join(mod, 'Scripts', 'Server', 'classes', 'wsaddontest', 'wsaddontest.usl'), encoding='latin-1').read()
        check('script: class over the template\'s', 'class CWs_wsaddontest_widow inherit CWehrspinne' in usl)
        check('script: the template\'s build-ups go', 'DestroyBuildUp();' in usl)
        check('script: main turret, gunner, part', 'SetBuildUp(CBuildUpBase.TYPE_WEAPON);' in usl and 'CreateObj("wsaddontest_widow_t1"' in usl
              and 'AddAdditionalBuildUp(CBuildUpBase.TYPE_WEAPON);' in usl and 'SetWeaponClass("wsaddontest_widow_g1");' in usl
              and 'AddObjFlex(pxP1^.GetHandle(), "Ws01", -1.0, pxT1^.GetHandle());' in usl, usl)
        check('script: the rider\'s seat', re.search(r'po_rxLink="Ws\d\d";\s+po_rbIsBuildUpLink=false;\s+SetCaptainAnim\("balista_stand"\);', usl), usl[-400:])
        check('script: balanced blocks', usl.count('proc ') == usl.count('endproc;') and usl.count('if(') == usl.count('endif;'))
        ini = open(os.path.join(mod, 'Scripts', 'Server', 'Server.ini'), encoding='latin-1').read()
        check('Server.ini lists the script after the game\'s', ini.rstrip().endswith('classes/wsaddontest/wsaddontest.usl') and 'classes/FightingObj/TransportObj/Vehicle.usl' in ini)
        cl = ttree.load(os.path.join(mod, 'Scripts', 'Server', 'classes', 'wsaddontest', 'wsaddontest_objects.txt'))
        R = cl.get('Root')
        check('classes: the object runs the new script', R.get('wsaddontest_widow').val('classattribs/classname') == 'CWs_wsaddontest_widow')
        check('classes: the add-ons', R.get('wsaddontest_widow_t1').val('classattribs/classname') == 'CTaskBuildUp'
              and R.get('wsaddontest_widow_g1').val('classattribs/gfx') == 'wsaddontest_widow_g1'
              and R.get('wsaddontest_widow_p1').val('classattribs/classname') == 'CProduct'
              and R.get('wsaddontest_widow_t1').val('classattribs/gfx') == 'wsaddontest_widow_t1')
        tt = ttree.load(os.path.join(mod, 'Scripts', 'Server', 'settings', 'Techtree', '_TechTree.ttree'))
        node = tt.get('Root/StartTT/Objects/SEAS/VHCL/wsaddontest_widow')
        check('tech tree: the rider', node is not None and node.val('captainclass') == 'hu_rider_b')
        lv = tt.get('Root/Filters/SEAS/Upgrades/wsaddontest_widow')
        caps = [n.value for n, _ in lv.find_all(lambda n, p: n.key == 'captainclass')] if lv else []
        check('tech tree: the rider on every level', caps and set(caps) == {'hu_rider_b'}, caps)
        gw = tt.get('Root/StartTT/Objects/SEAS/Weapons/wsaddontest_widow_g1')
        check('tech tree: the gunner\'s weapon', gw is not None and gw.val('damage') == '99' and [c.value for c in gw.get('Users').children] == ['wsaddontest_widow_g1']
              and gw.val('level', '1') == '1', gw and ttree.write(ttree.Node('', None, [gw]))[:300])
        # ---- the models
        arc = os.path.join(mod, 'GSF', 'wsaddontest.gsf')
        info = {m['name']: m for m in gsfedit.describe(arc)}
        check('archive: body, the moved turret\'s and the gunner\'s copies', {'wsaddontest_widow', 'wsaddontest_widow_t1', 'wsaddontest_widow_g1'} <= set(info), sorted(info))
        check('archive: the body has the new links', {'Ws01', 'Ws02', 'Ws03'} <= set(info['wsaddontest_widow']['links']), info['wsaddontest_widow']['links'])
        check('archive: the turret copy has the part\'s link', 'Ws01' in info['wsaddontest_widow_t1']['links'], info['wsaddontest_widow_t1']['links'])
        b0, b1 = gsfedit.describe(data.find_model('hu_rhino_ballista_buildup_top')[0]), info['wsaddontest_widow_g1']
        b0 = next(m for m in b0 if m['name'].lower() == 'hu_rhino_ballista_buildup_top')
        ext = lambda b: [b[3] - b[0], b[4] - b[1], b[5] - b[2]]     # noqa: E731
        ratio = [round(x / y, 2) for x, y in zip(ext(b1['bbox']), ext(b0['bbox'])) if y]
        check('archive: the gunner\'s turret 1.3 times as big', ratio and all(abs(x - 1.3) < 0.02 for x in ratio), ratio)
        # ---- the game reads it: installed, the scripts' reader of the remake
        g = fake_install(game, tmp)
        I.install(out, g, 'WsAddonTest', langs=False)
        from pwexport import modparts, gamedata as pg
        from pwexport.mods import ModInstall
        inst = ModInstall(g, 'WsAddonTest')
        tt2 = pg.techtree(inst)
        objs = {n: (tr, ty, nd) for tr, ty, n, nd in pg.objects(tt2)}
        tr, ty, nd = objs['wsaddontest_widow']
        e = modparts.normalize(modparts.derive_one(inst, tt2, pg.classes(inst), tr, ty, 'wsaddontest_widow', nd))
        kinds = [(x['kind'], x['gfx'], x['link'], x.get('weapon_class')) for x in e]
        check('remake: the main turret', ('turret', 'wsaddontest_widow_t1', 'Ws01', None) in kinds, kinds)
        check('remake: the gunner turret shoots by itself', ('turret', 'wsaddontest_widow_g1', 'Ws02', 'wsaddontest_widow_g1') in kinds, kinds)
        check('remake: the part on the turret', any(k[1] == 'seas_hq_machinegun_nest_top' and k[0] == 'buildup' for k in kinds)
              and next(x for x in e if x['gfx'] == 'seas_hq_machinegun_nest_top')['pi'] == next(x for x in e if x['gfx'] == 'wsaddontest_widow_t1')['i'], kinds)
        riders = [x for x in e if x['kind'] == 'rider']
        check('remake: the rider on the body, the gunner on the ballista', any(x['link'] == 'Ws03' and x['pi'] < 0 and x['gfx'] == 'hu_rider_b' for x in riders)
              and any(x['link'] == 'Dri1' and x['pi'] >= 0 for x in riders), [(x['gfx'], x['link'], x['pi'], x.get('anim')) for x in riders])
        check('remake: the template\'s turret is gone', not any(x['gfx'] == 'seas_wehrspinne_top' for x in e), kinds)
        if '--remake' in sys.argv:
            import json
            import subprocess
            rb = os.path.join(tmp, 'rb')
            subprocess.run([sys.executable, '-m', 'remake.pipeline', g, rb, 'rules', '--mod=WsAddonTest'], cwd=ROOT, check=True, capture_output=True)
            gd = json.load(open(os.path.join(rb, 'gamedata.json')))
            comp = gd['composites'].get('wsaddontest_widow') or []
            check('remake data: the gunner turret with its weapon class', any(x.get('weapon_class') == 'wsaddontest_widow_g1' for x in comp),
                  [(x['kind'], x['gfx'], x['link'], x.get('weapon_class')) for x in comp])
            check('remake data: the titan\'s ballistas too', sum(1 for x in gd['composites'].get('hu_triceratops', []) if x.get('weapon_class') == 'hu_titan_ballista') == 2)
            ttj = json.load(open(os.path.join(rb, 'techtree.json')))
            check('remake data: the gunner\'s weapon', 'wsaddontest_widow_g1' in ttj['StartTT']['Objects']['SEAS']['Weapons'])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print('%d failed' % len(FAIL))
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
