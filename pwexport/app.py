"""The Model & Map Exporter app: a small local web server + the browser UI in web/.

    python -m pwexport            (alone; normally the toolkit's launcher serves it: python -m toolkit)

Opens http://127.0.0.1:<port>/ in the browser (or in its own window when pywebview is installed). Nothing is sent
anywhere: the server only listens on this computer.

HTTP API (JSON)
    GET  /api/state                 settings, languages, detected install folders, loading progress
    POST /api/setup                 {install, lang, ui_lang} -> checks the folder, saves, loads the catalog
    POST /api/settings              {lang | ui_lang | export_dir | blender: ...}
    POST /api/browse                {title, initial} -> folder picked in a native dialog
    GET  /api/catalog               units / buildings with names and add-ons, tribes, formats
    GET  /api/models                every model of every archive
    GET  /api/model?name=&archive=  converts (cached) -> {url, fourcc, anims, loops, walksets, links, flags}
    POST /api/export                export spec -> {files}
    POST /api/open                  {path} -> opens the folder in the file manager
    GET  /api/maps                  every map of the installation (name, size, players ... cached)
    GET  /api/map?id=               one map: info, players, description, objects (with their models), plants
    GET  /api/map/heights?id=&step= terrain heights, float32 little endian (X-Grid: "nx ny" header)
    GET  /api/map/mats?id=          ground material per 4 m cell, uint8 (X-Grid header)
    GET  /api/map/preview?id=       the map's 200 x 200 preview picture (png)
    GET  /api/ground?setting=&k=    ground material k of a setting (jpg)
    GET  /api/map/ground?id=&q=     the map's ground with the game's transition tiles (jpg, north up; q = ground detail 1 .. 5)
    GET  /api/map/groundinfo?id=&q= the tile set behind it: detail levels, tile and atlas sizes (json)
    GET  /api/map/tiles?id=&q=      which atlas tile lies where, uint16 (X-Grid header)
    GET  /api/map/groundpage?id=&q=&n=   atlas page n (png)
    POST /api/map/export            {id, format, objects, plants, forest, undergrowth, step, extras: [...]} -> {files}
    GET  /cache/...                 converted models and textures
"""
import io
import json
import mimetypes

import numpy as np
import os
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from . import VERSION, blender, forest, glb, gsf, mapexport, mods, parts, scape, scene, ula, walls, writers
from .catalog import Catalog, ModelIndex
from .config import Settings, cache_dir, home
from .install import LANGS, Install
from .texts import Texts

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web')


