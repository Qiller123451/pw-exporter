"""Add-ons: the turrets, build-ups, gunners and riders a unit carries, mixed and placed in the Workshop.

How the game does it
--------------------
A unit's turret and rider are not part of its model: its script class puts them together when the unit appears
(OnInit). The Black widow's (Vehicle.usl CWehrspinne) makes a weapon build-up and links the object
"seas_wehrspinne_top" to the link "we" of the body; the rider is the tech tree's captainclass, seated where the class's
GetCaptainLink says (the top's "Dri1"). Extra gunners are more weapon build-ups, each with its turret, a captain on it
and a weapon class (Animal.usl CTitanTriceratops: the two ballistas at "con2" / "con3").

What the Workshop does
----------------------
An object's add-ons start as its template's (read from the template's script by pwexport/modparts.py). The modder
removes them, adds models of the game or of his own archives, gives each a role and puts it anywhere:

    main     the unit's own weapon turns it to aim and shoots from its "Proj" link (one; the template must fight and
             have no other kind of main build-up, e.g. no passenger platform)
    gunner   a turret with a gunner that shoots by itself with a weapon of its own (any number)
    part     carried along (armour, crates, flags, a second gun barrel that does not aim ...)

and swaps the rider (any captain class or character) and moves its seat. For the game, build.py then writes:

    a class for every add-on (Scripts/Server/classes/<mod>/<mod>_objects.txt: CTaskBuildUp for turrets, CProduct
    for the rest) - <object>_<add-on id>
    new links where a part sits off the existing ones: "Ws01", "Ws02" ... in the model that carries it (the object's
    own model, or a copy of the add-on's model in the mod's archive); a scaled add-on is such a copy too
    a script class CWs_<object> that inherits the template's class and, in OnInit, takes the template's build-ups
    down (TransportObj.DestroyBuildUp) and puts the add-ons up instead; GetCaptainLink for the rider's seat
    (Scripts/Server/classes/<mod>/<mod>.usl, listed in the mod's copy of Scripts/Server/Server.ini)
    a weapon per gunner (Objects/<tribe>/Weapons/<object>_<add-on id>, its user the gunner's weapon class), copied
    from a weapon of the game and changed by the modder's numbers
    the captainclass of the object (and its level bonuses) for another rider

The remake reads the same script (modparts.py follows DestroyBuildUp and the build-up calls), so it shows and fights
with what the game would.

Project data (project.py): object["addons"] = None (the template's, untouched) | [add-on]; object["rider"] = None
(the template's) | {"cls", "parent", "link", "pos", "rot", "anim", "attack_anim"}

    add-on = {"id": "a1", "origin": "template" | "new", "role": "main" | "gunner" | "part",
              "model": {"source": "game" | "upload", "name": <model>, "file": <files/...gsf>},
              "parent": "body" | <add-on id>, "link": <link of the parent's model> | "" (its origin),
              "pos": [x, y, z] (m), "rot": [x, y, z] (degrees, XYZ), "scale": 1.0,
              "gunner": {"link": "Dri1"} | None, "weapon": {"from": <weapon path> | None, "class": <template's class>,
              "damage", "range", "frequency"}}
"""
import re

from . import gsfxform

ROLES = ('main', 'gunner', 'part')
ID_RE = re.compile(r'^[a-z][a-z0-9]{0,7}$')


class AddonError(ValueError):
    pass


# ---------------------------------------------------------------------------------------- the template's setup
def class_chain(sc, cls):
    out, c = [], cls
    while c and c in sc and c not in out:
        out.append(c)
        c = sc[c].get('parent')
    if c and c not in out:
        out.append(c)
    return out


