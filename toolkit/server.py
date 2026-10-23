"""The toolkit's local web server: the launcher page, the Model & Map Exporter (pwexport, under /exporter/ with its
API under /api/) and the remake (under /remake/, see toolkit/remake.py). Listens on 127.0.0.1 only.

    GET  /                          the launcher (toolkit/web)
    GET  /api/toolkit/state         installation, exporter loading progress, remake build state (official game)
    GET  /api/toolkit/remake/configs        the configurations the remake can run: official game + mods
    GET  /api/toolkit/remake/state?mod=ID   build state of one configuration
    POST /api/toolkit/remake/build  build the remake's game data from the installation (runs in the background;
                                    only what is out of date, {"force": true} everything, {"mod": "MIRAGE"} a mod's)
    GET  /api/toolkit/data[?size=1] where the toolkit's data lies (cache + remake game data; toolkit/datadir.py)
    POST /api/toolkit/data          {"path"}: move it there (in the background)
    GET  /exporter/                 the Model & Map Exporter (pwexport/web; its API: pwexport/app.py)
    GET  /remake/...                the remake (official game)
    GET  /remake/mod/<id>/...       the remake with a mod configuration's data (toolkit/remake.py)
    GET  /workshop/                 the Workshop: new units, buildings, animals and decorations for the game and the
                                    remake (workshop/, its API under /api/workshop/: workshop/api.py)
"""
import json
import os
import sys
import threading
import time
import traceback
import webbrowser
from http.server import ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from pwexport import app as exporter        # noqa: E402
from . import VERSION                        # noqa: E402
from .datadir import DataFolder              # noqa: E402
from .remake import Remake                   # noqa: E402
try:                                         # the Workshop (workshop/): the toolkit runs without it if it cannot load
    from workshop.api import Workshop        # noqa: E402
except Exception as _e:                      # noqa: BLE001
    print('The Workshop is not available: %s' % _e)
    Workshop = None

WEB = os.path.join(HERE, 'web')


def make_handler(app, remake, data, workshop=None):
    Base = exporter.make_handler(app)

    class H(Base):
        server_version = 'paraworld-toolkit/' + VERSION

        def static(self, root, rel):
            root = os.path.realpath(root)
            f = os.path.realpath(os.path.join(root, rel or 'index.html'))
            if not f.startswith(root):
                return self.send_error(403)
            return self.send_file(f)

        def do_GET(self):
            u = urlparse(self.path)
            p = unquote(u.path)
            if workshop and workshop.handle(self, 'GET'):
                return
            try:
                if p == '/api/toolkit/state':
                    return self.send_json(self.toolkit_state())
                if p == '/api/toolkit/data':
                    return self.send_json(data.state(size=bool(parse_qs(u.query).get('size'))))
                if p == '/api/toolkit/remake/configs':
                    return self.send_json(remake.configs())
                if p == '/api/toolkit/remake/state':
                    return self.send_json(remake.state((parse_qs(u.query).get('mod') or [''])[0]))
                if p == '/' or p == '/index.html' or p.startswith('/launcher/'):
                    return self.static(WEB, p[len('/launcher/'):] if p.startswith('/launcher/') else 'index.html')
                if p == '/exporter':
                    return self.redirect('/exporter/')
                if p.startswith('/exporter/'):
                    return self.static(exporter.WEB, p[len('/exporter/'):])
                if p == '/remake':
                    return self.redirect('/remake/')
                if p.startswith('/remake/mod/') and p.count('/') == 3:
                    return self.redirect(p + '/')
                if p.startswith('/remake/'):
                    rel, mod = p[len('/remake/'):], ''
                    if rel.startswith('mod/'):
                        mod, _, rel = rel[len('mod/'):].partition('/')
                        if not remake.inst(mod):
                            return self.send_error(404)
                    if rel == 'maps/index.json':
                        return self.send_json(remake.maps_index(mod))
                    f = remake.resolve(rel, mod)
                    if not f:
                        return self.send_error(404)
                    return self.send_file(f, cache=rel.startswith(('assets/', 'maps/')))
            except Exception as e:                       # noqa: BLE001
                traceback.print_exc()
                return self.send_json({'error': str(e)}, 500)
            return super().do_GET()

        def do_POST(self):
            p = urlparse(self.path).path
            if workshop and workshop.handle(self, 'POST'):
                return
            if p == '/api/toolkit/remake/build':
                try:
                    b = self.body()
                    return self.send_json({'ok': remake.build(force=bool(b.get('force')), mod=b.get('mod') or '')})
                except Exception as e:                   # noqa: BLE001
                    return self.send_json({'ok': False, 'error': str(e)}, 500)
            if p == '/api/toolkit/data':
                try:
                    ok, why = data.move(self.body().get('path'))
                    return self.send_json({'ok': ok, 'error': why})
                except Exception as e:                   # noqa: BLE001
                    return self.send_json({'ok': False, 'error': str(e)}, 500)
            return super().do_POST()

        def redirect(self, to):
            self.send_response(302)
            self.send_header('Location', to)
            self.end_headers()

        def toolkit_state(self):
            st = app.state()
            st['toolkit'] = VERSION
            st['remake'] = remake.state() if app.install else {'ready': False, 'reason': 'no installation'}
            st['install_path'] = app.install.root if app.install else app.settings.get('install')
            st['data'] = data.state()
            return st
    return H


def serve(port=0, open_browser=True):
    app = exporter.App()
    app.launcher = True
    remake = Remake(app)
    data = DataFolder(app, remake)
    remake.paused = data.busy
    srv = None
    for p in ([port] if port else list(range(8420, 8440)) + [0]):
        try:
            srv = ThreadingHTTPServer(('127.0.0.1', p), make_handler(app, remake, data, Workshop(app, remake) if Workshop else None))
            break
        except OSError:
            continue
    url = 'http://127.0.0.1:%d/' % srv.server_address[1]
    print('ParaWorld Toolkit %s' % VERSION)
    print('Running at %s  (close this window to quit)' % url)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    if open_browser:
        webbrowser.open(url)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
