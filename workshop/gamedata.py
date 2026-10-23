"""What the Workshop reads from a game configuration (the official game, or a mod such as MIRAGE): the tech tree, the
class lists, the help texts, the icon atlas, the model archives - and the objects that can serve as templates.

A new object is always made from a template: an object of the game whose rules (tech tree entries), script class,
build action, help text and icon are copied under the new name. The template decides how the object behaves; the
Workshop changes its model, its name and its numbers.

    data = GameData(install_root, base='MIRAGE')     # base: the configuration the mod builds on ('' = official)
    data.templates()              [{'id', 'kind', 'tribe', 'cls', 'name', 'gfx', 'script', ...}]
    data.template('hu_warrior')   the same, with the tech tree nodes found for it
"""
import os
import re
import sys

import threading

from . import ttree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from pwexport.mods import ModInstall          # noqa: E402

TRIBES = ['Hu', 'Aje', 'Ninigi', 'SEAS']
TT_REL = 'Scripts/Server/settings/Techtree/_TechTree.ttree'
CLASSES_REL = 'Scripts/Server/classes'
# the kinds of object the Workshop makes
KINDS = {
    'unit': 'Unit of a tribe (trained in a building)',
    'building': 'Building of a tribe (built by workers)',
    'animal': 'Wild animal',
    'decoration': 'Decoration (scenery object for maps)',
}
DECO_CLASSES = {'CDecoObj', 'CDecoColObj', 'CDecoColAnimObj'}
# class list entries that belong to an object and are copied with it: the corpse an animal leaves (Animal.usl:908
# CreateObj(GetClassName()+"_food"))
COMPANIONS = ('_food',)
_LOCK = threading.RLock()


