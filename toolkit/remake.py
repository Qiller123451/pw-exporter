"""The remake as the launcher serves it: its game data (built from the player's installation by remake/pipeline,
stored in <toolkit home>/remake/<installation id>/), the game code (remake/game: index.html + game.js) and the
files it reads straight from the game folder (maps, music, sound effects).

URL layout below /remake/ (the game only uses relative URLs, so it runs from any folder):
    index.html, game.js, ...      remake/game/
    gamedata.json, techtree.json  built data
    assets/snd/<path>             Data/<mod>/Audio/Sound/<path> of the installation (or built data)
    assets/music/<file>           Data/<mod>/Audio/Music/<file>
    assets/...                    built data
    maps/index.json               every map of the installation: [{path: "maps/<pack>/<rel>", size}]
    maps/<pack>/<rel>             Data/<pack>/Maps/<rel>
"""
import os
import sys
import threading
import time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GAME = os.path.join(ROOT, 'remake', 'game')
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from pwexport.config import home            # noqa: E402
from pwexport.install import _ci_join       # noqa: E402


class Remake:
    def __init__(self, app):
        self.app = app                       # the exporter app (settings, install)
        self.lock = threading.Lock()
        self.job = None                      # {'stage', 'frac', 'log': [...], 'running', 'error'}

    # ---------------------------------------------------------------- where
    def out_dir(self):
        inst = self.app.install
        if not inst:
            return None
        key = '%08x' % (zlib.crc32(inst.data.lower().encode('utf-8')) & 0xffffffff)
        d = os.path.join(home(), 'remake', key)
        os.makedirs(d, exist_ok=True)
        return d

    def state(self):
        from remake import pipeline
        out = self.out_dir()
        st = {'code': os.path.exists(os.path.join(GAME, 'game.js')), 'out': out}
        if not out:
            st.update(ready=False, reason='no installation')
            return st
        job = self.job
        if job and job.get('running'):
            st.update(ready=False, building=True, stage=job['stage'], frac=job['frac'], log=job['log'][-6:],
                      elapsed=round(time.time() - job['t0']))
            return st
        s = pipeline.status(self.app.install.data, out)
        st.update(ready=s['ready'], reason=s.get('reason'), built=s.get('built'))
        if job and job.get('error'):
            st['error'] = job['error']; st['log'] = job['log'][-30:]
        return st

    def build(self):
        with self.lock:
            if self.job and self.job.get('running'):
                return False
            if not self.app.install:
                raise ValueError('no installation')
            self.job = {'stage': 'starting', 'frac': 0.0, 'log': [], 'running': True, 'error': None, 't0': time.time()}
        threading.Thread(target=self._run, daemon=True).start()
        return True

    def _run(self):
        from remake import pipeline
        job = self.job

        def prog(stage, f):
            job['stage'], job['frac'] = stage, f

        def log(s):
            job['log'].append(s)
            if len(job['log']) > 400:
                del job['log'][:100]
        try:
            rec = pipeline.build(self.app.install.data, self.out_dir(), progress=prog, log=log)
            if not rec.get('ok'):
                job['error'] = rec.get('error') or 'failed'
        except Exception as e:                  # noqa: BLE001
            job['error'] = str(e)
        job['running'] = False

    # ---------------------------------------------------------------- files
    def resolve(self, rel):
        """path of the file for /remake/<rel>, or None"""
        rel = rel.lstrip('/') or 'index.html'
        if '..' in rel.replace('\\', '/').split('/'):
            return None
        inst = self.app.install
        out = self.out_dir()
        if rel.startswith('maps/') and inst:
            parts = rel.split('/')
            if len(parts) >= 3:
                pack, sub = parts[1], '/'.join(parts[2:])
                d = _ci_join(inst.data, pack)
                p = _ci_join(d, 'Maps/' + sub) if d else None
                if p and os.path.isfile(p):
                    return p
                # older links without the pack: look in every pack
                for e in inst.maps():
                    if e['rel'].lower() == '/'.join(parts[1:]).lower():
                        return e['path']
            return None
        if rel.startswith('assets/') and out:
            p = os.path.join(out, rel)
            if os.path.isfile(p):
                return p
            if inst and rel.startswith('assets/snd/'):
                return inst.file('Audio/Sound/' + rel[len('assets/snd/'):])
            if inst and rel.startswith('assets/music/'):
                return inst.file('Audio/Music/' + rel[len('assets/music/'):])
            return None
        if rel in ('gamedata.json', 'techtree.json') and out:
            p = os.path.join(out, rel)
            return p if os.path.isfile(p) else None
        p = os.path.join(GAME, rel)
        return p if os.path.isfile(p) else None

    def maps_index(self):
        inst = self.app.install
        if not inst:
            return []
        return [{'path': 'maps/%s/%s' % (e['pack'], e['rel']), 'size': e['size']} for e in inst.maps()]
