"""Mod configurations: which of the game's data folders are loaded, as the game itself decides it.

    game = ModInstall('E:/Paraworld')                 # the base game alone (Data/Base)
    game = ModInstall('E:/Paraworld', mod='MIRAGE')   # a mod with everything it requires
    game.mod                                # '' | 'MIRAGE' ...: the chosen configuration
    game.mods                               # ['Base', 'BoosterPack3', 'MIRAGE']: the data folders it loads, base first
    game.configurations()                   # what can be chosen: [{'id', 'name', 'version', 'type', 'requires', 'folders'}]
    game.file('Scripts/Server/settings/techtree/_TechTree.ttree')   # the copy of the last folder that has it
    game.maps(game.mods)                    # the maps of the loaded folders
    Texts(game, 'uk')                       # names and descriptions, the mods' texts over the base ones

The game stores its data in Data/<folder>/...: Base is the original release. What else is loaded is described by the
mod files Data/Info/<id>.info, as the game reads them when it is started with "-enable <id>":

    id MIRAGE
    requires BoosterPack3                    the mod below it (BaseData = the base game)
    type add-on                              add-on | locale | utility
    info MIRAGE                              display name
    version 2.6.7
    priority 20
    tryfilereplace */data/base/* data/base/ data/MIRAGE/       a file below data/base is taken from data/MIRAGE
                                                               instead when it exists there
    joindirscan */data/base/maps/multiplayer* /data/base/maps/multiplayer /data/MIRAGE/maps/multiplayer
                                                               folder listings are merged (maps, sequences ...)

So a configuration is a chain of folders: MIRAGE requires BoosterPack3 requires BaseData gives Base, BoosterPack3,
MIRAGE, and a file is taken from the last folder of the chain that has it. The language packs work the same way
(Locale_UK.info: data/locale/uk, data/BoosterPack3/locale/uk, data/MIRAGE/locale/uk replace base files).

ModInstall is an Install (install.py) with that chain as its `mods`; everything that asks an Install for files
(tech tree, class files, textures, ground tiles, forest kinds ...) then follows the chosen mod. The exporter uses it
with its "Mod" setting ('' = the base game). The remake keeps using Install(root): the official game, Base with
BoosterPack1 - its data build does not depend on this module.

The models of every folder stay listed whatever is chosen (model_mods, archive_list): the exporter's model viewer
can show any mod's copy of a model.
"""
import glob
import os

from . import scape, texts as texts_mod
from .config import cache_dir
from .install import OFFICIAL, Install, _ci_join

BASE_ID = 'basedata'                                 # the id the mod files use for the base game


def read_infos(data):
    """the mod files Data/Info/*.info -> {id (lower case): {'id', 'requires', 'type', 'info', 'version', 'priority',
    'replace': [(pattern, from, to)], 'join': [(pattern, dir, mod dir)], 'folders': [top-level Data folders that
    replace data/base], 'file'}}"""
    out = {}
    d = _ci_join(data, 'Info')
    if not d:
        return out
    for f in sorted(os.listdir(d)):
        if not f.lower().endswith('.info'):
            continue
        e = {'id': '', 'requires': '', 'type': '', 'info': '', 'version': '', 'priority': None, 'replace': [], 'join': [],
             'folders': [], 'file': os.path.join(d, f)}
        try:
            with open(e['file'], encoding='latin-1') as fh:
                lines = fh.read().splitlines()
        except OSError:
            continue
        for line in lines:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            key, _, val = line.partition(' ')
            key, val = key.lower(), val.strip()
            if key in ('id', 'requires', 'type', 'info', 'version'):
                e[key] = val
            elif key == 'priority':
                try:
                    e['priority'] = int(val)
                except ValueError:
                    pass
            elif key in ('tryfilereplace', 'joindirscan'):
                parts = val.split()
                if len(parts) == 3:
                    e['replace' if key == 'tryfilereplace' else 'join'].append(tuple(parts))
        for _, src, dst in e['replace']:
            s, t = src.strip('/\\').lower(), dst.replace('\\', '/').strip('/')
            if s == 'data/base' and t.lower().startswith('data/') and '/' not in t[5:] and t[5:].lower() != 'base':
                if t[5:] not in e['folders']:
                    e['folders'].append(t[5:])
        if e['id']:
            out[e['id'].lower()] = e
    return out