def template_setup(data, tid):
    """what the template's script puts on the unit: {script, chain, transport, weapon, captainclass, parts, seat,
    main_kind, extra, can_main, switch_mode}. parts: [{i, role, cls, gfx, link, parent (index | None), offset,
    gunner {link} | None, weapon_class, bu ('main' | 'extra' | None)}]"""
    from pwexport import modparts
    g = data.game
    sc = modparts.script_classes(g)
    t = data.template(tid)
    objs = data.tt_objects()
    tribe, cat, node = objs.get(tid, (t.get('tribe'), t.get('cat'), None))
    cls = t.get('script')
    chain = class_chain(sc, cls) if cls else []
    cc = node.val('captainclass') if node is not None else None
    has_cap = bool(cc and cc not in ('', '0'))
    out = {'template': tid, 'tribe': tribe, 'cat': cat, 'script': cls, 'chain': chain,
           'transport': 'CTransportObj' in chain, 'captainclass': cc if has_cap else None,
           'weapon': bool(template_weapons(data, tid, tribe)), 'parts': [], 'seat': None, 'main_kind': None, 'extra': 0}
    if not cls or cls not in sc:
        out['can_main'] = False
        return out
    run = modparts.Run(sc, cls, tid, has_captain=has_cap)
    run.seat0, run.types0 = None, set()
    try:
        run.init(building=cat == 'BLDG')
    except RecursionError:
        pass
    out['main_kind'] = run.main.kind if run.main else None
    out['extra'] = len(run.extra)
    classes = data.classes
    primary = {}
    for p in run.parts:
        if p['bu'] is not None and not p['obj'].captain and not p['guard']:
            primary.setdefault(id(p['bu']), p['obj'])
    idx = {}
    for p in run.parts:
        if p['guard']:
            continue                                         # (optional: an upgrade puts it on)
        o = p['obj']
        if o.captain:
            host = idx.get(id(p['parent'])) if p['parent'] is not None else None
            if o is run.captain:
                out['seat'] = {'link': p['link'], 'part': host, 'anim': run.cap_anim, 'attack_anim': run.cap_attack}
            elif host is not None:
                out['parts'][host]['gunner'] = {'link': p['link']}
            continue
        if id(o) in idx:                                     # linked again (AddObj, then with an offset)
            q = out['parts'][idx[id(o)]]
            q['link'] = p['link']
            q['offset'] = list(p['offset']) if p['offset'] else None
            continue
        ce = classes.get((o.cls or '').lower()) or {}
        gfx = o.gfx or ce.get('gfx') or o.cls
        bu = p['bu']
        role = 'part'
        if bu is not None and primary.get(id(bu)) is o:
            if bu is run.main and (bu.rotate or bu.kind.startswith('WEAPON')):
                role = 'main'
            elif bu in run.extra and bu.weapon:
                role = 'gunner'
        idx[id(o)] = len(out['parts'])
        out['parts'].append({'i': len(out['parts']), 'role': role, 'cls': o.cls, 'gfx': gfx, 'link': p['link'],
                             'parent': idx.get(id(p['parent'])) if p['parent'] is not None else None,
                             'offset': list(p['offset']) if p['offset'] else None, 'gunner': None,
                             'weapon_class': bu.weapon if bu is not None and role == 'gunner' else None,
                             'bu': 'main' if bu is not None and bu is run.main else 'extra' if bu in run.extra else None,
                             'rotate': bool(bu and bu.rotate)})
    if has_cap and out['seat'] is None:
        cl = run.captain_link()
        if cl:
            link, on_bu, anim, attack = cl
            main = next((q['i'] for q in out['parts'] if q['bu'] == 'main'), None)
            out['seat'] = {'link': link, 'part': main if on_bu else None, 'anim': anim, 'attack_anim': attack}
        else:
            out['seat'] = {'link': None, 'part': None, 'anim': None, 'attack_anim': None, 'hidden': True}
    body = '\n'.join(sc[c]['procs'].get('OnInit', ('', ''))[1] for c in chain if c in sc)
    out['switch_mode'] = 'SetCanSwitchAttackMode(true)' in body.replace(' ', '')
    out['can_main'] = bool(out['transport'] and out['weapon'] and (run.main is None or run.main.kind.startswith('WEAPON')))
    return out


