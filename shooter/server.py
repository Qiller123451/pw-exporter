"""Local server of the ParaWorld shooter (python -m shooter).

The game is plain browser code (shooter/web: ES modules, no build step). Everything it shows comes from the player's
own ParaWorld installation, through the game data the toolkit's remake has already prepared:

    /                         shooter/web/index.html
    /src/...                  shooter/web/src/...             the game code
    /vendor/three/...         pwexport/web/vendor/three/...   three.js (shared with the exporter)
    /data/gamedata.json       <prepared data>/gamedata.json   (also techtree.json)
    /data/assets/...          <prepared data>/assets/...      models (.glb), textures, ground textures, manifest
    /data/assets/snd/<path>   Data/<mod>/Audio/Sound/<path>   sounds, straight from the installation
    /data/assets/music/<f>    Data/<mod>/Audio/Music/<f>
    /data/maps/<pack>/<rel>   Data/<pack>/Maps/<rel>          map files (.ula)
    /api/info                 {ready, reason, game, data}     is the prepared data there?
    /api/log?sid=<session>    POST: lines of the game's log   -> <toolkit home>/shooter/logs/shooter-<time>-<session>.log
    /api/lastlog?sid=<s>      the previous session's log: {file, closed, tail}

The log: the page sends what happens (start, objectives, errors, a line of numbers every few seconds) and the
server writes it to a file straight away, so after a crash the file shows what the game was doing right before.
A session that stops sending without having said "page closed" gets a note from the server's watchdog.

"Prepared data" is the folder the toolkit launcher builds with "Prepare the game data" (remake/pipeline):
<toolkit home>/remake/<id of the installation>/. Nothing of the game is stored in this repository.
"""
import argparse
import functools
import http.server
import json
import mimetypes
import os
import socket
import sys
import threading
import time
import traceback
import webbrowser
import zlib
from urllib.parse import unquote

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEB = os.path.join(HERE, 'web')
VENDOR = os.path.join(ROOT, 'pwexport', 'web', 'vendor')
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from pwexport.config import Settings, home          # noqa: E402
from pwexport.install import Install, _ci_join      # noqa: E402

TYPES = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary',
         '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ula': 'application/octet-stream', '.html': 'text/html; charset=utf-8',
         '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'}


class Source:
    """where the files are: the installation and its prepared data"""

    def __init__(self, game=None, data=None):
        game = game or Settings().get('install') or ''
        self.install = None
        self.error = None
        try:
            self.install = Install(game) if game else None
        except (ValueError, OSError) as e:
            self.error = str(e)
        if data:
            self.data = os.path.abspath(data)
        elif self.install:
            key = '%08x' % (zlib.crc32(self.install.data.lower().encode('utf-8')) & 0xffffffff)
            self.data = os.path.join(home(), 'remake', key)
        else:
            self.data = None

    def info(self):
        if not self.install:
            return {'ready': False, 'reason': self.error or 'The ParaWorld folder is not set. Start the ParaWorld Toolkit once and choose it there.'}
        ok = bool(self.data) and os.path.isfile(os.path.join(self.data, 'assets', 'manifest.json'))
        return {'ready': ok, 'game': self.install.root, 'data': self.data,
                'reason': None if ok else 'The game data is not prepared yet. Start the ParaWorld Toolkit and press '
                                          '"Prepare the game data" in the Remake card, then start the shooter again.'}

    def resolve(self, rel):
        """file for the URL path below /, or None"""
        rel = rel.lstrip('/') or 'index.html'
        parts = rel.replace('\\', '/').split('/')
        if '..' in parts:
            return None
        if parts[0] == 'vendor':
            return _file(os.path.join(VENDOR, *parts[1:]))
        if parts[0] == 'data':
            return self._data(parts[1:])
        return _file(os.path.join(WEB, *parts))

    def _data(self, parts):
        inst = self.install
        if not parts or not self.data:
            return None
        if parts[0] == 'maps' and inst and len(parts) >= 3:
            d = _ci_join(inst.data, parts[1])
            return _file(_ci_join(d, 'Maps/' + '/'.join(parts[2:])) if d else None)
        if parts[0] in ('gamedata.json', 'techtree.json') and len(parts) == 1:
            return _file(os.path.join(self.data, parts[0]))
        if parts[0] == 'assets':
            p = _file(os.path.join(self.data, *parts))
            if p or not inst or len(parts) < 3:
                return p
            if parts[1] == 'snd':
                return inst.file('Audio/Sound/' + '/'.join(parts[2:]))
            if parts[1] == 'music':
                return inst.file('Audio/Music/' + '/'.join(parts[2:]))
        return None


