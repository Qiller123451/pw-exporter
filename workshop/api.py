"""The Workshop's part of the toolkit's web server (toolkit/server.py): its page under /workshop/ and its API.

    GET  /workshop/                         the page (workshop/web)
    GET  /api/workshop/state                the installation, its configurations, the projects
    GET  /api/workshop/templates?base=      the objects of a configuration a new one can be made from
    GET  /api/workshop/template?base=&id=   one template: its numbers, model (animations, links), texts, icon
    GET  /api/workshop/gamemodels?base=     every model of the configuration's archives [{name, archive, fourcc}]
    GET  /api/workshop/project?id=          a project (+ checks, whether it is installed)
    POST /api/workshop/project/new          {id, title, base, lang}
    POST /api/workshop/project/save         the project (json)
    POST /api/workshop/project/delete       {id}
    POST /api/workshop/upload?project=&name=   the file's bytes -> {file, models (for a .gsf)}
    GET  /api/workshop/models?project=&file=   the models of an uploaded archive
    GET  /api/workshop/preview?project=&obj=   the object's model as glTF for the 3D view -> {url, anims, links}
    GET  /api/workshop/file/<project>/<rel>    a file of a project (previews, uploaded pictures)
    GET  /api/workshop/textures?project=&obj=  the textures the object's model uses, and which the game has
    GET  /api/workshop/extract?base=&name=     a model of the game as an archive of its own (for Blender)
    POST /api/workshop/build                {id} -> {files, warnings}
    POST /api/workshop/install              {id, langs} / uninstall {id}
    GET  /api/workshop/zip?id=              the built mod as a zip
    GET  /api/workshop/doc/<file>           the guide docs/WORKSHOP.md and its pictures (workshop/web/guide.html)
    POST /api/workshop/launch               {id}: the game with the mod (PWClient.exe -enable <id>)
    POST /api/workshop/remake               {id}: the remake's data of the mod's configuration (built in the
                                            background) -> {url}
"""
import json
import os
import re
import subprocess
import threading
import traceback
from urllib.parse import parse_qs, unquote, urlparse

from . import project as P
from . import build as B
from . import gsfedit
from . import install as I
from .gamedata import GameData, KINDS, TRIBES

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, 'web')
STAT_KEYS = ('hitpoints', 'defaultspeed', 'maxspeed', 'FOW', 'scalps', 'aggressive')


