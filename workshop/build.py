"""Build a Workshop project into a mod folder the game and the remake load:

    <out>/Data/Info/<ModId>.info                          the mod: id, requires (the configuration it builds on) ...
    <out>/Data/<ModId>/GSF/<modid>.gsf                    the models of the mod's objects
    <out>/Data/<ModId>/GSF/_gsfs.txt                      the archive list (the configuration's + the mod's)
    <out>/Data/<ModId>/Scripts/Server/settings/Techtree/_TechTree.ttree
                                                          the configuration's tech tree + the new objects' entries
    <out>/Data/<ModId>/Scripts/Server/classes/classes.txt the class lists (the configuration's + the mod's file)
    <out>/Data/<ModId>/Scripts/Server/classes/<modid>.txt, <modid>/<modid>_objects.txt
    <out>/Data/<ModId>/UI/All_def.txt (+ UI/hud/cards/cards_<modid>.tga)   the icons
    <out>/Data/<ModId>/Locale/<lang>/Texts/Help/<file>.seml               the encyclopedia: names and tooltips
    <out>/Data/<ModId>/Texture/...                        textures the models use that the game does not have
    <out>/Data/<ModId>/Scripts/Server/classes/<modid>/<modid>.usl + Scripts/Server/Server.ini
                                                          the script classes of objects whose add-ons or rider the
                                                          modder changed (addons.py), and the script list with them

The game replaces files, it does not merge them: the tech tree, the class list, the archive list, the icon list and
a help file the mod changes are whole copies of the configuration's with the mod's entries added (as MIRAGE ships
its own). docs/WORKSHOP.md.

    result = build(project, game_root, out)   -> {'files': [...], 'warnings': [...], 'objects': [...]}
"""
import os
import re

from . import ttree, gsfedit, dds, addons
from .gamedata import GameData, TRIBES, COMPANIONS
from .project import Project

UI_PLACES = 12          # command buttons on one page of a building's production menu (3 rows of 4)


class BuildError(Exception):
    pass


def _obj_path(tribe, cat, name):
    return '/Objects/%s/%s/%s' % (tribe, cat, name)


def _num(v):
    """the tech tree writes numbers as '200.000000' or '3'; keep integers integers"""
    f = float(v)
    return str(int(f)) if f == int(f) and abs(f) < 1e9 else '%.6f' % f


