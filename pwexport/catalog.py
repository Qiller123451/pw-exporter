"""What can be extracted: every model of the game, and every unit / building with its add-ons.

    idx = ModelIndex(install)              # model name -> archive (cached; rebuilt when an archive changes)
    idx.get('allosaurus')                  # {'name', 'archive', 'path', 'index', 'fourcc', 'anims'}
    idx.convert('allosaurus', out_dir)     # .glb with every part (flags in node extras) + all its animations

    cat = Catalog(install, idx, Texts(install, 'de'))
    cat.entries                            # list of units / buildings / animals with names, models and add-ons
    cat.entry('hu_warrior')

An entry:
    {'id': 'aje_allosaurus', 'tribe': 'Aje', 'type': 'ANML', 'name': 'Allosaurus', 'desc': '...',
     'models': [{'label': '', 'gfx': 'allosaurus'}, {'label': 'level 2', 'gfx': ...}],
     'addons': [{'id': 0, 'gfx': 'aje_rider_b', 'link': 'Ride', 'pi': -1, 'kind': 'rider', 'anim': 'ride_idle_0',
                 'variants': [...], 'by': None, 'cond': 'always', 'level': None, 'default': True, 'when': '...'}]}

Add-ons come from data/composites.json: how the game scripts put multi-part objects together (riders, turrets,
build-ups, drawbars and wagons, weapons, worker tools, carried goods). See docs/COMPOSITES.md.
"""
import json
import os
import re
import threading
import zlib

from . import composites, gamedata, gsf, texts as texts_mod
from .config import cache_dir

HERE = os.path.dirname(os.path.abspath(__file__))
TYPE_ORDER = {'CHTR': 0, 'ANML': 1, 'VHCL': 2, 'SHIP': 3, 'BLDG': 4}
# archives that only hold campaign / sequence / test copies of models: the main archives win name clashes
_MINOR = re.compile(r'^(sl_|seq_|test_|standard)')


class ModelIndex:
    """Which archive holds which model. Building it reads the table of contents of every .gsf (~10 s the first time)."""

    def __init__(self, install, progress=None):
        self.install = install
        # one index per installation (crc32 of the path: Python's hash() changes from run to run)
        self.cache_file = os.path.join(cache_dir(), 'index_%08x.json' % (zlib.crc32(install.data.lower().encode('utf-8')) & 0xffffffff))
        self._archives = {}             # path -> gsf.Archive (parsed, kept for re-use)
        self._lock = threading.Lock()
        self.models = {}                # lower name -> entry
        self.all = []                   # every (archive, model) pair, also duplicates
        self._build(progress)

    def _build(self, progress):
        try:
            with open(self.cache_file, encoding='utf-8') as f:
                cached = json.load(f)
        except (OSError, ValueError):
            cached = {}
        if cached.get('version') != gsf.VERSION:
            cached = {}
        arch = self.install.archives()
        out = {'version': gsf.VERSION, 'archives': {}}
        n = len(arch)
        for k, (an, path) in enumerate(sorted(arch.items())):
            st = os.stat(path)
            sig = '%d:%d' % (st.st_size, int(st.st_mtime))
            c = (cached.get('archives') or {}).get(path)
            if not c or c.get('sig') != sig:
                if progress:
                    progress('Reading %s.gsf (%d/%d)' % (an, k + 1, n), k / n)
                try:
                    a = self.archive(path)
                    models = [[m['name'], i, m['fourcc'].strip(), len(a.anim_names_index(i))] for i, m in enumerate(a.infos)]
                except Exception as e:
                    models = []
                    print('! cannot read %s: %s' % (path, e))
                c = {'sig': sig, 'models': models}
            out['archives'][path] = c
        try:
            with open(self.cache_file, 'w', encoding='utf-8') as f:
                json.dump(out, f)
        except OSError:
            pass
        # main archives first; a later mod replaces a model of the same name
        def prio(item):
            path = item[0]
            an = os.path.splitext(os.path.basename(path))[0].lower()
            mod = self.install.archive_mod(path)
            mi = self.install.model_mods.index(mod) if mod in self.install.model_mods else 0
            return (1 if _MINOR.match(an) else 0, -mi)
        self.models, self.all = {}, []
        for path, c in sorted(out['archives'].items(), key=prio):
            an = os.path.splitext(os.path.basename(path))[0]
            mod = self.install.archive_mod(path)
            for name, i, fourcc, nanim in c['models']:
                e = {'name': name, 'archive': an, 'mod': mod, 'path': path, 'index': i, 'fourcc': fourcc, 'anims': nanim}
                self.all.append(e)
                self.models.setdefault(name.lower(), e)
        if progress:
            progress('Ready', 1.0)

    def archive(self, path):
        with self._lock:
            a = self._archives.get(path)
            if a is None:
                if len(self._archives) > 6:              # keep memory bounded
                    self._archives.pop(next(iter(self._archives)))
                a = self._archives[path] = gsf.Archive(path)
            return a

    def get(self, name):
        return self.models.get((name or '').lower())

    def has(self, name):
        return (name or '').lower() in self.models

    def locate(self, name, archive=None):
        if archive:
            for e in self.all:
                if e['archive'].lower() == archive.lower() and e['name'].lower() == name.lower():
                    return e
        return self.get(name)

    def convert(self, name, out_dir=None, archive=None, embed_textures=False, fps=25.0):
        """convert one model (all parts, all animations) -> path of the .glb. Results are cached on disk."""
        e = self.locate(name, archive)
        if not e:
            raise KeyError('unknown model %s' % name)
        out_dir = out_dir or cache_dir('models', gsf.VERSION, e['mod'], e['archive'])
        out = os.path.join(out_dir, '%s.glb' % gsf.safe(e['name']))
        stamp = os.path.getmtime(e['path'])
        if os.path.exists(out) and os.path.getmtime(out) >= stamp:
            return out
        a = self.archive(e['path'])
        tmp = out + '.part'
        res = a.export_index(e['index'], tmp, data_dir=self.install.data, all_parts=True, embed_textures=embed_textures,
                             tex_dir=os.path.join(out_dir, 'textures'), fps=fps, log=lambda *x: None)
        if not res:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise ValueError('%s has no geometry' % name)
        os.replace(tmp, out)
        return out