def template_weapons(data, tid, tribe=None):
    """the tech tree weapons whose users list the object: [(path, node)]"""
    tribe = tribe or data.tt_objects().get(tid, (None,))[0]
    ws = data.tt.get('Root/StartTT/Objects/%s/Weapons' % tribe) if tribe else None
    out = []
    for w in ws.blocks() if ws else []:
        u = w.get('Users')
        if u and any(c.value == tid for c in u.children):
            out.append(('/Objects/%s/Weapons/%s' % (tribe, w.key), w))
    return out


def weapons_of_class(data, user):
    """weapons whose users list `user` (a unit, or a gunner's weapon class such as hu_titan_ballista)"""
    out = []
    objs = data.tt.get('Root/StartTT/Objects')
    for t in objs.blocks():
        ws = t.get('Weapons')
        for w in ws.blocks() if ws else []:
            u = w.get('Users')
            if u and any(c.value == user for c in u.children):
                out.append(('/Objects/%s/Weapons/%s' % (t.key, w.key), w))
    return out


def default_gunner_weapon(data, tid, tribe, wclass=None):
    """the weapon a gunner copies when the modder picked none: the template gunner's (its weapon class), the
    template's own ranged weapon, else the first ranged weapon of its tribe"""
    if wclass:
        hits = weapons_of_class(data, wclass)
        if hits:
            return hits[0][0]
    for path, w in template_weapons(data, tid, tribe):
        pr = w.get('Projectile')
        if pr is not None and pr.children:
            return path
    return next((x['path'] for x in all_weapons(data) if x['tribe'] == tribe), None)


def all_weapons(data):
    """every ranged weapon of the configuration (a gunner's weapon is copied from one): [{path, tribe, key, users,
    damage, range, frequency, projectile, level}]"""
    out = []
    objs = data.tt.get('Root/StartTT/Objects')
    for t in objs.blocks():
        ws = t.get('Weapons')
        for w in ws.blocks() if ws else []:
            pr = w.get('Projectile')
            proj = pr.children[0].value if pr is not None and pr.children else None
            try:
                rng = float(w.val('range') or 0)
            except ValueError:
                rng = 0
            if not proj or rng < 4:
                continue
            u = w.get('Users')
            out.append({'path': '/Objects/%s/Weapons/%s' % (t.key, w.key), 'tribe': t.key, 'key': w.key,
                        'users': [c.value for c in u.children if c.value] if u else [],
                        'damage': w.val('damage'), 'range': w.val('range'), 'frequency': w.val('frequency'),
                        'projectile': proj, 'level': w.val('level')})
    return out


def riders(data):
    """who can ride or man a turret: the captain classes of the tech tree, then the characters [{cls, gfx, tribe}]"""
    cl = data.classes
    caps, seen = [], set()
    for n, p in data.tt.find_all(lambda n, p: (n.key or '').lower() == 'captainclass' and p.startswith('Root/StartTT/Objects')):
        v = n.value
        if v and v != '0' and v.lower() not in seen and v.lower() in cl:
            seen.add(v.lower())
            caps.append({'cls': v, 'gfx': cl[v.lower()]['gfx'], 'tribe': p.split('/')[3], 'captain': True})
    for name, (tribe, cat, node) in data.tt_objects().items():
        if cat == 'CHTR' and name.lower() not in seen and name.lower() in cl:
            seen.add(name.lower())
            caps.append({'cls': name, 'gfx': cl[name.lower()]['gfx'], 'tribe': tribe, 'captain': False})
    caps.sort(key=lambda r: (not r['captain'], r['tribe'], r['cls']))
    return caps


# ---------------------------------------------------------------------------------------- defaults / checks
def default_addons(setup):
    """the template's add-ons as an editable list"""
    out = []
    for p in setup['parts']:
        a = {'id': 't%d' % (p['i'] + 1), 'origin': 'template', 'role': p['role'],
             'model': {'source': 'game', 'name': p['gfx']},
             'parent': 'body' if p['parent'] is None else 't%d' % (p['parent'] + 1), 'link': p['link'],
             'pos': [float(x) for x in (p['offset'] or (0, 0, 0))], 'rot': [0.0, 0.0, 0.0], 'scale': 1.0,
             'gunner': dict(p['gunner']) if p['gunner'] else None, 'weapon': None, 'cls': p['cls']}
        if p['role'] == 'gunner':
            a['weapon'] = {'class': p['weapon_class']}
            if not a['gunner']:
                a['gunner'] = None
        out.append(a)
    return out


