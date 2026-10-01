"""Development server for the remake alone (tests, debugging): serves it at http://127.0.0.1:<port>/ the way the
toolkit serves it under /remake/ (game code from game/, built data, maps / music / sounds from the installation).

    python remake/devserver.py [port] --game <ParaWorld folder> [--data <built game data folder>]
--data defaults to the toolkit's own build for that installation (see toolkit/remake.py).
"""
import argparse
import functools
import http.server
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from pwexport.install import Install        # noqa: E402
from toolkit.remake import Remake           # noqa: E402


class _App:
    def __init__(self, install):
        self.install = install


class Handler(http.server.BaseHTTPRequestHandler):
    def __init__(self, *a, remake=None, **k):
        self.remake = remake
        super().__init__(*a, **k)

    def log_message(self, *a):
        pass

    def do_GET(self):
        rel = self.path.split('?')[0].lstrip('/')
        from urllib.parse import unquote
        rel = unquote(rel)
        if rel == 'maps/index.json':
            body = json.dumps(self.remake.maps_index()).encode()
            ctype = 'application/json'
        else:
            f = self.remake.resolve(rel)
            if not f:
                return self.send_error(404)
            body = open(f, 'rb').read()
            import mimetypes
            ctype = mimetypes.guess_type(f)[0] or 'application/octet-stream'
            if f.endswith('.js'):
                ctype = 'text/javascript'
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('port', nargs='?', type=int, default=8411)
    ap.add_argument('--game', required=True)
    ap.add_argument('--data', default=None)
    a = ap.parse_args()
    r = Remake(_App(Install(a.game)))
    if a.data:
        d = os.path.abspath(a.data)
        r.out_dir = lambda: d
    http.server.ThreadingHTTPServer(('127.0.0.1', a.port), functools.partial(Handler, remake=r)).serve_forever()


if __name__ == '__main__':
    main()