class App:
    def __init__(self):
        self.settings = Settings()
        self.install = None
        self.official = None         # the installation as the remake uses it (Install(root): the official game)
        self.index = None
        self.catalog = None
        self.progress = {'stage': '', 'frac': 0.0, 'ready': False, 'error': None}
        self.lock = threading.Lock()
        self.texts = {}
        self.maps = Maps(self)
        if self.settings.get('install') and Install.valid(self.settings['install']) and self.settings.get('lang'):
            self.start_loading()

    # ------------------------------------------------------------------ loading
    def start_loading(self):
        self.progress = {'stage': 'Starting', 'frac': 0.0, 'ready': False, 'error': None}
        threading.Thread(target=self._load, daemon=True).start()

    def _load(self):
        try:
            # the exporter shows the game as the chosen mod configuration loads it ("Mod" setting; '' = the base game)
            self.install = mods.ModInstall(self.settings['install'], mod=self.settings.get('mod') or '')
            if self.settings.get('mod') and not self.install.mod:
                self.settings['mod'] = ''                    # a mod that is no longer installed
                self.settings.save()
            # the remake keeps its own view of the installation: the official game (Base + BoosterPack1), whatever
            # the exporter shows
            self.official = Install(self.settings['install'])
            self.maps = Maps(self)
            self.index = ModelIndex(self.install, progress=lambda s, f: self.progress.update(stage=s, frac=f * 0.9))
            self.index.quality = self.settings.get('tex_quality', 'max')
            self.progress.update(stage='Reading texts and the tech tree', frac=0.92)
            self.texts = {}
            self.catalog = Catalog(self.install, self.index, self._texts(self.settings['lang']))
            self._add_other_names()
            self.progress.update(stage='Ready', frac=1.0, ready=True)
        except Exception as e:
            traceback.print_exc()
            self.progress.update(error=str(e), ready=False)

    def _texts(self, lang):
        if lang not in self.texts:
            self.texts[lang] = mods.Texts(self.install, lang)
        return self.texts[lang]

    def _add_other_names(self):
        """names in English and German too, so the search finds "Axtkrieger" and "Warrior" alike"""
        langs = [l for l in ('uk', 'de') if l in self.install.locales()]
        for e in self.catalog.entries:
            e['names'] = {l: self._texts(l).name(e['key']) for l in langs}

    def set_mod(self, mod):
        """switch the mod configuration: everything is read again (model index order, tech tree, texts, maps)"""
        inst = mods.ModInstall(self.settings['install'], mod=mod or '')
        self.settings['mod'] = inst.mod
        self.settings.save()
        self.catalog = None
        self.start_loading()
        return {'ok': True, 'mod': inst.mod}

    def mods_json(self):
        """the "Mod" selector: [{'id', 'name', 'version', 'type', 'requires', 'folders'}], '' = the base game"""
        inst = self.install or (mods.ModInstall(self.settings['install'], mod=self.settings.get('mod') or '')
                                if self.settings.get('install') and Install.valid(self.settings['install']) else None)
        return inst.configurations() if inst else []

    def set_lang(self, lang):
        self.settings['lang'] = lang
        self.settings.save()
        if self.catalog:
            self.catalog.texts = self._texts(lang)
            self.catalog.entries = self.catalog._entries()
            self.catalog._by_id = {e['id']: e for e in self.catalog.entries}
            self._add_other_names()

    # ------------------------------------------------------------------ api
    def state(self):
        langs = []
        if self.install or (self.settings.get('install') and Install.valid(self.settings['install'])):
            inst = self.install or Install(self.settings['install'])
            langs = inst.locales()
        return {'version': VERSION, 'settings': dict(self.settings), 'progress': self.progress,
                'mods': self.mods_json(), 'mod': self.install.mod if self.install else (self.settings.get('mod') or ''),
                'mod_folders': list(self.install.mods) if self.install else [],
                'configured': bool(self.settings.get('install') and self.settings.get('lang')),
                'candidates': Install.find() if not self.settings.get('install') else [],
                'langs': [{'id': l, 'name': LANGS.get(l, l)} for l in langs],
                'blender': blender.find(self.settings.get('blender', '')), 'home': home(),
                'platform': sys.platform, 'launcher': bool(getattr(self, 'launcher', False))}

    def setup(self, d):
        path = (d.get('install') or '').strip().strip('"')
        if not path or not Install.valid(path):
            return {'ok': False, 'error': 'not_paraworld'}
        inst = Install(path)
        lang = d.get('lang') or ('uk' if 'uk' in inst.locales() else (inst.locales() or ['uk'])[0])
        self.settings.update(install=inst.root, lang=lang, ui_lang=d.get('ui_lang') or self.settings.get('ui_lang', 'en'))
        if not self.settings.get('export_dir'):
            self.settings['export_dir'] = os.path.join(os.path.expanduser('~'), 'ParaWorld Exports')
        self.settings.save()
        self.start_loading()
        return {'ok': True}

    def catalog_json(self):
        if not self.catalog:
            return {'ready': False}
        d = self.catalog.to_json()
        d['ready'] = True
        d['formats'] = [dict(id=k, **v) for k, v in writers.FORMATS.items()] + \
            [dict(id=k, blender=True, **v) for k, v in blender.FORMATS.items()]
        return d

    def model(self, name, archive=None, mod=None):
        path = self.index.convert(name, archive=archive, mod=mod)
        j, _ = glb.load(path)
        ex = glb.root_extras(j)
        rel = os.path.relpath(path, cache_dir()).replace(os.sep, '/')
        anims = []
        for a in j.get('animations', []):
            d = 0.0
            for s in a['samplers']:
                acc = j['accessors'][s['input']]
                if 'max' in acc: d = max(d, acc['max'][0])
            anims.append({'name': a['name'], 'duration': round(d, 3)})
        loops = {}
        try:
            _, b = glb.load(path)
            loops = glb.walk_loops(j, b)
        except Exception:
            pass
        e = self.index.locate(name, archive, mod)
        return {'url': '/cache/' + rel, 'name': e['name'], 'archive': e['archive'], 'mod': e['mod'],
                'copies': self.catalog.copies_json(e['name']) if self.catalog else [],
                'fourcc': ex.get('fourcc', ''), 'anims': anims, 'loops': loops, 'walksets': ex.get('walksets') or {},
                'links': glb.links(j), 'flags': parts.flag_groups(j), 'visible': sorted(parts.visible_nodes(j))}

    def export(self, d):
        fmt = d['format']
        folder = d.get('folder') or self.settings.get('export_dir') or os.path.join(os.path.expanduser('~'), 'ParaWorld Exports')
        os.makedirs(folder, exist_ok=True)
        self.settings['export_dir'] = folder
        self.settings.save()
        specs = []
        for p in d['parts']:
            specs.append({'glb': self.index.convert(p['model'], archive=p.get('archive'), mod=p.get('mod')), 'parent': p.get('parent'),
                          'link': p.get('link'), 'hide': p.get('hide') or [], 'anim': p.get('anim'), 'offset': p.get('offset')})
        mode = d.get('animations', 'all')
        names = None if mode == 'all' else ([d['anim']] if mode == 'selected' and d.get('anim') else [])
        sc = scene.compose(specs, animations=names, party=d.get('party'))
        if d.get('loop') and d.get('anim'):
            sc.trim(d['anim'], d['loop'][0], d['loop'][1])
        base = os.path.join(folder, writers._safe(d.get('name') or 'model'))
        if fmt in writers.FORMATS:
            files = writers.write(sc, base, fmt, d.get('anim'), float(d.get('time') or 0))   # static formats: posed at that frame
        elif fmt in blender.FORMATS:
            exe = blender.find(self.settings.get('blender', ''))
            tmp = tempfile.mkdtemp(prefix='pwexport_')
            g = writers.write_glb(sc, os.path.join(tmp, 'model'))[0]
            files = blender.convert(exe, g, base + blender.FORMATS[fmt]['ext'], fmt)
        else:
            raise ValueError('unknown format ' + fmt)
        return {'ok': True, 'files': files, 'folder': folder}