class ModInstall(Install):
    def __init__(self, root, mod=''):
        super().__init__(root)
        self.infos = read_infos(self.data)
        self.mod = self._mod_id(mod)
        self.mods = self.chain(self.mod)
        extra = [e for e in sorted(os.listdir(self.data)) if os.path.isdir(os.path.join(self.data, e))
                 and e.lower() not in ('locale', 'info') and e not in self.mods]
        self.model_mods = self.mods + [e for e in extra if _ci_join(os.path.join(self.data, e), 'GSF')]

    def __repr__(self):
        return 'ModInstall(%r, mod=%r)' % (self.root, self.mod)

    # ---------------------------------------------------------------- mods
    def _folder(self, name):
        """the Data folder of that name as it is spelled on disk (None if missing)"""
        low = (name or '').lower()
        return next((e for e in os.listdir(self.data) if e.lower() == low and os.path.isdir(os.path.join(self.data, e))), None)

    def _mod_id(self, mod):
        """a mod id as its .info file spells it ('' = the base game; unknown ids without a folder give '')"""
        m = (mod or '').strip()
        if not m or m.lower() in (BASE_ID, 'base'):
            return ''
        if m.lower() in self.infos:
            return self.infos[m.lower()]['id']
        return self._folder(m) or ''

    def chain(self, mod):
        """the data folders a mod loads, base first: follow its `requires` down to the base game. A mod without an
        .info file (or an installation without Data/Info) is its own folder on top of Base."""
        ids, seen = [], set()
        m = (mod or '').lower()
        while m and m not in (BASE_ID, 'base') and m not in seen:
            seen.add(m)
            ids.append(m)
            m = (self.infos.get(m) or {}).get('requires', '').lower()
        out = [self._folder('Base') or 'Base']
        for m in reversed(ids):
            e = self.infos.get(m)
            for name in (e['folders'] if e and e['folders'] else [m]):
                f = self._folder(name)
                if f and f not in out:
                    out.append(f)
        return out

    def chain_of_folder(self, folder):
        """the chain of the mod that owns a Data folder (for showing another mod's copy of a model with that
        mod's own textures): the folder's .info chain, else Base + the folder"""
        low = (folder or '').lower()
        if low in ('', 'base'):
            return self.chain('')
        for e in self.infos.values():
            if any(f.lower() == low for f in e['folders']):
                return self.chain(e['id'])
        f = self._folder(folder)
        return self.chain('') + ([f] if f else [])

    def configurations(self):
        """what the "Mod" setting offers: the base game and every mod of Data/Info that replaces base files from its
        own folder (add-ons and whole-game mods; not the language packs and the level editor scripts), in the
        order base, official add-ons, then by name: [{'id', 'name', 'version', 'type', 'requires', 'folders'}]"""
        out = [{'id': '', 'name': '', 'version': '', 'type': 'base', 'requires': '', 'folders': self.chain('')}]
        rows = []
        for e in self.infos.values():
            if e['id'].lower() == BASE_ID or e['type'].lower() == 'utility' or not e['folders']:
                continue
            if not any(self._folder(f) for f in e['folders']):
                continue                                  # described, but not installed
            rows.append({'id': e['id'], 'name': e['info'] or e['id'], 'version': e['version'], 'type': e['type'],
                         'requires': e['requires'], 'folders': self.chain(e['id'])})
        if not self.infos:                                # no Data/Info: the official patch, when its folder is there
            for m in OFFICIAL[1:]:
                if self._folder(m):
                    rows.append({'id': self._folder(m), 'name': self._folder(m), 'version': '', 'type': 'add-on',
                                 'requires': '', 'folders': self.chain(m)})
        rows.sort(key=lambda r: (len(r['folders']), r['id'].lower()))
        return out + rows

    # ---------------------------------------------------------------- folders
    def dir(self, rel, mods=None):
        """Install.dir(), but for a setting's ground textures (Texture/Scape/<Setting>) the last folder of the chain
        that has the whole set - its tile table ScapeTexture<Q>.dat. The game replaces file by file: MIRAGE ships
        only two detail textures there, the tiles themselves are still Base's."""
        r = rel.replace('\\', '/').strip('/')
        if r.lower().startswith('texture/scape/'):
            found = None
            for m in mods or self.mods:
                p = _ci_join(os.path.join(self.data, m), r)
                if p and os.path.isdir(p) and any(f.lower().startswith('scapetexture') and f.lower().endswith('.dat') for f in os.listdir(p)):
                    found = p
            if found:
                return found
        return super().dir(rel, mods)

    # ---------------------------------------------------------------- maps and texts
    def maps(self, packs=None):
        """the maps of these Data folders (None = of every folder, like Install.maps()). The exporter passes
        self.mods: the maps of the chosen configuration, as the game's joindirscan rules merge them."""
        out = super().maps()
        if packs is None:
            return out
        low = {p.lower() for p in packs}
        return [e for e in out if e['pack'].lower() in low]

    def locale_dirs(self, lang):
        """the text folders of a language, base first: Data/locale/<lang>/Texts, then Data/<folder>/locale/<lang>/
        Texts of every loaded mod folder (the Locale_<LANG>.info rules: a mod's texts replace the base ones)"""
        out = [d for d in [self.locale_dir(lang)] if d]
        for m in self.mods[1:]:
            d = _ci_join(os.path.join(self.data, m), 'locale/%s/Texts' % lang)
            if d and d not in out:
                out.append(d)
        return out