def default_rider(setup):
    s = setup.get('seat')
    if not setup.get('captainclass') or not s:
        return None
    return {'cls': setup['captainclass'], 'parent': 'body' if s.get('part') is None else 't%d' % (s['part'] + 1),
            'link': s.get('link') or '', 'pos': [0.0, 0.0, 0.0], 'rot': [0.0, 0.0, 0.0],
            'anim': s.get('anim') or '', 'attack_anim': s.get('attack_anim') or '', 'hidden': bool(s.get('hidden'))}


def _zero(v):
    return not v or all(abs(float(x)) < 1e-6 for x in v)


def _scale(a):
    try:
        s = float(a.get('scale') or 1.0)
    except (TypeError, ValueError):
        s = 1.0
    return s


def check(o, setup):
    """problems of an object's add-ons: [text]"""
    out = []
    adds = o.get('addons')
    if adds is None and not o.get('rider'):
        return out
    if adds is not None and not setup['transport']:
        out.append('%s: its template %s (%s) cannot carry add-ons in the game - only animals, vehicles and ships can'
                   % (o['id'], o['template'], setup['script']))
        return out
    ids = set()
    for a in adds or []:
        tag = '%s, add-on %s' % (o['id'], a.get('id'))
        if not ID_RE.match(a.get('id') or ''):
            out.append('%s: an add-on id has 1-8 lower case letters or digits' % tag)
        if a['id'] in ids:
            out.append('%s: two add-ons have this id' % tag)
        ids.add(a['id'])
        if a.get('role') not in ROLES:
            out.append('%s: unknown role %s' % (tag, a.get('role')))
        m = a.get('model') or {}
        if not m.get('name') or (m.get('source') == 'upload' and not m.get('file')):
            out.append('%s: no model' % tag)
        if not (0.05 <= _scale(a) <= 20):
            out.append('%s: the scale must be between 0.05 and 20' % tag)
    for a in adds or []:
        if a.get('parent') not in ('body', None) and a['parent'] not in ids:
            out.append('%s, add-on %s: it hangs on %s, which is not there' % (o['id'], a['id'], a['parent']))
    mains = [a for a in adds or [] if a.get('role') == 'main']
    if len(mains) > 1:
        out.append('%s: only one add-on can be the main turret' % o['id'])
    if mains and not setup.get('can_main'):
        out.append('%s: the template %s cannot aim a main turret (%s) - make it a gunner' % (
            o['id'], o['template'], 'it does not fight' if not setup.get('weapon') else 'its main build-up is a %s' % (setup.get('main_kind') or '?').lower()))
    # no cycles
    by = {a['id']: a for a in adds or []}
    for a in adds or []:
        seen, p = set(), a
        while p and p.get('parent') not in ('body', None):
            if p['id'] in seen:
                out.append('%s, add-on %s: it hangs on itself' % (o['id'], a['id']))
                break
            seen.add(p['id'])
            p = by.get(p['parent'])
    r = o.get('rider')
    if r and r.get('parent') not in ('body', None, ''):
        main = mains[0]['id'] if mains else None
        if r['parent'] != main:
            out.append('%s: the rider sits on the body or on the main turret (the game\'s GetCaptainLink knows no other place)' % o['id'])
    return out