class Maps:
    """the map viewer's side: map list (with names, cached), map data, exports"""
    def __init__(self, app):
        self.app = app
        self._maps = {}           # id -> Map (a few kept)
        self.lock = threading.Lock()
        self.lock_pages = threading.Lock()

    def _list(self):
        # the maps of the loaded configuration (Base, plus the folders of the chosen mod and what it requires)
        inst = self.app.install
        return inst.maps(inst.mods) if inst else []

    def path(self, mid):
        for e in self._list():
            if e['pack'] + '/' + e['rel'] == mid:
                return e['path']
        raise KeyError('unknown map ' + mid)

    def load(self, mid):
        with self.lock:
            m = self._maps.get(mid)
            if m is None:
                if len(self._maps) > 3:
                    self._maps.pop(next(iter(self._maps)))
                m = self._maps[mid] = ula.Map.load(self.path(mid))
            return m

    def list(self):
        idx_file = os.path.join(cache_dir('maps'), 'index.json')
        try:
            with open(idx_file, encoding='utf-8') as f:
                cached = json.load(f)
        except (OSError, ValueError):
            cached = {}
        out, changed = [], False
        for e in self._list():
            st = os.stat(e['path'])
            key = '%s|%d|%d|%s' % (e['path'], st.st_size, int(st.st_mtime), ula.VERSION)
            s = cached.get(key)
            if s is None:
                try:
                    m = ula.Map.load(e['path'])
                    s = m.summary()
                    s.pop('chunks', None)
                    s['description'] = (s.get('description') or '')[:600]
                except Exception as ex:
                    s = {'name': os.path.basename(e['rel']), 'error': str(ex)}
                cached[key] = s
                changed = True
            out.append(dict(s, id=e['pack'] + '/' + e['rel'], pack=e['pack'], rel=e['rel'], file_size=e['size']))
        if changed:
            try:
                with open(idx_file, 'w', encoding='utf-8') as f:
                    json.dump(cached, f, ensure_ascii=False)
            except OSError:
                pass
        return out

    def info(self, mid):
        m = self.load(mid)
        idx = self.app.index
        models = {}

        def model_of(o):
            k = (o.get('gfx') or '') + '|' + (o.get('cls') or '')
            if k not in models:
                models[k] = mapexport.model_name(o, idx) if idx else None
            return models[k]
        objs = [{'type': o['type'], 'name': o['name'], 'cls': o['cls'], 'model': model_of(o), 'x': round(o['x'], 2),
                 'y': round(o['y'], 2), 'z': round(mapexport.object_height(m, o, idx, model_of(o)), 2), 'z_map': round(o['z'], 2),
                 'rot': round(o['rot'], 4), 'q': [round(v, 5) for v in o['quat']], 'owner': o['owner'],
                 'attr': {k: v for k, v in o['attr'].items() if k in ('hitpoints', 'spawn_type', 'spawn_max', 'tribe', 'skulls')}}
                for o in m.objects]
        # captains and fishing nets belong to the transport at their spot and are not drawn on their own
        for i, owner in mapexport.hidden_parts(m).items():
            objs[i]['model'] = None
            objs[i]['part_of'] = owner
        if idx:
            # wall pieces: the arms towards their neighbours and one geometry variant per piece (pwexport/walls.py)
            for i, w in walls.arms(m, idx, model_of).items():
                objs[i]['wall'] = w
        pl = [{'name': p['name'], 'model': model_of({'gfx': p['name'], 'cls': p['name'], 'name': p['name']}),
               'x': round(p['x'], 2), 'y': round(p['y'], 2), 'z': round(p['z'], 2), 'rot': round(p['rot'], 3),
               'q': [round(v, 4) for v in p['quat']]} for p in m.plants]
        s = m.summary()
        s['forest'] = self.forest(m, model_of)
        return dict(s, id=mid, info=m.info, player_slots=m.players, desc=m.description, object_list=objs, plant_list=pl,
                    grid=[int(m.heights.shape[1]), int(m.heights.shape[0])], mgrid=[int(m.mats.shape[1]), int(m.mats.shape[0])],
                    preview=bool(m.preview))

    def forest(self, m, model_of):
        """the map's forest blocks for the viewer (pwexport/forest.py): {'blocks', 'patterns' (False = the game's program
        file with the tree layouts was not found), 'tree_models' [5], 'deco_models' [8] (viewer model names or None),
        'trees': flat [x, y, z, heading, kind, ...], 'deco': flat [x, y, z, kind, ...]}"""
        inst = self.app.install
        pat = forest.patterns(inst)
        out = {'blocks': len(m.forest['blocks']), 'patterns': pat is not None, 'tree_models': [], 'deco_models': [], 'trees': [], 'deco': []}
        if pat is None or not m.forest['blocks']:
            return out
        cfg = forest.config(inst, m.setting)
        name = lambda c: model_of({'gfx': c['standard'], 'cls': c['standard'], 'name': c['standard']}) if c else None
        out['tree_models'] = [name(c) for c in cfg['trees']]
        out['deco_models'] = [name(c) for c in cfg['deco']]
        it = forest.items(m, pat)
        for t in it['trees']:
            if not t['stump']:
                out['trees'] += [round(t['x'], 2), round(t['y'], 2), round(t['z'], 2), round(t['rot'], 4), t['kind']]
        for t in it['deco']:
            out['deco'] += [round(t['x'], 2), round(t['y'], 2), round(t['z'], 2), t['kind']]
        return out

    def heights(self, mid, step=1):
        m = self.load(mid)
        H = m.heights[::step, ::step]
        return H.astype('<f4').tobytes(), (H.shape[1], H.shape[0])

    def mats(self, mid):
        m = self.load(mid)
        return m.mats.astype(np.uint8).tobytes(), (m.mats.shape[1], m.mats.shape[0])

    def preview(self, mid):
        m = self.load(mid)
        if not m.preview:
            return None
        from PIL import Image
        b = io.BytesIO()
        Image.frombytes('RGBA', (m.preview['w'], m.preview['h']), m.preview['rgba']).save(b, 'PNG')
        return b.getvalue()

    def ground_map(self, mid, q=None):
        """the map's ground drawn with the game's transition tiles (scape.bake) at ground detail q, cached as jpg:
        the whole map in one picture of at most 4 px per metre (the viewer shows it from afar, see ground_tiles)"""
        import hashlib
        path = self.path(mid)
        m = self.load(mid)
        ts = scape.tileset(self.app.install, m.setting, q)
        key = hashlib.sha1(('%s|%s|%s|%s|q%s' % (path, os.path.getmtime(path), scape.VERSION, mods.scape_pack(self.app.install, m.setting),
                                                 ts.q if ts else 0)).encode()).hexdigest()[:16]
        f = os.path.join(cache_dir('maps', 'ground'), key + '.jpg')
        if not os.path.exists(f):
            scape.bake(self.app.install, m.setting, m.mats, m.w, m.h, px_per_m=4.0, max_side=4096, q=q).save(f + '.tmp.jpg', quality=88)
            os.replace(f + '.tmp.jpg', f)
        return f

    def ground_info(self, mid, q=None):
        """what the viewer needs to draw the ground from the game's tile atlases itself (full detail close up):
        {'q', 'qualities' [1 .. 5 as installed], 'tile', 'inner', 'border', 'per_row', 'page' (px), 'pages', 'grid'
        [nx, ny] of the tile layout (/api/map/tiles), 'px' (pixels per tile of the /api/map/ground picture), 'ver'
        (changes with the tile set: lets the browser keep the atlas pages)} or {'q': 0, 'qualities': []} when the
        setting has no tile set"""
        m = self.load(mid)
        inst = self.app.install
        ts = scape.tileset(inst, m.setting, q)
        if not ts:
            return {'q': 0, 'qualities': []}
        s = min(4.0, 4096 / max(m.w, m.h))
        return {'q': ts.q, 'qualities': scape.qualities(inst, m.setting), 'tile': ts.dat['tile'], 'inner': ts.inner,
                'border': ts.border, 'per_row': ts.per_row, 'page': ts.dat['atlas'], 'pages': len(ts.dat['names']),
                'grid': [int(m.mats.shape[1]) + 1, int(m.mats.shape[0]) + 1],
                'px': max(2, min(ts.inner, int(round(scape.METRES_PER_TILE * s)))),
                'ver': '%s-%s-%d' % (mods.scape_pack(inst, m.setting), os.path.basename(ts.folder),
                                     int(os.path.getmtime(os.path.join(ts.folder, 'ScapeTexture%d.dat' % ts.q))))}

    def ground_tiles(self, mid, q=None):
        """the tile layout of the map's ground (scape.tile_ids): uint16 per tile, row 0 = south"""
        m = self.load(mid)
        ts, ids = scape.tile_layout(self.app.install, m.setting, m.mats, q)
        if ts is None:
            raise KeyError('no ground tiles')
        return ids.astype('<u2').tobytes(), (ids.shape[1], ids.shape[0])

    def ground_page(self, mid, q, n):
        """atlas page n of the map's tile set as a .png (cached; the game's file is a DXT .dds)"""
        m = self.load(mid)
        inst = self.app.install
        ts = scape.tileset(inst, m.setting, q)
        src = ts.page_file(n) if ts and 0 <= n < len(ts.dat['names']) else None
        if not src:
            raise KeyError('no ground atlas page')
        sub = '%s@%s' % (os.path.basename(ts.folder), mods.scape_pack(inst, m.setting))
        f = os.path.join(cache_dir('scape', sub), 'page%d_%d_%d.png' % (ts.q, n, int(os.path.getmtime(src))))
        if not os.path.exists(f):
            from PIL import Image
            with self.lock_pages:
                if not os.path.exists(f):
                    Image.open(src).convert('RGB').save(f + '.tmp.png', compress_level=1)
                    os.replace(f + '.tmp.png', f)
        return f

    def ground(self, setting, k):
        return mods.material_files(self.app.install, setting)[k]

    def export(self, d):
        m = self.load(d['id'])
        app = self.app
        folder = d.get('folder') or app.settings.get('export_dir') or os.path.join(os.path.expanduser('~'), 'ParaWorld Exports')
        os.makedirs(folder, exist_ok=True)
        name = writers._safe(d.get('name') or os.path.splitext(os.path.basename(d['id']))[0])
        base = os.path.join(folder, name)
        files = []
        fmt = d.get('format') or 'glb'
        if fmt and fmt != 'none':
            sc = mapexport.build_scene(m, app.install, app.index, objects=bool(d.get('objects', True)), plants=bool(d.get('plants')),
                                       forest=d.get('forest', True) is not False, undergrowth=bool(d.get('undergrowth')),
                                       step=int(d.get('step') or 2), px_per_m=float(d.get('px_per_m') or 2.0), water=d.get('water', True) is not False)
            files += writers.write(sc, base, fmt)
        ex = set(d.get('extras') or [])
        if 'heightmap' in ex:
            files.append(mapexport.heightmap_png(m, base + '_heightmap.png')[0])
        if 'materials' in ex:
            files.append(mapexport.materials_png(m, base + '_materials.png'))
        if 'csv' in ex:
            files.append(mapexport.objects_csv(m, base + '_objects.csv', app.install))
        if 'json' in ex:
            files.append(mapexport.map_json(m, base + '.json', app.install))
        if 'preview' in ex and m.preview:
            files.append(ula.preview_png(m, base + '_preview.png'))
        if 'surf' in ex:
            with open(base + '.surf', 'wb') as f:
                f.write(m.surf)
            files.append(base + '.surf')
        if 'ksy' in ex:
            for k in ('paraworld_ula.ksy', 'paraworld_surf.ksy'):
                src = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'ksy', k)
                dst = os.path.join(folder, k)
                with open(src, 'rb') as a, open(dst, 'wb') as b:
                    b.write(a.read())
                files.append(dst)
        if 'ula' in ex:
            dst = base + '.ula'
            with open(self.path(d['id']), 'rb') as a, open(dst, 'wb') as b:
                b.write(a.read())
            files.append(dst)
        app.settings['export_dir'] = folder
        app.settings.save()
        return {'ok': True, 'files': files, 'folder': folder}