class Texts(texts_mod.Texts):
    """texts.Texts with the texts of the loaded mod folders over the base ones: a mod's encyclopedia files and
    string tables (boosterpack1.ltf, mirage.ltf ...) replace and extend the base game's"""

    def __init__(self, install, lang='uk'):
        super().__init__(install, lang)
        dirs = install.locale_dirs(lang) if hasattr(install, 'locale_dirs') else []
        for d in dirs[1:]:
            for f in sorted(glob.glob(os.path.join(d, 'Help', '*'))):
                if f.lower().endswith('.seml'):
                    with open(f, encoding='utf-8-sig', errors='replace') as fh:
                        self.help.update(texts_mod.parse_help(fh.read()))
            for f in sorted(glob.glob(os.path.join(d, '*'))):
                base = os.path.basename(f).lower()
                if base.endswith('.ltf') and not base.startswith(('sequences', 'dialogscenes')):
                    with open(f, encoding='utf-8-sig', errors='replace') as fh:
                        self.ltf.update(texts_mod.parse_ltf(fh.read()))


# ---------------------------------------------------------------- ground textures
def scape_pack(install, setting):
    """the Data folder a setting's ground textures come from under this configuration ('Base', 'Wintermod' ...)"""
    folder = scape._folder(install, setting)
    return os.path.relpath(folder, install.data).replace(os.sep, '/').split('/')[0] if folder else 'Base'


def material_files(install, setting):
    """the 8 seamless ground textures of a setting as cached .jpg files. Base's are scape.material_textures' own
    cache; a mod that replaces the ground (Wintermod's snow) gets its own, so one configuration's ground never
    shows under another."""
    pack = scape_pack(install, setting)
    sub = scape.FOLDERS.get(setting, 'Jungle')
    if pack.lower() == 'base':
        scape.material_textures(install, setting)
        return [os.path.join(cache_dir('scape', sub), 'material%s_%d.jpg' % (scape.VERSION, k)) for k in range(8)]
    out_dir = cache_dir('scape', '%s@%s' % (sub, pack))
    files = [os.path.join(out_dir, 'material%s_%d.jpg' % (scape.VERSION, k)) for k in range(8)]
    if all(os.path.exists(f) for f in files):
        return files
    from PIL import Image
    ts = scape.tileset(install, setting)
    if not ts:                                   # no tile set in the mod's folder: the plain material textures
        scape.material_textures(install, setting)            # (takes scape._lock itself - never call it under the lock)
        return [os.path.join(cache_dir('scape', sub), 'material%s_%d.jpg' % (scape.VERSION, k)) for k in range(8)]
    with scape._lock:
        if all(os.path.exists(f) for f in files):
            return files
        T, mats = ts.dat['table'], ts.dat['mats']
        for k, f in enumerate(files):
            img = Image.new('RGB', (scape.GRID * 64, scape.GRID * 64))
            for gy in range(scape.GRID):
                for gx in range(scape.GRID):
                    t = Image.fromarray(ts.tile(T[scape.matdesc([k] * 4, gx, gy, mats=mats)]))
                    img.paste(t.resize((64, 64)) if t.size != (64, 64) else t, (gx * 64, gy * 64))
            img.save(f + '.tmp.jpg', quality=90)
            os.replace(f + '.tmp.jpg', f)
    return files