# ---------------------------------------------------------------------------------------- the build
class Plan:
    """what the build writes for one object's add-ons (build.py asks for it)"""

    def __init__(self, data, project, o, setup, link_names):
        self.data, self.p, self.o, self.setup = data, project, o, setup
        self.links_of = link_names         # fn(model source dict) -> [link names] of that model
        self.oid = o['id']
        self.tribe = setup['tribe']
        self.adds = o.get('addons')
        self.rider = o.get('rider')
        self.classes = []                  # (class name, script class, gfx)
        self.copies = []                   # (addon, model name in the mod) - models copied into the mod's archive
        self.body_links = []               # (name, at, 4x4)
        self.part_links = {}               # addon id -> [(name, at, 4x4)]
        self.weapons = []                  # {key, user, from, values}
        self.captainclass = None
        self.script = None
        self.script_class = None
        self.warnings = []
        self._make()

    # -- helpers
    def cls_of(self, a):
        return '%s_%s' % (self.oid, a['id'])

    def _offset(self, x):
        return gsfxform.euler_matrix(x.get('pos') or (0, 0, 0), x.get('rot') or (0, 0, 0))

    def _place(self, x, carrier):
        """the link `x` (an add-on or the rider) is linked to on its carrier ('body' or an add-on id): an existing
        link when it sits right on it, else a new one"""
        link = x.get('link') or ''
        if link and _zero(x.get('pos')) and _zero(x.get('rot')):
            return link
        if carrier == 'body':
            have = self.links_of(None) + [n for n, _, _ in self.body_links]
            name = _free(have)
            self.body_links.append((name, link or None, self._offset(x)))
        else:
            ca = self.by[carrier]
            have = self.links_of(ca['model']) + [n for n, _, _ in self.part_links.get(carrier, [])]
            name = _free(have)
            self.part_links.setdefault(carrier, []).append((name, link or None, self._offset(x)))
            self.need_copy.add(carrier)
        return name

    def _make(self):
        o, setup = self.o, self.setup
        r = self.rider
        if r and r.get('cls') and r['cls'] != setup.get('captainclass'):
            self.captainclass = r['cls']
        if self.adds is None and not self._rider_moved():
            return
        if self.adds is not None and not setup['transport']:
            raise AddonError('%s: the template cannot carry add-ons' % self.oid)
        adds = self.adds if self.adds is not None else default_addons(setup)
        self.by = {a['id']: a for a in adds}
        self.need_copy = {a['id'] for a in adds if (a.get('model') or {}).get('source') == 'upload' or abs(_scale(a) - 1) > 1e-6}
        order = _parent_first(adds)
        self.at = {}
        for a in order:
            self.at[a['id']] = self._place(a, a.get('parent') or 'body')
        rider_at = None
        if r and not r.get('hidden'):
            carrier = r.get('parent') or 'body'
            rider_at = self._place(r, carrier) if (r.get('link') or not _zero(r.get('pos'))) else None
        for a in order:
            m = a.get('model') or {}
            if a['id'] in self.need_copy:
                gfx = self.cls_of(a)
                self.copies.append((a, gfx))
            else:
                gfx = m.get('name')
            self.classes.append((self.cls_of(a), 'CTaskBuildUp' if a['role'] in ('main', 'gunner') else 'CProduct', gfx))
            if a['role'] == 'gunner':
                w = a.get('weapon') or {}
                if w.get('from') or not w.get('class') or any(w.get(k) not in (None, '') for k in ('damage', 'range', 'frequency')):
                    src = w.get('from') or default_gunner_weapon(self.data, o['template'], self.tribe, w.get('class'))
                    if not src:
                        raise AddonError('%s, add-on %s: no weapon to copy - pick one ("Numbers & fighting")' % (self.oid, a['id']))
                    self.weapons.append({'key': self.cls_of(a), 'user': self.cls_of(a), 'from': src,
                                         'values': {k: w.get(k) for k in ('damage', 'range', 'frequency') if w.get(k) not in (None, '')}})
                    a['_wclass'] = self.cls_of(a)
                else:
                    a['_wclass'] = w.get('class')
        self.script_class = 'CWs_%s' % self.oid
        self.script = self._script(order, rider_at)

    def _rider_moved(self):
        r, s = self.rider, self.setup.get('seat') or {}
        if not r:
            return False
        if bool(r.get('hidden')) != bool(s.get('hidden')):
            return True
        if r.get('hidden'):
            return False
        sp = 'body' if s.get('part') is None else 't%d' % (s['part'] + 1)
        return ((r.get('parent') or 'body') != sp or (r.get('link') or '') != (s.get('link') or '') or not _zero(r.get('pos'))
                or not _zero(r.get('rot')) or (r.get('anim') or '') != (s.get('anim') or '')
                or (r.get('attack_anim') or '') != (s.get('attack_anim') or ''))

    # -- the script
    def _script(self, order, rider_at):
        setup, o = self.setup, self.o
        L = ['// ParaWorld Workshop, mod %s: the add-ons of %s (template %s, class %s) - docs/WORKSHOP.md "Add-ons"'
             % (self.p.id, self.oid, o['template'], setup['script']),
             'class %s inherit %s' % (self.script_class, setup['script']), '',
             '\texport constructor()', '\tendconstructor;', '']
        if self.adds is not None:
            L += ['\texport proc void OnInit(bool p_bLoad)', '\t\tsuper.OnInit(p_bLoad);', '\t\tif(!p_bLoad)then',
                  '\t\t\tWsBuildAddOns();', '\t\tendif;', '\tendproc;', '',
                  '\t// the template\'s build-ups go, the add-ons the Workshop put together come up instead',
                  '\tproc void WsBuildAddOns()']
            if setup.get('main_kind') or setup.get('extra'):
                L.append('\t\tDestroyBuildUp();')
            main = [a for a in order if a['role'] == 'main']
            parts = [a for a in order if a['role'] == 'part']
            gunners = [a for a in order if a['role'] == 'gunner']
            var = {a['id']: 'px%s' % a['id'].capitalize() for a in order}

            def create(a):
                return '\t\tvar ^CGameObj %s=CSrvWrap.GetObjMgr()^.CreateObj("%s", GetOwner());' % (var[a['id']], self.cls_of(a))

            def link(bu, a):
                h = '%s^.GetHandle()' % var[a['id']]
                par = a.get('parent') or 'body'
                if par == 'body':
                    return '\t\t%s^.AddObj(%s, "%s");' % (bu, h, self.at[a['id']])
                return '\t\t%s^.AddObjFlex(%s, "%s", -1.0, %s^.GetHandle());' % (bu, h, self.at[a['id']], var[par])
            # the main build-up: the main turret first (its primary object: it turns and shoots), then the parts
            # (on a plain build-up when there is no turret)
            emitted = set()
            if main or parts:
                L.append('\t\tSetBuildUp(CBuildUpBase.TYPE_%s);' % ('WEAPON' if main else 'FAKE'))
            pending = list(main) + [a for a in order if a['role'] != 'main']
            k = 0
            for a in pending:
                if a['role'] == 'gunner':
                    w = 'pxW%d' % k
                    L += ['\t\tAddAdditionalBuildUp(CBuildUpBase.TYPE_WEAPON);',
                          '\t\tvar ^CBuildUpWeapon %s=cast<CBuildUpWeapon>(GetAdditionalBuildUp(%d));' % (w, k),
                          create(a), link(w, a)]
                    g = a.get('gunner') or {}
                    if g.get('link'):
                        c = 'pxC%d' % k
                        L += ['\t\tvar ^CCaptain %s=cast<CCaptain>(CSrvWrap.GetObjMgr()^.CreateObj("universal_captain", GetOwner()));' % c,
                              '\t\t%s^.Init(GetHandle());' % c,
                              '\t\t%s^.AddObjCaptain(%s^.GetHandle(), "%s", -1.0, %s^.GetHandle());' % (w, c, g['link'], var[a['id']])]
                    if a.get('_wclass'):
                        L.append('\t\t%s^.SetWeaponClass("%s");' % (w, a['_wclass']))
                    L += ['\t\t%s^.SetCanRotate(true);' % w, '\t\t%s^.SetAdditionalWeapon(true);' % w]
                    k += 1
                else:
                    L += [create(a), link('GetBuildUp()', a)]
                    if a['role'] == 'main':
                        L.append('\t\tcast<CBuildUpWeapon>(GetBuildUp())^.SetCanRotate(true);')
                        if setup.get('switch_mode'):
                            L.append('\t\tcast<CBuildUpWeapon>(GetBuildUp())^.SetCanSwitchAttackMode(true);')
                emitted.add(a['id'])
            L += ['\t\tLinkCaptainObj();', '\tendproc;', '']
        r = self.rider
        if r and (self.adds is not None or self._rider_moved()):
            L += ['\texport proc bool GetCaptainLink(ref CFourCC po_rxLink, ref bool po_rbIsBuildUpLink)']
            if r.get('hidden') or not rider_at:
                L += ['\t\treturn false;']
            else:
                on_bu = (r.get('parent') or 'body') != 'body'
                L += ['\t\tpo_rxLink="%s";' % rider_at, '\t\tpo_rbIsBuildUpLink=%s;' % ('true' if on_bu else 'false')]
                if r.get('anim'):
                    L.append('\t\tSetCaptainAnim("%s");' % r['anim'])
                if r.get('attack_anim'):
                    L.append('\t\tSetCaptainAttackAnim("%s");' % r['attack_anim'])
                L.append('\t\treturn true;')
            L += ['\tendproc;', '']
        L += ['endclass;', '']
        return '\r\n'.join(L)

    # -- the models
    def body_edit(self):
        if not self.body_links:
            return None
        links = list(self.body_links)

        def edit(m):
            for name, at, M in links:
                gsfxform.add_link(m, name, at, M)
        return edit

    def copy_edit(self, a):
        s = _scale(a)
        links = list(self.part_links.get(a['id'], []))

        def edit(m):
            gsfxform.scale_model(m, s)
            for name, at, M in links:
                gsfxform.add_link(m, name, at, M)
        return edit


