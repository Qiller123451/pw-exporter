"""The toolkit's local web server: the launcher page, the Model & Map Exporter (pwexport, under /exporter/ with its
API under /api/) and the remake (under /remake/, see toolkit/remake.py). Listens on 127.0.0.1 only.

    GET  /                          the launcher (toolkit/web)
    GET  /api/toolkit/state         installation, exporter loading progress, remake build state
    POST /api/toolkit/remake/build  build the remake's game data from the installation (runs in the background;
                                    only what is out of date, {"force": true} everything)
    GET  /exporter/                 the Model & Map Exporter (pwexport/web; its API: pwexport/app.py)
    GET  /remake/...                the remake
"""
import json
import os
import sys
import threading
import time
import traceback
import webbrowser
from http.server import ThreadingHTTPServer
from urllib.parse import unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from pwexport import app as exporter        # noqa: E402
from . import VERSION                        # noqa: E402
from .remake import Remake                   # noqa: E402

WEB = os.path.join(HERE, 'web')


def make_handler(app, remake):
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
            p = unquote(urlparse(self.path).path)
            try:
                if p == '/api/toolkit/state':
                    return self.send_json(self.toolkit_state())
                if p == '/' or p == '/index.html' or p.startswith('/launcher/'):
                    return self.static(WEB, p[len('/launcher/'):] if p.startswith('/launcher/') else 'index.html')
                if p == '/exporter':
                    return self.redirect('/exporter/')
                if p.startswith('/exporter/'):
                    return self.static(exporter.WEB, p[len('/exporter/'):])
                if p == '/remake':
                    return self.redirect('/remake/')
                if p.startswith('/remake/'):
                    rel = p[len('/remake/'):]
                    if rel == 'maps/index.json':
                        return self.send_json(remake.maps_index())
                    f = remake.resolve(rel)
                    if not f:
                        return self.send_error(404)
                    return self.send_file(f, cache=rel.startswith(('assets/', 'maps/')))
            except Exception as e:                       # noqa: BLE001
                traceback.print_exc()
                return self.send_json({'error': str(e)}, 500)
            return super().do_GET()

        def do_POST(self):
            p = urlparse(self.path).path
            if p == '/api/toolkit/remake/build':
                try:
                    return self.send_json({'ok': remake.build(force=bool(self.body().get('force')))})
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
            return st
    return H


def serve(port=0, open_browser=True):
    app = exporter.App()
    app.launcher = True
    remake = Remake(app)
    srv = None
    for p in ([port] if port else list(range(8420, 8440)) + [0]):
        try:
            srv = ThreadingHTTPServer(('127.0.0.1', p), make_handler(app, remake))
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