def _file(p):
    return p if p and os.path.isfile(p) else None


class Logs:
    """the game's log files: one per page session, written line by line as they arrive"""
    KEEP = 30                 # files kept
    SILENT = 30               # seconds without a word from a running page before the watchdog writes a note

    def __init__(self, folder):
        self.dir = folder
        self.lock = threading.Lock()
        self.sessions = {}    # sid -> {file, seen, closed, warned}
        try:
            os.makedirs(folder, exist_ok=True)
            old = sorted(f for f in os.listdir(folder) if f.startswith('shooter-') and f.endswith('.log'))
            for f in old[:-self.KEEP]:
                os.remove(os.path.join(folder, f))
        except OSError:
            pass
        t = threading.Thread(target=self._watch, daemon=True)
        t.start()

    @staticmethod
    def _sid(sid):
        return ''.join(c for c in (sid or '') if c.isalnum())[:24] or 'nosid'

    def write(self, sid, text):
        sid = self._sid(sid)
        with self.lock:
            s = self.sessions.get(sid)
            if not s:
                name = 'shooter-%s-%s.log' % (time.strftime('%Y%m%d-%H%M%S'), sid)
                s = self.sessions[sid] = {'file': os.path.join(self.dir, name), 'seen': 0, 'closed': False, 'warned': False}
                print('  log file     : %s' % s['file'])
            s['seen'] = time.time()
            s['warned'] = False
            if 'PAGE CLOSED' in text:
                s['closed'] = True
            elif text.strip():
                s['closed'] = False                      # (a page that went into the background and came back)
            self._append(s['file'], text)
            return s['file']

    def _append(self, path, text):
        try:
            with open(path, 'a', encoding='utf-8') as f:
                f.write(text if text.endswith('\n') else text + '\n')
        except OSError:
            pass

    def note(self, text):
        """a line from the server itself, into every running session's file"""
        with self.lock:
            for s in self.sessions.values():
                if not s['closed']:
                    self._append(s['file'], '%s SERVER  %s' % (time.strftime('%H:%M:%S'), text))

    def _watch(self):
        while True:
            time.sleep(5)
            now = time.time()
            with self.lock:
                for s in self.sessions.values():
                    if not s['closed'] and not s['warned'] and s['seen'] and now - s['seen'] > self.SILENT:
                        s['warned'] = True
                        self._append(s['file'], '%s SERVER  !! nothing heard from the game page for %d s and it never said it was closing: '
                                     'the browser window crashed, froze or was killed (a tab left in the background for minutes can also go quiet)'
                                     % (time.strftime('%H:%M:%S'), self.SILENT))

    def last(self, not_sid):
        """the newest log that is not the given session's: {file, closed, tail}"""
        not_sid = self._sid(not_sid)
        try:
            files = sorted(f for f in os.listdir(self.dir) if f.startswith('shooter-') and f.endswith('.log') and not f.endswith('-%s.log' % not_sid))
        except OSError:
            files = []
        if not files:
            return {'file': None}
        path = os.path.join(self.dir, files[-1])
        try:
            with open(path, encoding='utf-8', errors='replace') as f:
                lines = f.read().splitlines()
        except OSError:
            return {'file': None}
        closed = any('PAGE CLOSED' in ln for ln in lines[-6:])
        return {'file': path, 'closed': closed, 'tail': lines[-25:], 'dir': self.dir}


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def __init__(self, *a, source=None, logs=None, **k):
        self.source = source
        self.logs = logs
        super().__init__(*a, **k)

    def log_message(self, *a):          # quiet: the browser console shows what is missing
        pass

    def do_GET(self):
        rel = unquote(self.path.split('?')[0]).lstrip('/')
        if rel == 'api/info':
            return self._send(json.dumps(dict(self.source.info(), logs=self.logs.dir if self.logs else None)).encode(), 'application/json', cache=False)
        if rel == 'api/lastlog':
            return self._send(json.dumps(self.logs.last(self._query('sid')) if self.logs else {'file': None}).encode(), 'application/json', cache=False)
        try:
            self._get(rel)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:                                   # a bug here must be seen in the log, not vanish
            if self.logs:
                self.logs.note('server error while sending %s:\n%s' % (rel, traceback.format_exc()))
            raise

    def _query(self, key):
        q = self.path.split('?', 1)[1] if '?' in self.path else ''
        for part in q.split('&'):
            if part.startswith(key + '='):
                return unquote(part[len(key) + 1:])
        return ''

    def do_POST(self):
        rel = unquote(self.path.split('?')[0]).lstrip('/')
        try:
            n = min(int(self.headers.get('Content-Length') or 0), 1 << 20)
        except ValueError:
            n = 0
        body = self.rfile.read(n) if n else b''
        if rel != 'api/log' or not self.logs:
            return self._send(b'not found', 'text/plain', 404, cache=False)
        path = self.logs.write(self._query('sid'), body.decode('utf-8', 'replace'))
        self._send(json.dumps({'file': path}).encode(), 'application/json', cache=False)

    def _get(self, rel):
        p = self.source.resolve(rel)
        if not p:
            return self._send(b'not found', 'text/plain', 404, cache=False)
        ext = os.path.splitext(p)[1].lower()
        with open(p, 'rb') as f:
            body = f.read()
        # game code is never cached (edit a file, reload the page); the game's own files may be
        self._send(body, TYPES.get(ext) or mimetypes.guess_type(p)[0] or 'application/octet-stream',
                   cache=rel.startswith('data/assets/') or rel.startswith('vendor/'))

    def _send(self, body, ctype, code=200, cache=False):
        try:
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'max-age=3600' if cache else 'no-store')
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