def browse(title='', initial=''):
    """native folder dialog (tkinter, run in its own process so it never blocks the server)"""
    code = ('import tkinter as tk, tkinter.filedialog as fd, sys\n'
            'r = tk.Tk(); r.withdraw(); r.attributes("-topmost", True)\n'
            'p = fd.askdirectory(title=sys.argv[1], initialdir=sys.argv[2] or None, mustexist=True)\n'
            'sys.stdout.write(p or "")\n')
    try:
        p = subprocess.run([sys.executable, '-c', code, title or 'Choose a folder', initial or ''], capture_output=True, text=True, timeout=600)
        return os.path.normpath(p.stdout.strip()) if p.stdout.strip() else ''
    except Exception:
        return ''


def open_folder(path):
    if not os.path.isdir(path):
        path = os.path.dirname(path)
    if sys.platform == 'win32':
        os.startfile(path)                                   # noqa: S606 (local file manager)
    elif sys.platform == 'darwin':
        subprocess.Popen(['open', path])
    else:
        subprocess.Popen(['xdg-open', path])


def make_handler(app):
    class H(BaseHTTPRequestHandler):
        server_version = 'pwexport/' + VERSION

        def log_message(self, fmt, *args):
            pass

        def send_json(self, obj, code=200):
            b = json.dumps(obj, ensure_ascii=False).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(b)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(b)

        def send_file(self, path, cache=False):
            if not os.path.isfile(path):
                self.send_error(404)
                return
            ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
            if path.endswith('.js'): ctype = 'text/javascript'
            if path.endswith('.glb'): ctype = 'model/gltf-binary'
            data = open(path, 'rb').read()
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'max-age=3600' if cache else 'no-cache')
            self.end_headers()
            self.wfile.write(data)

        def send_bytes(self, data, ctype='application/octet-stream', headers=None, cache=False):
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'max-age=3600' if cache else 'no-store')
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

        def body(self):
            n = int(self.headers.get('Content-Length') or 0)
            return json.loads(self.rfile.read(n) or b'{}')

        def do_GET(self):
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            p = unquote(u.path)
            try:
                if p == '/api/state': return self.send_json(app.state())
                if p == '/api/catalog': return self.send_json(app.catalog_json())
                if p == '/api/models': return self.send_json(app.catalog.models_json() if app.catalog else [])
                if p == '/api/model':
                    try:
                        return self.send_json(app.model(q['name'], q.get('archive'), q.get('mod')))
                    except (KeyError, ValueError) as e:          # unknown model / no geometry: the client shows it
                        return self.send_json({'error': str(e)})
                if p == '/api/maps': return self.send_json(app.maps.list())
                if p == '/api/map': return self.send_json(app.maps.info(q['id']))
                if p == '/api/map/heights':
                    data, (nx, ny) = app.maps.heights(q['id'], max(1, int(q.get('step') or 1)))
                    return self.send_bytes(data, headers={'X-Grid': '%d %d' % (nx, ny)})
                if p == '/api/map/mats':
                    data, (nx, ny) = app.maps.mats(q['id'])
                    return self.send_bytes(data, headers={'X-Grid': '%d %d' % (nx, ny)})
                if p == '/api/map/preview':
                    data = app.maps.preview(q['id'])
                    return self.send_bytes(data, 'image/png', cache=True) if data else self.send_error(404)
                gq = int(q['q']) if (q.get('q') or '').isdigit() else None           # ground detail 1 .. 5
                if p == '/api/map/ground': return self.send_file(app.maps.ground_map(q['id'], gq))   # not cached by the browser: the picture depends on the chosen mod
                if p == '/api/map/groundinfo': return self.send_json(app.maps.ground_info(q['id'], gq))
                if p == '/api/map/tiles':
                    data, (nx, ny) = app.maps.ground_tiles(q['id'], gq)
                    return self.send_bytes(data, headers={'X-Grid': '%d %d' % (nx, ny)})
                if p == '/api/map/groundpage':            # the url carries groundinfo's 'ver': the browser may keep it
                    return self.send_file(app.maps.ground_page(q['id'], gq, int(q.get('n') or 0)), cache=bool(q.get('v')))
                if p == '/api/ground': return self.send_file(app.maps.ground(q.get('setting') or 'Jungle', int(q.get('k') or 0)))
                if p.startswith('/cache/'):
                    root = os.path.realpath(cache_dir())
                    f = os.path.realpath(os.path.join(root, p[len('/cache/'):]))
                    if not f.startswith(root): return self.send_error(403)
                    return self.send_file(f, cache=True)
                root = os.path.realpath(WEB)
                f = os.path.realpath(os.path.join(root, (p.lstrip('/') or 'index.html')))
                if not f.startswith(root): return self.send_error(403)
                return self.send_file(f)
            except Exception as e:
                traceback.print_exc()
                return self.send_json({'error': str(e)}, 500)

        def do_POST(self):
            p = urlparse(self.path).path
            try:
                d = self.body()
                if p == '/api/setup': return self.send_json(app.setup(d))
                if p == '/api/settings':
                    for k in ('ui_lang', 'export_dir', 'blender', 'fps', 'tex_quality'):
                        if k in d: app.settings[k] = d[k]
                    if app.index: app.index.quality = app.settings.get('tex_quality', 'max')
                    if 'lang' in d: app.set_lang(d['lang'])
                    if 'mod' in d and (d['mod'] or '') != (app.settings.get('mod') or ''):
                        app.settings.save()
                        return self.send_json(app.set_mod(d['mod']))
                    if d.get('install') and Install.valid(d['install']) and d['install'] != app.settings.get('install'):
                        return self.send_json(app.setup({'install': d['install'], 'lang': app.settings.get('lang'), 'ui_lang': app.settings.get('ui_lang')}))
                    app.settings.save()
                    return self.send_json({'ok': True})
                if p == '/api/browse': return self.send_json({'path': browse(d.get('title'), d.get('initial'))})
                if p == '/api/export': return self.send_json(app.export(d))
                if p == '/api/map/export': return self.send_json(app.maps.export(d))
                if p == '/api/open': open_folder(d['path']); return self.send_json({'ok': True})
                self.send_error(404)
            except Exception as e:
                traceback.print_exc()
                return self.send_json({'ok': False, 'error': str(e)}, 500)
    return H


def serve(port=0, open_browser=True):
    app = App()
    srv = None
    for p in ([port] if port else list(range(8420, 8440)) + [0]):
        try:
            srv = ThreadingHTTPServer(('127.0.0.1', p), make_handler(app))
            break
        except OSError:
            continue
    url = 'http://127.0.0.1:%d/' % srv.server_address[1]
    print('ParaWorld Model & Map Exporter %s' % VERSION)
    print('Running at %s  (close this window to quit)' % url)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    if open_browser:
        try:
            import webview                                # optional: its own window (pip install pywebview)
            webview.create_window('ParaWorld Model & Map Exporter', url, width=1400, height=880)
            webview.start()
            return
        except ImportError:
            webbrowser.open(url)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