def _free(have):
    for k in range(1, 100):
        n = 'Ws%02d' % k
        if n not in have:
            return n
    raise AddonError('no free link name')


def _parent_first(adds):
    by = {a['id']: a for a in adds}
    out, done = [], set()

    def visit(a, depth=0):
        if a['id'] in done or depth > 32:
            return
        par = a.get('parent')
        if par and par != 'body' and par in by:
            visit(by[par], depth + 1)
        done.add(a['id'])
        out.append(a)
    for a in adds:
        visit(a)
    return out


# ---------------------------------------------------------------------------------------- the 3D view
def view_specs(o, setup, url_of, rider_url=None):
    """the parts the Workshop's 3D view shows: [{key, url, parent (index), link, offset, rot, scale, anim, kind}]
    - part 0 is the body (the caller's)"""
    adds = o.get('addons')
    adds = default_addons(setup) if adds is None else adds
    order = _parent_first(adds)
    index = {'body': 0}
    specs = []
    for a in order:
        u = url_of(a.get('model') or {})
        if not u:
            continue
        par = a.get('parent') or 'body'
        if par not in index:
            continue
        specs.append({'key': a['id'], 'url': u, 'parent': index[par], 'link': a.get('link') or '',
                      'offset': [float(x) for x in a.get('pos') or (0, 0, 0)], 'rot': [float(x) for x in a.get('rot') or (0, 0, 0)],
                      'scale': _scale(a), 'kind': a.get('role')})
        index[a['id']] = len(specs)
        g = a.get('gunner') or {}
        if g.get('link') and rider_url:
            ru = rider_url()
            if ru:
                specs.append({'key': a['id'] + ':gunner', 'url': ru[0], 'parent': index[a['id']], 'link': g['link'],
                              'anim': ru[1], 'kind': 'gunner'})
    r = o.get('rider') or default_rider(setup)
    if r and not r.get('hidden') and rider_url:
        ru = rider_url(r.get('cls'))
        par = r.get('parent') or 'body'
        if ru and par in index:
            specs.append({'key': 'rider', 'url': ru[0], 'parent': index[par], 'link': r.get('link') or '',
                          'offset': [float(x) for x in r.get('pos') or (0, 0, 0)], 'rot': [float(x) for x in r.get('rot') or (0, 0, 0)],
                          'anim': r.get('anim') or ru[1], 'kind': 'rider'})
    return specs