class Builder:
    def __init__(self, project, game_root, out):
        self.p = project if isinstance(project, Project) else Project(project)
        self.data = GameData(game_root, self.p.base)
        self.out = out
        self.mod = self.p.id
        self.low = self.p.id.lower()
        self.root = os.path.join(out, 'Data', self.mod)
        self.files, self.warnings, self.done = [], [], []

    def warn(self, msg):
        self.warnings.append(msg)

    def path(self, rel):
        p = os.path.join(self.root, *rel.split('/'))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        self.files.append(p)
        return p

    # ------------------------------------------------------------------ the whole build
    def run(self):
        if not self.p.objects:
            raise BuildError('the project has no objects yet')
        tt = ttree.load(self.data.techtree_path())            # a fresh copy: it is changed
        self.tt = tt
        picks, classes, help_items, icons = [], [], [], []
        self.plans, scripts = {}, []
        for o in self.p.objects:
            t = self.data.template(o['template'])
            if t['kind'] != o['kind']:
                raise BuildError('%s: the template %s is a %s, not a %s' % (o['id'], t['id'], t['kind'], o['kind']))
            plan = self.plan(o)
            if o['kind'] != 'decoration':
                self.tech_tree(o, t)
            classes.extend(self.class_entries(o, t))
            picks.append(self.pick(o, t, plan.body_edit() if plan else None))
            if plan:
                for a, gfx in plan.copies:
                    picks.append(self.addon_pick(a, gfx, plan.copy_edit(a)))
                if plan.script:
                    scripts.append(plan.script)
            if o['kind'] != 'decoration':
                help_items.append((o, t))
                icons.append((o, t))
            self.done.append(o['id'])
        self.write_archive(picks)
        if any(o['kind'] != 'decoration' for o in self.p.objects):
            ttree.save(tt, self.path('Scripts/Server/settings/Techtree/_TechTree.ttree'))
        self.write_classes(classes)
        if scripts:
            self.write_scripts(scripts)
        self.write_help(help_items)
        self.write_icons(icons)
        self.write_info()
        return {'files': [os.path.relpath(f, self.out).replace(os.sep, '/') for f in self.files], 'warnings': self.warnings,
                'objects': self.done, 'mod': self.mod, 'folder': self.root}

    # ------------------------------------------------------------------ add-ons (addons.py)
    def plan(self, o):
        """the add-ons of an object (None when the modder left the template's and its rider alone)"""
        if o.get('addons') is None and not o.get('rider'):
            return None
        setup = addons.template_setup(self.data, o['template'])
        problems = addons.check(o, setup)
        if problems:
            raise BuildError('\n'.join(problems))
        try:
            plan = addons.Plan(self.data, self.p, o, setup, lambda m, o=o: self.model_links(o, m))
        except (addons.AddonError, KeyError) as e:
            raise BuildError(str(e).strip("'"))
        self.plans[o['id']] = plan
        self.warnings.extend(plan.warnings)
        return plan

    def model_source(self, m, o=None):
        """(archive path, model name) of a model of the project (an object's or an add-on's)"""
        m = m or {}
        if m.get('source') == 'upload':
            return self.p.file(m.get('file')), m.get('name')
        name = m.get('name') or (self.data.template(o['template'])['gfx'] if o else None)
        path, name = self.data.find_model(name or '')
        if not path:
            raise BuildError('the game has no model %s' % m.get('name'))
        return path, name

    def model_links(self, o, m):
        """the link names of a model (None: the object's own)"""
        path, name = self.model_source(o.get('model') if m is None else m, o if m is None else None)
        cache = self.__dict__.setdefault('_links', {})
        if path not in cache:
            cache[path] = {x['name'].lower(): x['links'] for x in gsfedit.describe(path)}
        return list(cache[path].get((name or '').lower(), []))

    def addon_pick(self, a, gfx, edit):
        path, name = self.model_source(a.get('model'))
        if not path or not os.path.isfile(path):
            raise BuildError('add-on %s: the model file is missing' % a.get('id'))
        return gsfedit.Pick(path, name, gfx, {}, edit=edit)

    def addon_tech_tree(self, o, node, own_filter):
        plan = self.plans.get(o['id'])
        if not plan:
            return
        T, tribe = self.tt, plan.tribe
        if plan.captainclass:
            node.set('captainclass', plan.captainclass)
            for n, _ in (own_filter.find_all(lambda n, p: n.key == 'captainclass' and n.value is not None) if own_filter else []):
                n.value = plan.captainclass
        weapons = T.get('Root/StartTT/Objects/%s/Weapons' % tribe)
        for w in plan.weapons:
            segs = w['from'].strip('/').split('/')          # Objects/<tribe>/Weapons/<key>
            src = T.get('Root/StartTT/' + '/'.join(segs))
            if src is None:
                raise BuildError('%s: the weapon %s is not in the tech tree' % (o['id'], w['from']))
            nw = src.clone()
            nw.key = w['key']
            if weapons.get(nw.key):
                weapons.remove(weapons.get(nw.key))
            if nw.get('Users') is not None:
                nw.get('Users').children = [ttree.Node('0', w['user'])]
            else:
                nw.add(ttree.Node('Users', None, [ttree.Node('0', w['user'])]))
            if nw.get('level') is not None:
                nw.set('level', '1')                         # (a gunner shoots from the unit's first level)
            for k, v in w['values'].items():
                nw.set(k, _num(v))
            weapons.add(nw)

    # ------------------------------------------------------------------ the tech tree
    def tech_tree(self, o, t):
        T = self.tt
        tribe, cat, tid, nid = t['tribe'], t['cat'], t['id'], o['id']
        objs = T.get('Root/StartTT/Objects/%s/%s' % (tribe, cat))
        src = objs.get(tid)
        if objs.get(nid):
            raise BuildError('%s already exists in the tech tree' % nid)
        node = src.clone()
        node.key = nid
        node.set('gfx', nid)
        node.set('description', '_' + nid.lower())
        for k, v in (o.get('stats') or {}).items():
            if v is None or v == '':
                continue
            if node.get(k) is None and k not in ('hitpoints', 'FOW', 'defaultspeed', 'maxspeed', 'scalps'):
                continue
            node.set(k, _num(v))
        objs.add(node, after=src)
        # the weapons the template carries (one per level a..e): copies that only the new object uses
        weapons = T.get('Root/StartTT/Objects/%s/Weapons' % tribe)
        wset = o.get('weapon') or {}
        base_dmg = None
        wren = {}                                          # template weapon -> the new object's copy
        for w in list(weapons.blocks()) if weapons else []:
            users = w.get('Users')
            if not users or not any(u.value == tid for u in users.children):
                continue
            nw = w.clone()
            nw.key = '%s_%s' % (nid, w.key)
            wren[w.key] = nw.key
            nw.get('Users').children = [ttree.Node('0', nid)]
            if wset:
                dmg = float(w.val('damage', '0') or 0)
                if base_dmg is None:
                    base_dmg = dmg or 1.0
                if wset.get('damage') not in (None, ''):
                    nw.set('damage', _num(float(wset['damage']) * (dmg / base_dmg if base_dmg else 1)))
                for k in ('range', 'frequency'):
                    if wset.get(k) not in (None, ''):
                        nw.set(k, _num(wset[k]))
            weapons.add(nw, after=w)
        # the level bonuses and the template's own upgrades (Filters/<tribe>/Upgrades/<name>)
        ups = T.get('Root/Filters/%s/Upgrades' % tribe)
        if ups and ups.get(tid):
            nu = ups.get(tid).clone()
            nu.key = nid
            ttree.rename_refs(nu, tid, nid)
            # every level shows the new model (the template's levels may have models of their own: hu_warrior_s2 ..)
            levels = (o.get('model') or {}).get('levels') or {}
            for lv in nu.blocks():
                m = re.match(r'Lvl(\d)_Bonus$', lv.key)
                if levels == 'template':                 # the template's own models for the higher levels
                    break
                gfx = levels.get(m.group(1), nid) if m else nid
                for mod in (lv.get('Modificators').blocks() if lv.get('Modificators') else []):
                    if (mod.val('path') or '').endswith('/gfx'):
                        mod.set('value', gfx)
                if lv.get('LevelBonusData'):
                    if lv.get('LevelBonusData/gfx') is not None:
                        lv.set('LevelBonusData/gfx', gfx)
                    if lv.get('LevelBonusData/description') is not None:
                        lv.set('LevelBonusData/description', '_' + nid.lower())
            # the hit points of the higher levels grow with the new level 1's
            hp, hp0 = (o.get('stats') or {}).get('hitpoints'), src.val('hitpoints')
            if hp not in (None, '') and hp0 and float(hp0) > 0:
                k = float(hp) / float(hp0)
                for n, p in nu.find_all(lambda n, p: n.value is not None and (
                        (n.key == 'hitpoints' and 'LevelBonusData' in p) or (n.key == 'value' and p.endswith('_hitpoints/value')))):
                    n.value = _num(float(n.value) * k)
            ups.add(nu, after=ups.get(tid))
        self.addon_tech_tree(o, node, ups.get(nid) if ups else None)
        # what the filters change on the template and its weapons (level bonuses and defensive mode in its own filter,
        # the smithy's weapon and armour upgrades ...) changes the new object and its weapon copies too
        ren = dict(wren, **{tid: nid})
        own = ups.get(nid) if ups else None
        if own is not None:
            for a, b in wren.items():
                ttree.rename_refs(own, a, b)
        filters = T.get('Root/Filters')
        todo = []
        for n, p in filters.find_all(lambda n, p: n.key == 'path' and n.value is not None and n.value.startswith('/Objects/')):
            segs = n.value.split('/')
            if len(segs) > 4 and segs[4] in ren and (segs[3] == 'Weapons' or segs[4] == tid):
                todo.append(p)
        for p in todo:
            mod_path = 'Root/Filters/' + '/'.join(p.split('/')[:-1])
            mod = T.get(mod_path)
            par = T.get('/'.join(mod_path.split('/')[:-1]))
            # (the template's own filter and its copy: the copy has been renamed above)
            if mod is None or par is None or mod_path.startswith(('Root/Filters/%s/Upgrades/%s/' % (tribe, nid), 'Root/Filters/%s/Upgrades/%s/' % (tribe, tid))):
                continue
            c = mod.clone()
            c.key = '%s_%s' % (mod.key, nid)
            if par.get(c.key) is not None:
                continue
            segs = c.val('path').split('/')
            segs[4] = ren[segs[4]]
            c.set('path', '/'.join(segs))
            par.add(c, after=mod)
        # the build actions that make the template
        old_path, new_path = _obj_path(tribe, cat, tid), _obj_path(tribe, cat, nid)
        made, places = 0, {}
        for a_tribe, a_cat, a in self.data.build_actions().get(tid, []) if o['kind'] in ('unit', 'building') else []:
            parent = T.get('Root/StartTT/Actions/%s/Build/%s' % (a_tribe, a_cat))
            src_a = parent.get(a.key) if parent else None
            if src_a is None:
                continue
            na = src_a.clone()
            na.key = (a.key.replace(tid, nid) if tid in a.key else '%s_%d' % (nid, made + 1))
            if parent.get(na.key):
                na.key = '%s_%d' % (na.key, made + 1)
            for r in na.get('results').children:
                if r.value == old_path:
                    r.value = new_path
            for loc in (na.get('locations').children if na.get('locations') else []):
                if o.get('producer') and loc.value and loc.value.split('/')[-1] != o['producer']:
                    loc.value = '/'.join(loc.value.split('/')[:-1] + [o['producer']])
                loc.set('description', '_' + nid.lower())
                loc.set('iconpath', nid.lower())
                if loc.get('uiposition'):
                    # one button place per producer, as the template's actions share one (its levels are the
                    # button's menu: menupos 0, 1, 2)
                    u = loc.get('uiposition')
                    key = (loc.value, u.val('cat'), u.val('subcat'))
                    if key not in places:
                        places[key] = self.free_place(loc)
                    if places[key]:
                        u.set('page', places[key][0])
                        u.set('place', places[key][1])
            cost = o.get('cost') or {}
            for r_ in ('food', 'wood', 'stone'):
                if cost.get(r_) not in (None, ''):
                    na.set('conditions/rescosts/' + r_, _num(cost[r_]))
            if o.get('duration') not in (None, ''):
                na.set('duration', _num(o['duration']))
            parent.add(na, after=src_a)
            made += 1
        if o['kind'] in ('unit', 'building') and not made:
            self.warn('%s: the template %s has no build action - nothing makes the new object' % (nid, tid))
        # lists the template is a member of: moves offered to it, inventions that apply to it ...
        for n, p in T.find_all(lambda n, p: n.value == old_path and n.key.isdigit()):
            par = T.get('/'.join(p.split('/')[:-1]))
            if par is None or par.key in ('results',) or par.get(n.key) is not n:
                continue
            if any(c.value == new_path for c in par.children):
                continue
            c = n.clone()
            c.key = str(par.next_index())
            c.value = new_path
            par.add(c)

    def free_place(self, loc):
        """(page, place) of a button on the producer's menu that no other action there uses (the template's page
        first, then the next ones)"""
        at = loc.value
        u = loc.get('uiposition')
        cat, sub = u.val('cat'), u.val('subcat')
        used = set()
        for n, _ in self.tt.find_all(lambda n, p: n.value == at and n.children is not None and n.get('uiposition') is not None):
            if n is loc:
                continue
            x = n.get('uiposition')
            if x.val('cat') == cat and x.val('subcat') == sub:
                used.add((x.val('page', '0'), x.val('place', '0')))
        page = int(u.val('page', '0') or 0)
        for pg in range(page, page + 8):
            for pl in range(UI_PLACES):
                if (str(pg), str(pl)) not in used:
                    return str(pg), str(pl)
        return None

    # ------------------------------------------------------------------ classes
    def class_entries(self, o, t):
        cl = self.data.classes
        src = cl.get(t['id'].lower())
        if not src:
            raise BuildError('%s: no class entry for the template %s' % (o['id'], t['id']))
        out = []
        n = src['node'].clone()
        n.key = o['id']
        n.set('classattribs/gfx', o['id'])
        plan = self.plans.get(o['id'])
        if plan and plan.script:
            n.set('classattribs/classname', plan.script_class)
        for name, script, gfx in (plan.classes if plan else []):
            out.append(ttree.Node(name, None, [
                ttree.Node('classattribs', None, [ttree.Node('classname', script), ttree.Node('gfx', gfx)]),
                ttree.Node('objectattribs', None, [ttree.Node('tribe', plan.tribe)])]))
        hp = (o.get('stats') or {}).get('hitpoints')
        if hp not in (None, '') and n.get('objectattribs'):
            for k in ('hitpoints', 'maxhitpoints'):
                if n.get('objectattribs/' + k) is not None:
                    n.set('objectattribs/' + k, _num(hp))
        out.append(n)
        for suf in COMPANIONS:
            c = cl.get(t['id'].lower() + suf)
            if c:
                m = c['node'].clone()
                m.key = o['id'] + suf
                if (c['gfx'] or '').lower() == (src['gfx'] or '').lower():
                    m.set('classattribs/gfx', o['id'])
                out.append(m)
        return out

    def write_classes(self, entries):
        own = '%s/%s_objects.txt' % (self.low, self.low)
        root = ttree.Node('', None, [ttree.Node('Root', None, entries)])
        ttree.save(root, self.path('Scripts/Server/classes/' + own))
        ttree.save(ttree.Node('', None, [ttree.Node('Root', None, [ttree.Node('Objects', own)])]),
                   self.path('Scripts/Server/classes/%s.txt' % self.low))
        idx = ttree.load(self.data.file('Scripts/Server/classes/classes.txt'))
        r = idx.get('Root')
        if not any((c.value or '').lower() == self.low + '.txt' for c in r.children):
            r.add(ttree.Node(self.mod, self.low + '.txt'))
        ttree.save(idx, self.path('Scripts/Server/classes/classes.txt'))

    def write_scripts(self, scripts):
        """the mod's script classes and the configuration's script list with them (the game compiles what
        Scripts/Server/Server.ini lists, a mod's file replaces the list: MIRAGE ships its own)"""
        rel = 'classes/%s/%s.usl' % (self.low, self.low)
        with open(self.path('Scripts/Server/' + rel), 'w', encoding='latin-1', newline='') as f:
            f.write('// ParaWorld Workshop: script classes of the mod %s\r\n\r\n' % self.mod + '\r\n'.join(scripts))
        src = self.data.file('Scripts/Server/Server.ini')
        if not src:
            raise BuildError('the game configuration has no Scripts/Server/Server.ini')
        with open(src, encoding='latin-1') as f:
            lines = f.read().replace('\r\n', '\n').split('\n')
        while lines and not lines[-1].strip():
            lines.pop()
        if rel.lower() not in [l.strip().lower() for l in lines]:
            lines += ['', rel]
        with open(self.path('Scripts/Server/Server.ini'), 'w', encoding='latin-1', newline='') as f:
            f.write('\r\n'.join(lines) + '\r\n')

    # ------------------------------------------------------------------ models and textures
    def pick(self, o, t, edit=None):
        m = o.get('model') or {}
        if m.get('source') == 'upload':
            path = self.p.file(m['file'])
            name = m.get('name')
        else:                                     # a model of the game: the chosen one, else the template's own
            gfx = m.get('name') or t['gfx']
            path, name = self.data.find_model(gfx)
            if not path:
                raise BuildError('%s: the game has no model %s' % (o['id'], gfx))
        if not path or not os.path.isfile(path):
            raise BuildError('%s: the model file is missing (%s)' % (o['id'], m.get('file')))
        return gsfedit.Pick(path, name, o['id'], m.get('anims') or {}, edit=edit)

    def write_archive(self, picks):
        arch = gsfedit.assemble(self.low, picks)
        self.textures(arch)
        arch.save(self.path('GSF/%s.gsf' % self.low))
        lst = self.data.file('GSF/_gsfs.txt')
        names = []
        if lst:
            with open(lst, encoding='latin-1') as f:
                names = [l.strip() for l in f if l.strip()]
        if self.low + '.gsf' not in [n.lower() for n in names]:
            names.append(self.low + '.gsf')
        with open(self.path('GSF/_gsfs.txt'), 'w', encoding='latin-1', newline='\r\n') as f:
            f.write('\n'.join(names))

    def textures(self, arch):
        """the textures the models name: those the configuration lacks come from the project's pictures"""
        from pwexport import gsf
        roots = [os.path.join(self.data.game.data, m, 'Texture') for m in self.data.game.mods
                 if os.path.isdir(os.path.join(self.data.game.data, m, 'Texture'))]
        finder = gsf.TextureFinder(roots)
        given = {k.lower(): v for o in self.p.objects for k, v in (o.get('textures') or {}).items()}
        seen, table = set(), []
        for mat in arch.materials:
            for name in (mat.texture, mat.normal_map, mat.env_map):
                if not name or name.lower() in seen:
                    continue
                seen.add(name.lower())
                pic = given.get(name.lower())
                if pic:
                    from PIL import Image
                    img = Image.open(self.p.file(pic))
                    tmp = dds.prepare(img)
                    rel = 'Texture/' + dds.texture_file(name, max(tmp.size))
                    dds.write_dds(img, self.path(rel))
                    # the detail table: the sizes the texture quality settings load (64 .. its own)
                    sizes, z = [], max(tmp.size)
                    while z >= 64 and len(sizes) < 4:
                        sizes.insert(0, z)
                        z //= 2
                    stem = os.path.splitext(name.replace('\\', '/'))[0].split('/')[-1].lower()
                    table.append('%-32s dxt5   %s' % (stem, '  '.join(str(x) for x in sizes or [max(tmp.size)])))
                elif not finder.find(name):
                    self.warn('texture %s: neither the game nor the project has it (the model shows untextured)' % name)
        if table:
            base = self.data.file('Texture/detailtable.txt')
            text = ''
            if base:
                with open(base, encoding='latin-1') as f:
                    text = f.read()
            with open(self.path('Texture/detailtable.txt'), 'w', encoding='latin-1', newline='\r\n') as f:
                f.write(text.rstrip('\r\n') + '\n# ParaWorld Workshop: %s\n' % self.mod + '\n'.join(table) + '\n')

    # ------------------------------------------------------------------ texts
    def write_help(self, items):
        lang = self.p.lang
        have = self.data.help_items(lang)
        files = self.data.help_files(lang)
        add = {}
        for o, t in items:
            key = (self.data.tt_objects()[t['id']][2].val('description') or '_' + t['id']).lower()
            src = have.get(key)
            texts = o.get('texts') or {}
            name = texts.get('name') or o['id']
            if src:
                fname, item = src
                body = item
                body = re.sub(r'\\\{helpitem -name \S+ [^}]*\}', lambda m: '\\{helpitem -name _%s %s}' % (o['id'].lower(), name), body, count=1)
                body = re.sub(r'/bunit:\S+?(?=[\s}])', '/bunit:' + o['id'].lower(), body)
                for tag, key in (('tooltipmedium', 'short'), ('tooltiplong', 'long')):
                    if texts.get(key):
                        body = re.sub(r'(\\\{%s\}[ \t]*\r?\n).*?(\r?\n[ \t]*\\\{/%s\})' % (tag, tag),
                                      lambda m, k=key: m.group(1) + _seml(texts[k]) + m.group(2), body, count=1, flags=re.S)
            else:
                fname = 'h_animals.seml' if o['kind'] == 'animal' else next(iter(files), 'h_general.seml')
                body = ('\\{helpitem -name _%s %s}\n   \\{tooltipshort}\n   \\{/tooltipshort}\n   \\{tooltipmedium}\n%s\n  \\{/tooltipmedium}\n'
                        '   \\{tooltiplong}\n%s\n   \\{/tooltiplong}\n\\{/helpitem}' % (o['id'].lower(), name, _seml(texts.get('short') or ''), _seml(texts.get('long') or '')))
                self.warn('%s: the template has no help item; a new one was written' % o['id'])
            add.setdefault(fname, []).append(body)
        for fname, bodies in add.items():
            src = files.get(fname)
            text = ''
            if src:
                with open(src, encoding='utf-8-sig', errors='replace') as f:
                    text = f.read()
            disk = os.path.basename(src) if src else fname
            with open(self.path('Locale/%s/Texts/Help/%s' % (lang, disk)), 'w', encoding='utf-8-sig', newline='') as f:
                f.write(text.rstrip() + '\r\n\r\n' + '\r\n\r\n'.join(b.replace('\r\n', '\n').replace('\n', '\r\n') for b in bodies) + '\r\n')

    # ------------------------------------------------------------------ icons
    def write_icons(self, items):
        atlas = self.data.atlas()
        lines, custom = [], []
        for o, t in items:
            if o.get('icon'):
                custom.append(o)
                continue
            src = atlas.get(t['id'].lower())
            if not src:
                self.warn('%s: the template %s has no icon; the button shows none' % (o['id'], t['id']))
                continue
            for lvl, (f, x, y, w, h) in sorted(src.items()):
                lines.append(('file', f))
                lines.append(('source', '%s\t%d\t%d\t%d\t%d\t%d\t0\t0' % (o['id'].lower(), lvl, x, y, w, h)))
        if custom:
            lines += self.icon_sheet(custom)
        if not lines:
            return
        base = self.data.file('UI/All_def.txt')
        text = ''
        if base:
            with open(base, encoding='latin-1') as f:
                text = f.read()
        out, cur = [text.rstrip('\r\n'), '', '# ParaWorld Workshop: the icons of %s' % self.mod], None
        for k, v in lines:
            if k == 'file':
                if v != cur:
                    out.append('file %s' % v)
                    cur = v
            else:
                out.append('\tsource\t' + v)
        with open(self.path('UI/All_def.txt'), 'w', encoding='latin-1', newline='\r\n') as f:
            f.write('\n'.join(out) + '\n')

    # the card sizes of the pyramid / the command bar per level (All_def.txt of the game: levels 0-1 31 x 30, 2 37 x 36,
    # 3 51 x 49, 4 64 x 61)
    SIZES = [(0, 31, 30), (1, 31, 30), (2, 37, 36), (3, 51, 49), (4, 64, 61)]

    def icon_sheet(self, objs):
        from PIL import Image
        W = sum(w for _, w, _ in self.SIZES)
        H = max(h for _, _, h in self.SIZES) * len(objs)
        sheet = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        rel = 'hud/cards/cards_%s.tga' % self.low
        lines = [('file', rel)]
        rowh = max(h for _, _, h in self.SIZES)
        for i, o in enumerate(objs):
            img = Image.open(self.p.file(o['icon'])).convert('RGBA')
            x = 0
            for lvl, w, h in self.SIZES:
                sheet.paste(img.resize((w, h), Image.LANCZOS), (x, i * rowh))
                lines.append(('source', '%s\t%d\t%d\t%d\t%d\t%d\t0\t0' % (o['id'].lower(), lvl, x, i * rowh, w, h)))
                x += w
        dds.write_tga(sheet, self.path('UI/' + rel))
        return lines

    # ------------------------------------------------------------------ the mod's description
    def write_info(self):
        g = self.data.game
        req = g.infos.get(self.data.base.lower(), {}).get('id') if self.data.base else 'BaseData'
        prio = [e.get('priority') for e in g.infos.values() if e.get('priority') is not None and e['type'].lower() in ('add-on', 'locale')]
        prio = max(1, min(prio + [20]) - 5)
        lines = ['# Add on info file (made by the ParaWorld Workshop)', 'id %s' % self.mod, 'requires %s' % req, 'type add-on',
                 'info %s' % (self.p.title or self.mod), 'version %s' % (self.p.version or '1.0'), 'priority %d' % prio,
                 'tryfilereplace */data/base/* data/base/ data/%s/' % self.mod]
        for m in g.mods[1:]:
            lines.append('tryfilereplace */data/%s/* data/%s/ data/%s/' % (m.lower(), m.lower(), self.mod))
        p = os.path.join(self.out, 'Data', 'Info', self.mod + '.info')
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='latin-1', newline='\r\n') as f:
            f.write('\n'.join(lines) + '\n')
        self.files.append(p)


def _seml(text):
    """plain text for a help file: lines as \\{br}, bullets kept"""
    lines = [l.strip() for l in str(text).replace('\r', '').split('\n')]
    return '\n\\\\{br}'.join(l for l in lines if l)


def build(project, game_root, out):
    return Builder(project, game_root, out).run()