class GameData:
    def __init__(self, root, base=''):
        # the official game is Base + Booster Pack 1 (the remake's "official" too, toolkit/remake.py): a mod for it
        # builds on Booster Pack 1 when that is installed
        g = ModInstall(root, base)
        if not g.mod and 'boosterpack1' in g.infos:
            g = ModInstall(root, 'BoosterPack1')
        self.game = g
        self.base = self.game.mod                 # the id as the .info spells it ('' = official game)
        self._tt = None
        self._classes = None
        self._help = None
        self._atlas = None

    # ------------------------------------------------------------------ files of the configuration
    def file(self, rel):
        return self.game.file(rel)

    def techtree_path(self):
        return self.game.file(TT_REL)

    @property
    def tt(self):
        with _LOCK:
            if self._tt is None:
                self._tt = ttree.load(self.techtree_path())
        return self._tt

    def class_index(self):
        """classes.txt: [(key, file)] of the configuration"""
        r = ttree.load(self.game.file(CLASSES_REL + '/classes.txt'))
        return [(c.key, c.value) for c in r.get('Root').children if c.value]

    @property
    def classes(self):
        """every class list entry: {name (lower case): {'name', 'node', 'file' (relative to classes/), 'script', 'gfx'}}
        - a later file of the lists wins, as for the game"""
        with _LOCK:
            return self._load_classes()

    def _load_classes(self):
        if self._classes is None:
            out = {}
            for _, sub in self.class_index():
                p = self.game.file(CLASSES_REL + '/' + sub)
                if not p:
                    continue
                for c in ttree.load(p).get('Root').children:
                    if not c.value:
                        continue
                    q = self.game.file(CLASSES_REL + '/' + c.value)
                    if not q:
                        continue
                    try:
                        t = ttree.load(q)
                    except ValueError:
                        continue
                    for o in t.get('Root').blocks():
                        out[o.key.lower()] = {'name': o.key, 'node': o, 'file': c.value,
                                              'script': o.val('classattribs/classname'), 'gfx': o.val('classattribs/gfx')}
            self._classes = out
        return self._classes

    def help_files(self, lang):
        """{file name (lower case): path} of the encyclopedia (Texts/Help/*.seml) in that language"""
        return self.game.locale_files(lang, 'Help')

    def help_items(self, lang):
        """{help key (lower case, '_hu_warrior'): (file name, the item's text)}"""
        if self._help is None:
            out = {}
            for name, p in self.help_files(lang).items():
                with open(p, encoding='utf-8-sig', errors='replace') as f:
                    text = f.read()
                for m in re.finditer(r'\\\{helpitem -name (\S+)[^}]*\}.*?\\\{/helpitem\}', text, re.S):
                    out[m.group(1).lower()] = (name, m.group(0))
            self._help = out
        return self._help

    def atlas(self):
        """the HUD icon atlas: {icon name (lower case): {level: (file, x, y, w, h)}} from every folder's All_def.txt"""
        if self._atlas is None:
            out = {}
            for m in self.game.mods:
                p = self.game.file('UI/All_def.txt', [m])
                if not p:
                    continue
                cur = None
                with open(p, encoding='latin-1') as f:
                    for line in f:
                        t = line.split('#')[0].split()
                        if not t:
                            continue
                        if t[0] == 'file' and len(t) > 1:
                            cur = t[1]
                        elif t[0] == 'source' and cur and len(t) >= 7:
                            try:
                                out.setdefault(t[1].lower(), {})[int(t[2])] = (cur, int(t[3]), int(t[4]), int(t[5]), int(t[6]))
                            except ValueError:
                                pass
            self._atlas = out
        return self._atlas

    # ------------------------------------------------------------------ objects of the tech tree
    def tt_objects(self):
        """{name: (tribe, category, node)} of StartTT/Objects"""
        out = {}
        objs = self.tt.get('Root/StartTT/Objects')
        for t in objs.blocks():
            for cat in t.blocks():
                if cat.key in ('Weapons', 'InventObjects'):
                    continue
                for o in cat.blocks():
                    out[o.key] = (t.key, cat.key, o)
        return out

    def build_actions(self):
        """{object name: [(tribe, category, action node)]} - the Build actions that make each object"""
        out = {}
        acts = self.tt.get('Root/StartTT/Actions')
        for t in acts.blocks():
            b = t.get('Build')
            if not b:
                continue
            for cat in b.blocks():
                for a in cat.blocks():
                    for r in (a.get('results').children if a.get('results') else []):
                        if r.value:
                            out.setdefault(r.value.split('/')[-1], []).append((t.key, cat.key, a))
        return out

    def templates(self):
        """the objects a new one can be made from, per kind"""
        objs, acts, cl = self.tt_objects(), self.build_actions(), self.classes
        out = []
        for name, (tribe, cat, node) in objs.items():
            ce = cl.get(name.lower())
            if not ce:
                continue                           # no class entry: the game cannot make it
            kind = None
            if tribe in TRIBES and cat in ('CHTR', 'ANML', 'VHCL', 'SHIP') and name in acts:
                kind = 'unit'
            elif tribe in TRIBES and cat == 'BLDG' and name in acts:
                kind = 'building'
            elif tribe == 'World' and cat == 'ANML':
                kind = 'animal'
            if not kind:
                continue
            out.append({'id': name, 'kind': kind, 'tribe': tribe, 'cat': cat, 'gfx': ce['gfx'] or node.val('gfx'),
                        'script': ce['script'], 'desc': node.val('description')})
        known = {o['id'].lower() for o in out} | {n.lower() for n in objs}
        for low, ce in cl.items():
            if ce['script'] in DECO_CLASSES and low not in known and ce['gfx'] and not low.endswith(COMPANIONS):
                out.append({'id': ce['name'], 'kind': 'decoration', 'tribe': '', 'cat': 'DECO', 'gfx': ce['gfx'],
                            'script': ce['script'], 'desc': None})
        out.sort(key=lambda o: (list(KINDS).index(o['kind']), o['tribe'], o['id'].lower()))
        return out

    def template(self, name):
        t = next((o for o in self.templates() if o['id'].lower() == name.lower()), None)
        if not t:
            raise KeyError('%s is no template of this game configuration' % name)
        return t

    def archives(self):
        """{archive name: path} of the configuration's model archives"""
        from pwexport.install import _ci_join
        out = {}
        for m in self.game.mods:
            g = _ci_join(os.path.join(self.game.data, m), 'GSF')
            if g:
                for f in sorted(os.listdir(g)):
                    if f.lower().endswith('.gsf'):
                        out[os.path.splitext(f)[0].lower()] = os.path.join(g, f)
        return out

    def find_model(self, gfx):
        """(archive path, model name as stored) of a model of the configuration, or (None, None); the later folder
        of the configuration wins, as for the game"""
        from pwexport import gsf
        with _LOCK:                                # (the web server asks from several threads)
            if getattr(self, '_models', None) is None:
                models = {}
                for name, path in self.archives().items():
                    try:
                        a = gsf.Archive(path)
                    except Exception:              # noqa: BLE001
                        continue
                    for n in a.names():
                        models[n.lower()] = (path, n)
                self._models = models
        return self._models.get(gfx.lower(), (None, None))