def _level_of(when):
    m = re.search(r'level >= (\d)', when or '')
    return int(m.group(1)) if m else None


class Catalog:
    def __init__(self, install, index, texts=None):
        self.install, self.index = install, index
        self.texts = texts or texts_mod.Texts(install, 'uk')
        self.tt = gamedata.techtree(install)
        self.classes = gamedata.classes(install)
        with open(os.path.join(HERE, 'data', 'composites.json'), encoding='utf-8') as f:
            self.composites = json.load(f)
        self.entries = self._entries()
        self._by_id = {e['id']: e for e in self.entries}

    def entry(self, oid):
        return self._by_id.get(oid.lower())

    def tribe_name(self, tribe):
        t = self.texts
        return {'Hu': t.ui('_Hu', 'Norsemen'), 'Aje': t.ui('_Aje', 'Dustriders'), 'Ninigi': t.ui('_Ninigi', 'Dragon Clan'),
                'SEAS': t.ui('_SEAS', 'SEAS')}.get(tribe, tribe)

    def _gfx(self, g):
        """a model name that exists in the archives (case and class-file aliases resolved), or None"""
        if not g or g == '0':
            return None
        if self.index.has(g):
            return self.index.get(g)['name']
        c = self.classes.get(g.lower())
        if c and c.get('gfx') and self.index.has(c['gfx']):
            return self.index.get(c['gfx'])['name']
        return None

    def _entries(self):
        out = []
        for tribe, typ, name, node in gamedata.objects(self.tt):
            models, seen = [], set()
            for label, g in gamedata.object_gfx(self.tt, tribe, name, node):
                m = self._gfx(g)
                if m and m.lower() not in seen:
                    seen.add(m.lower())
                    models.append({'label': label, 'gfx': m})
            if not models:          # tech tree gfx missing: the class file's gfx (e.g. hu_flamethrower)
                c = self.classes.get(name.lower())
                m = self._gfx(c.get('gfx')) if c else None
                if m:
                    models.append({'label': '', 'gfx': m})
            if not models:
                continue
            info = self.texts.info(node.get('description', '').lstrip('_') or name) if self.texts.has(
                (node.get('description') or '').lstrip('_')) else self.texts.info(name)
            out.append({'id': name.lower(), 'key': name, 'tribe': tribe, 'type': typ,
                        'name': info['name'], 'desc': info.get('medium') or info.get('short') or '',
                        'models': models, 'addons': self._addons(name.lower())})
        out.sort(key=lambda e: (TYPE_ORDER.get(e['type'], 9), e['name'].lower()))
        return out

    def _addons(self, oid):
        """attached parts of an object (composites table), only those whose models exist in this installation.
        pi = index of the add-on it hangs on (-1 = the main model); by = 'level' / 'epoch' (which variant to show)"""
        norm = composites.normalized().get(oid, [])
        out, remap = [], {}
        for s in norm:
            variants = []
            for v in s['variants']:
                m = self._gfx(v)
                if m and m not in variants:
                    variants.append(m)
            g = self._gfx(s['gfx']) or (variants[0] if variants else None)
            if not g or (s['pi'] >= 0 and s['pi'] not in remap):
                continue
            if g not in variants:
                variants.insert(0, g)
            remap[s['i']] = len(out)
            out.append({'id': len(out), 'gfx': g, 'variants': variants, 'by': s['by'], 'link': s['link'],
                        'pi': remap.get(s['pi'], -1), 'kind': s['kind'], 'cond': s['cond'],
                        'arg': s['arg'] if not isinstance(s['arg'], list) else [remap[i] for i in s['arg'] if i in remap],
                        'anim': s['anim'], 'attack_anim': s['attack_anim'], 'when': s['when'],
                        'level': _level_of(s['when']), 'parent': out[remap[s['pi']]]['gfx'] if s['pi'] >= 0 else '',
                        # a part that only fits another look of the object (the ballista on hu_large_tower_upgrade)
                        'needs_model': (self._gfx(s['parent']) or s['parent']) if s['pi'] < 0 and s['parent'] else None})
        # defaults: what an owned unit shows out of the box (no upgrades, level 1)
        first_weapon = {}
        for a in out:
            a['slot'] = '%d:%s' % (a['pi'], a['link'])
            a['default'] = a['cond'] in ('always', 'ready', 'unless')
            if a['kind'] == 'weapon' and 'wild' not in a['when'].lower():
                first_weapon.setdefault(a['slot'], a)
        for a in first_weapon.values():
            a['default'] = True
        return out

    # ---------------------------------------------------------------- json for the app
    def to_json(self):
        return {'entries': self.entries,
                'tribes': {t: self.tribe_name(t) for t in ('Hu', 'Aje', 'Ninigi', 'SEAS')}}

    def models_json(self):
        """every model of every archive (the "All models" browser)"""
        return [{'name': e['name'], 'archive': e['archive'], 'mod': e['mod'], 'fourcc': e['fourcc'], 'anims': e['anims']}
                for e in self.index.all]
