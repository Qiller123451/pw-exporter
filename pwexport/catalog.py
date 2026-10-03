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
        self.quality = 'max'            # texture quality of conversions (gsf.QUALITIES; the app's setting)
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
        arch = self.install.archive_list()
        out = {'version': gsf.VERSION, 'archives': {}}
        n = len(arch)
        for k, it in enumerate(arch):
            an, path = it['name'], it['path']
            st = os.stat(path)
            sig = '%d:%d' % (st.st_size, int(st.st_mtime))
            c = (cached.get('archives') or {}).get(path)
            if not c or c.get('sig') != sig:
                if progress:
                    progress('Reading %s/%s.gsf (%d/%d)' % (it['mod'], an, k + 1, n), k / n)
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
        # Which copy a plain name means (units, add-ons, maps): main archives before campaign / sequence / test ones,
        # the official game before the mods (BoosterPack1 over Base, as for the rules), then the mods in folder order.
        # Every other copy stays reachable: self.all lists all of them, copies(name) is what the viewer's
        # "Mod" selector offers, locate(name, archive, mod) finds one.
        mods = self.install.model_mods
        official = [m.lower() for m in self.install.mods]

        def prio(it):
            mod = it['mod']
            rank = -official.index(mod.lower()) - len(mods) if mod.lower() in official else mods.index(mod)
            return (1 if _MINOR.match(it['name']) else 0, rank, it['name'])
        self.models, self.all, self._copies = {}, [], {}
        for it in sorted(arch, key=prio):
            c = out['archives'][it['path']]
            for name, i, fourcc, nanim in c['models']:
                e = {'name': name, 'archive': it['name'], 'mod': it['mod'], 'path': it['path'], 'index': i, 'fourcc': fourcc, 'anims': nanim}
                self.all.append(e)
                self.models.setdefault(name.lower(), e)
                self._copies.setdefault(name.lower(), []).append(e)
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

    def copies(self, name):
        """every copy of a model, the default one first: [entry] (one per mod and archive that has the name)"""
        return self._copies.get((name or '').lower(), [])

    def locate(self, name, archive=None, mod=None):
        """the copy of a model in that archive and / or mod (the best match by the default order), else the default"""
        if archive or mod:
            al, ml = (archive or '').lower(), (mod or '').lower()
            hits = [e for e in self.copies(name) if (not ml or e['mod'].lower() == ml)]
            for e in hits:
                if not al or e['archive'].lower() == al:
                    return e
            if hits:                    # the mod keeps the model in another archive (mirage_characters.gsf ...)
                return hits[0]
            for e in self.copies(name):
                if al and e['archive'].lower() == al:
                    return e
        return self.get(name)

    def convert(self, name, out_dir=None, archive=None, embed_textures=False, fps=25.0, mod=None):
        """convert one model (all parts and levels of detail, all animations) -> path of the .glb. Results are cached on disk."""
        e = self.locate(name, archive, mod)
        if not e:
            raise KeyError('unknown model %s' % name)
        q = self.quality if self.quality in gsf.QUALITIES else 'max'
        out_dir = out_dir or cache_dir('models', gsf.VERSION + ('' if q == 'max' else '-' + q), e['mod'], e['archive'])
        out = os.path.join(out_dir, '%s.glb' % gsf.safe(e['name']))
        stamp = os.path.getmtime(e['path'])
        if os.path.exists(out) and os.path.getmtime(out) >= stamp:
            return out
        a = self.archive(e['path'])
        tmp = out + '.part'
        res = a.export_index(e['index'], tmp, data_dir=self.install.data, all_parts=True, all_lods=True, embed_textures=embed_textures,
                             tex_dir=os.path.join(out_dir, 'textures'), fps=fps, log=lambda *x: None, quality=q)
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
        """the "All models" browser: one row per archive name and model; `mods` = the mods that have this copy (the
        default one first) - the viewer offers them in its "Mod" selector"""
        rows, by = [], {}
        for e in self.index.all:
            k = (e['archive'], e['name'].lower())
            r = by.get(k)
            if r is None:
                r = by[k] = {'name': e['name'], 'archive': e['archive'], 'mod': e['mod'], 'mods': [], 'fourcc': e['fourcc'], 'anims': e['anims']}
                rows.append(r)
            if e['mod'] not in r['mods']:
                r['mods'].append(e['mod'])
        return rows

    def copies_json(self, name):
        """every copy of a model for the "Mod" selector: [{mod, archive, fourcc, anims, default}]"""
        d = self.index.get(name)
        return [{'mod': e['mod'], 'archive': e['archive'], 'fourcc': e['fourcc'], 'anims': e['anims'], 'default': e is d}
                for e in self.index.copies(name)]