def free_port(first=8430):
    for port in range(first, first + 50):
        with socket.socket() as s:
            try:
                s.bind(('127.0.0.1', port))
                return port
            except OSError:
                continue
    return 0


def serve(port=0, browser=True, game=None, data=None):
    src = Source(game, data)
    port = port or free_port()
    logs = Logs(os.path.join(home(), 'shooter', 'logs'))
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Handler, source=src, logs=logs))
    url = 'http://127.0.0.1:%d/' % srv.server_address[1]
    info = src.info()
    print('ParaWorld shooter: %s' % url)
    print('  game folder  : %s' % (info.get('game') or '-'))
    print('  prepared data: %s%s' % (info.get('data') or '-', '' if info['ready'] else '   (NOT READY: %s)' % info['reason']))
    print('  logs         : %s' % logs.dir)
    print('Close this window to stop.')
    if browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    except Exception:
        logs.note('the server stopped with an error:\n%s' % traceback.format_exc())
        raise


def main():
    ap = argparse.ArgumentParser(prog='shooter', description='ParaWorld shooter (third-person action game with the assets of ParaWorld)')
    ap.add_argument('--port', type=int, default=0, help='port of the local server (default: first free from 8430)')
    ap.add_argument('--no-browser', action='store_true', help='do not open the browser')
    ap.add_argument('--game', help='ParaWorld folder (default: the one chosen in the toolkit)')
    ap.add_argument('--data', help='prepared game data folder (default: the toolkit\'s own for that installation)')
    a = ap.parse_args()
    serve(a.port, not a.no_browser, a.game, a.data)


if __name__ == '__main__':
    main()