class Workshop:
    def __init__(self, app, remake=None, home=None):
        self.app = app                  # the exporter's App (the installation folder, the language)
        self.remake = remake            # toolkit/remake.py Remake (the remake's builds), or None
        self.home = home
        self._data = {}
        self._models = {}
        self.lock = threading.Lock()

    # ------------------------------------------------------------------ helpers
    def root(self):
        inst = getattr(self.app, 'official', None) or getattr(self.app, 'install', None)
        if inst is not None:
            return inst.root
        r = (getattr(self.app, 'settings', None) or {}).get('install')
        if not r:
            raise ValueError('pick the ParaWorld folder in the launcher first')
        return r

    def data(self, base=''):
        key = (self.root(), base or '')
        with self.lock:
            if key not in self._data:
                self._data[key] = GameData(self.root(), base or '')
            return self._data[key]

    def projects_home(self):
        return self.home or P.home()

    def project(self, pid):
        if not P.ID_RE.match(pid or ''):
            raise ValueError('bad project id')
        return P.Project.load(os.path.join(self.projects_home(), pid))

    # ------------------------------------------------------------------ answers
    def state(self):
        out = {'kinds': KINDS, 'tribes': TRIBES, 'projects': P.list_projects(self.projects_home()), 'game': None, 'configs': [], 'langs': []}
        try:
            root = self.root()
            d = self.data('')
            out['game'] = root
            out['configs'] = [{'id': c['id'], 'name': c['name'] or 'ParaWorld', 'folders': c['folders']} for c in d.game.configurations()
                              if c['id'].lower() not in ('boosterpack1',)]
            langs = d.game.locales() or ['uk']
            first = (getattr(self.app, 'settings', None) or {}).get('lang') or 'uk'
            out['langs'] = sorted(langs, key=lambda l: (l != first, l != 'uk', l))
        except Exception as e:                      # noqa: BLE001
            out['error'] = str(e)
        return out

    def templates(self, base):
        d = self.data(base)
        lang = getattr(self.app, 'settings', {}).get('help_lang') or 'uk'
        help_ = d.help_items(lang) if lang in d.game.locales() else {}
        out = []
        for t in d.templates():
            key = (t.get('desc') or '').lower()
            item = help_.get(key)
            title = None
            if item:
                m = re.match(r'\\\{helpitem -name \S+ ([^}]*)\}', item[1])
                title = m.group(1).strip() if m else None
            out.append({**t, 'title': title})
        return out

    def template(self, base, tid):
        d = self.data(base)
        t = d.template(tid)
        out = dict(t)
        objs = d.tt_objects()
        if tid in objs:
            node = objs[tid][2]
            out['stats'] = {k: node.val(k) for k in STAT_KEYS if node.val(k) is not None}
            acts = d.build_actions().get(tid, [])
            if acts:
                a = acts[0][2]
                out['cost'] = {r: a.val('conditions/rescosts/' + r) for r in ('food', 'wood', 'stone')}
                out['duration'] = a.val('duration')
                locs = a.get('locations')
                out['producer'] = (locs.children[0].value or '').split('/')[-1] if locs and locs.children else None
                out['producers'] = sorted({(x.value or '').split('/')[-1] for _, _, a2 in acts for x in (a2.get('locations').children if a2.get('locations') else [])})
            weapons = d.tt.get('Root/StartTT/Objects/%s/Weapons' % t['tribe'])
            for w in weapons.blocks() if weapons else []:
                users = w.get('Users')
                if users and any(u.value == tid for u in users.children):
                    out['weapon'] = {k: w.val(k) for k in ('damage', 'range', 'frequency')}
                    break
        path, name = d.find_model(t['gfx'] or '')
        out['model'] = {'archive': path, 'name': name}
        if path:
            try:
                info = next((m for m in gsfedit.describe(path) if m['name'].lower() == name.lower()), None)
                if info:
                    out['model'].update(anims=info['anims'], links=info['links'], fourcc=info['fourcc'], bbox=info['bbox'])
            except Exception as e:                  # noqa: BLE001
                out['model']['error'] = str(e)
        out['icon'] = bool(d.atlas().get(tid.lower()))
        return out

    def game_models(self, base):
        d = self.data(base)
        key = (self.root(), base)
        if key not in self._models:
            out = []
            from pwexport import gsf
            for an, path in sorted(d.archives().items()):
                try:
                    a = gsf.Archive(path)
                except Exception:                  # noqa: BLE001
                    continue
                out += [{'name': m['name'], 'archive': an, 'fourcc': m['fourcc'].strip()} for m in a.infos]
            self._models[key] = out
        return self._models[key]

    def preview(self, pid, oid):
        """the object's model as a .glb in the project's preview folder (made again when its source changed)"""
        p = self.project(pid)
        o = p.obj(oid)
        d = self.data(p.base)
        m = o.get('model') or {}
        if m.get('source') == 'upload':
            path, name = p.file(m.get('file')), m.get('name')
        else:
            path, name = d.find_model(m.get('name') or d.template(o['template'])['gfx'])
        if not path or not name or not os.path.isfile(path):
            raise ValueError('no model chosen yet')
        from pwexport import gsf
        out_dir = os.path.join(p.folder, 'preview')
        os.makedirs(out_dir, exist_ok=True)
        stamp = '%s|%s|%d|%d|%s' % (path, name, os.path.getsize(path), int(os.path.getmtime(path)), gsf.VERSION)
        glb = os.path.join(out_dir, re.sub(r'[^A-Za-z0-9_]+', '_', name) + '.glb')
        st = glb + '.stamp'
        if not (os.path.isfile(glb) and os.path.isfile(st) and open(st).read() == stamp):
            a = gsf.Archive(path)
            a.export(name, glb, data_dir=d.game.data, all_parts=True, log=lambda *x: None)
            with open(st, 'w') as f:
                f.write(stamp)
        info = next((x for x in gsfedit.describe(path) if x['name'].lower() == name.lower()), {})
        return {'url': '/api/workshop/file/%s/preview/%s' % (pid, os.path.basename(glb)), 'anims': info.get('anims', []),
                'links': info.get('links', []), 'fourcc': info.get('fourcc'), 'bbox': info.get('bbox')}

    def textures(self, pid, oid):
        """the textures the object's model uses: [{name, game (the game has it), file (the project's picture)}]"""
        p = self.project(pid)
        o = p.obj(oid)
        d = self.data(p.base)
        m = o.get('model') or {}
        if m.get('source') == 'upload':
            path, name = p.file(m.get('file')), m.get('name')
        else:
            path, name = d.find_model(m.get('name') or d.template(o['template'])['gfx'])
        if not path or not name:
            return []
        from pwexport import gsf
        roots = [os.path.join(d.game.data, f, 'Texture') for f in d.game.mods if os.path.isdir(os.path.join(d.game.data, f, 'Texture'))]
        finder = gsf.TextureFinder(roots)
        given = {k.lower(): v for k, v in (o.get('textures') or {}).items()}
        return [{'name': t, 'game': bool(finder.find(t)), 'file': given.get(t.lower())} for t in gsfedit.textures_of(path, name)]

    def build(self, pid):
        p = self.project(pid)
        d = self.data(p.base)
        problems = p.check(known=list(d.tt_objects()) + list(d.classes))
        if problems:
            return {'ok': False, 'problems': problems}
        out = os.path.join(p.folder, 'build')
        if os.path.isdir(out):
            import shutil
            shutil.rmtree(out)
        r = B.build(p, self.root(), out)
        return {'ok': True, **r}

    def launch(self, pid):
        root = self.root()
        for rel in ('Paraworld.exe', 'bin/Paraworld.exe', 'bin/PWClient.exe'):
            exe = os.path.join(root, *rel.split('/'))
            if os.path.isfile(exe):
                subprocess.Popen([exe, '-enable', pid], cwd=os.path.dirname(exe))
                return {'ok': True, 'exe': exe}
        return {'ok': False, 'error': 'ParaWorld\'s program (bin\\PWClient.exe) was not found in %s' % root}

    def try_remake(self, pid, start=True):
        """the remake's data of the mod's configuration: ready -> its url; else the build is started (start) or its
        progress reported"""
        if not self.remake:
            return {'ok': False, 'error': 'the remake is not part of this server'}
        if not I.installed(self.root(), pid):
            return {'ok': False, 'error': 'install the mod into the game first'}
        if hasattr(self.remake, '_insts'):
            self.remake._insts.clear()                 # (a mod installed since: a new configuration)
        st = self.remake.state(pid)
        if st.get('ready'):
            return {'ok': True, 'ready': True, 'url': '/remake/mod/%s/' % pid}
        if not st.get('building'):
            if not start:
                return {'ok': False, 'error': 'the remake could not prepare the game data of %s: %s' % (pid, st.get('error') or st.get('reason'))}
            if not self.remake.build(mod=pid):
                return {'ok': False, 'error': 'the remake is preparing other game data now - try again when it is done'}
        return {'ok': True, 'building': True, 'state': self.remake.state(pid)}

    # ------------------------------------------------------------------ the HTTP side
    def handle(self, h, method):
        """answer the request when it is the Workshop's; True if it was"""
        u = urlparse(h.path)
        path = unquote(u.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if path == '/workshop':
            h.send_response(302); h.send_header('Location', '/workshop/'); h.end_headers()
            return True
        if path.startswith('/workshop/') and method == 'GET':
            rel = path[len('/workshop/'):] or 'index.html'
            f = os.path.realpath(os.path.join(WEB, rel))
            if not f.startswith(os.path.realpath(WEB)):
                h.send_error(403)
            else:
                h.send_file(f)
            return True
        if not path.startswith('/api/workshop/'):
            return False
        try:
            self.route(h, method, path[len('/api/workshop/'):], q)
        except (ValueError, KeyError, P.ProjectError, B.BuildError, FileNotFoundError) as e:
            h.send_json({'ok': False, 'error': str(e).strip("'")}, 400)
        except Exception as e:                     # noqa: BLE001
            traceback.print_exc()
            h.send_json({'ok': False, 'error': '%s: %s' % (type(e).__name__, e)}, 500)
        return True

    def route(self, h, method, r, q):
        if method == 'GET':
            if r == 'state':
                return h.send_json(self.state())
            if r == 'templates':
                return h.send_json(self.templates(q.get('base', '')))
            if r == 'template':
                return h.send_json(self.template(q.get('base', ''), q['id']))
            if r == 'gamemodels':
                return h.send_json(self.game_models(q.get('base', '')))
            if r == 'project':
                p = self.project(q['id'])
                d = self.data(p.base)
                return h.send_json({**p.json(), 'problems': p.check(known=list(d.tt_objects()) + list(d.classes)),
                                    'installed': I.installed(self.root(), p.id),
                                    'built': os.path.isfile(os.path.join(p.folder, 'build', 'Data', 'Info', p.id + '.info'))})
            if r == 'models':
                p = self.project(q['project'])
                return h.send_json(gsfedit.describe(p.file(q['file'])))
            if r == 'preview':
                return h.send_json(self.preview(q['project'], q['obj']))
            if r.startswith('file/'):
                pid, _, rel = r[len('file/'):].partition('/')
                p = self.project(pid)
                return h.send_file(p.file(rel))
            if r.startswith('doc/'):
                # the guide (docs/WORKSHOP.md) and its pictures (docs/screenshots/workshop/...)
                docs = os.path.realpath(os.path.join(os.path.dirname(HERE), 'docs'))
                f = os.path.realpath(os.path.join(docs, r[len('doc/'):]))
                if not f.startswith(docs + os.sep):
                    raise ValueError('outside the documentation')
                if f.endswith('.md'):
                    with open(f, 'rb') as fh:
                        return h.send_bytes(fh.read(), 'text/markdown; charset=utf-8')
                return h.send_file(f)
            if r == 'extract':
                d = self.data(q.get('base', ''))
                path, name = d.find_model(q['name'])
                if not path:
                    raise KeyError('the game has no model %s' % q['name'])
                import tempfile
                tmp = os.path.join(tempfile.gettempdir(), 'pw_workshop_%s.gsf' % re.sub(r'[^A-Za-z0-9_]+', '_', name))
                gsfedit.extract_one(path, name, tmp)
                with open(tmp, 'rb') as f:
                    data = f.read()
                os.remove(tmp)
                return h.send_bytes(data, 'application/octet-stream', {'Content-Disposition': 'attachment; filename="%s.gsf"' % name})
            if r == 'textures':
                return h.send_json(self.textures(q['project'], q['obj']))
            if r == 'zip':
                p = self.project(q['id'])
                out = os.path.join(p.folder, '%s.zip' % p.id)
                I.zip_mod(os.path.join(p.folder, 'build'), p.id, out)
                with open(out, 'rb') as f:
                    data = f.read()
                return h.send_bytes(data, 'application/zip', {'Content-Disposition': 'attachment; filename="%s.zip"' % p.id})
            raise KeyError('unknown request ' + r)
        if r == 'upload':
            p = self.project(q['project'])
            n = int(h.headers.get('Content-Length') or 0)
            if n > 400 << 20:
                raise ValueError('the file is too big (400 MB at most)')
            rel = p.add_file(q.get('name') or 'upload', h.rfile.read(n))
            out = {'ok': True, 'file': rel}
            if rel.lower().endswith('.gsf'):
                try:
                    out['models'] = gsfedit.describe(p.file(rel))
                except Exception as e:             # noqa: BLE001
                    os.remove(p.file(rel))
                    raise ValueError('this is no archive the game can read: %s' % e)
            return h.send_json(out)
        b = h.body()
        if r == 'project/new':
            p = P.create(b.get('id'), b.get('title') or '', b.get('base') or '', b.get('lang') or 'uk', base=self.projects_home())
            return h.send_json({'ok': True, 'project': p.json()})
        if r == 'project/save':
            p = self.project(b.get('id'))
            for k in ('title', 'lang', 'version', 'objects', 'base'):
                if k in b:
                    setattr(p, k, b[k])
            p.save()
            return h.send_json({'ok': True})
        if r == 'project/delete':
            P.delete(b.get('id'), base=self.projects_home())
            return h.send_json({'ok': True})
        if r == 'build':
            return h.send_json(self.build(b['id']))
        if r == 'install':
            p = self.project(b['id'])
            try:
                done = I.install(os.path.join(p.folder, 'build'), self.root(), p.id, langs=b.get('langs', True))
            except PermissionError as e:
                raise ValueError('Windows does not let the toolkit write into the game folder (%s). Start the toolkit as '
                                 'administrator once, or download the zip and unpack it into the game folder yourself.' % e.filename)
            if self.remake and hasattr(self.remake, '_insts'):
                self.remake._insts.clear()
            return h.send_json({'ok': True, 'files': done})
        if r == 'uninstall':
            try:
                return h.send_json({'ok': True, 'files': I.uninstall(self.root(), b['id'])})
            except PermissionError as e:
                raise ValueError('Windows does not let the toolkit change the game folder (%s): start the toolkit as administrator.' % e.filename)
        if r == 'launch':
            return h.send_json(self.launch(b['id']))
        if r == 'remake':
            return h.send_json(self.try_remake(b['id'], start=b.get('start', True)))
        raise KeyError('unknown request ' + r)
