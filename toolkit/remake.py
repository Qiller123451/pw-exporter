"""The remake as the launcher serves it: its game data (built from the player's installation by remake/pipeline,
stored in <toolkit home>/remake/<installation id>/), the game code (remake/game: index.html + game.js) and the
files it reads straight from the game folder (maps, music, sound effects).

URL layout below /remake/ (the game only uses relative URLs, so it runs from any folder):
    index.html, game.js, ...      remake/game/
    gamedata.json, techtree.json  built data
    ai.json                       built data: the computer player's tables (remake/pipeline/build_ai.py; made on
                                  first use when the data was built before that step existed)
    assets/snd/<path>             Data/<mod>/Audio/Sound/<path> of the installation (or built data)
    assets/music/<file>           Data/<mod>/Audio/Music/<file>
    assets/SeqSounds/<path>       Data/<mod>/Audio/SeqSounds/<path> (speech of dialogue scenes and sequences)
    assets/...                    built data
    maps/index.json               every map of the installation: [{path: "maps/<pack>/<rel>", size}]
    maps/<pack>/<rel>             Data/<pack>/Maps/<rel>
    campaign/index.json           the campaign missions in playing order: [{id, key, map: "maps/<pack>/<rel>",
                                  data: "campaign/<pack>/<rel>.json", name, title, description, tribe, point_buy}]
    campaign/<pack>/<rel>.json    a map's mission data (pwexport.campaign: players, objects, triggers, quests, texts ...,
                                  docs/CAMPAIGN_FORMAT.md §10), made on first use and kept in <built data>/campaign/
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
        st.update(ready=s['ready'], reason=s.get('reason'), built=s.get('built'), todo=s.get('todo'))
        if job and job.get('error'):
            st['error'] = job['error']; st['log'] = job['log'][-30:]
        return st

    def build(self, force=False):
        """build what is out of date in the background (force: everything again)"""
        with self.lock:
            if self.job and self.job.get('running'):
                return False
            if not self.app.install:
                raise ValueError('no installation')
            self.job = {'stage': 'starting', 'frac': 0.0, 'log': [], 'running': True, 'error': None, 't0': time.time()}
        threading.Thread(target=self._run, args=(force,), daemon=True).start()
        return True

    def _run(self, force=False):
        from remake import pipeline
        job = self.job

        def prog(stage, f):
            job['stage'], job['frac'] = stage, f

        def log(s):
            job['log'].append(s)
            if len(job['log']) > 400:
                del job['log'][:100]
        try:
            rec = pipeline.build(self.app.install.data, self.out_dir(), progress=prog, log=log, force=force)
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
            # speech of dialogue scenes and sequences: dialogsounds.txt names '../SeqSounds/<..>.mp3' relative to Audio/Sound,
            # so the browser asks for assets/snd/../SeqSounds/<..> = assets/SeqSounds/<..> (remake/src/ui/mission.js)
            if inst and rel.lower().startswith('assets/seqsounds/'):
                return inst.file('Audio/SeqSounds/' + rel[len('assets/seqsounds/'):])
            if inst and rel.startswith('assets/music/'):
                return inst.file('Audio/Music/' + rel[len('assets/music/'):])
            return None
        if rel.startswith('campaign/') and inst and out:
            return self.campaign_file(rel[len('campaign/'):])
        if rel in ('gamedata.json', 'techtree.json', 'ai.json') and out:
            p = os.path.join(out, rel)
            if rel == 'ai.json' and inst and not os.path.isfile(p):
                self._build_ai(out)
            return p if os.path.isfile(p) else None
        p = os.path.join(GAME, rel)
        return p if os.path.isfile(p) else None

    def _build_ai(self, out):
        """ai.json for a data folder that predates the pipeline's 'ai' step (a second of work, no other step runs)"""
        with self.lock:
            if os.path.isfile(os.path.join(out, 'ai.json')) or (self.job and self.job.get('running')):
                return
            try:
                from remake.pipeline import build_ai, paths
                paths.configure(self.app.install.data, out)
                build_ai.run(log=lambda *a: None)
            except Exception as e:                  # noqa: BLE001  (the game falls back to its built-in tables)
                sys.stderr.write('ai.json: %s\n' % e)

    def maps_index(self):
        inst = self.app.install
        if not inst:
            return []
        return [{'path': 'maps/%s/%s' % (e['pack'], e['rel']), 'size': e['size']} for e in inst.maps()]

    # ---------------------------------------------------------------- campaign
    def _lang(self):
        return (getattr(self.app, 'settings', None) or {}).get('lang') or 'uk'

    def _map_path(self, pack, sub):
        d = _ci_join(self.app.install.data, pack)
        p = _ci_join(d, 'Maps/' + sub) if d else None
        return p if p and os.path.isfile(p) else None

    def campaign_file(self, rel):
        """campaign/<rel> -> path of the cached file: index.json (rebuilt hourly) or <pack>/<map rel>.json = the
        mission data of that map (built when missing or older than the map or the exporter)"""
        import json
        from pwexport import campaign as C
        lang = self._lang()
        out = os.path.join(self.out_dir(), 'campaign', C.SCHEMA.replace('/', '_'), lang)
        if rel == 'index.json':
            f = os.path.join(out, 'index.json')
            with self.lock:
                if not os.path.isfile(f) or time.time() - os.path.getmtime(f) > 3600:
                    os.makedirs(out, exist_ok=True)
                    with open(f + '.tmp', 'w', encoding='utf-8') as fh:
                        json.dump(self.campaign_index(), fh, ensure_ascii=False)
                    os.replace(f + '.tmp', f)
            return f
        if not rel.endswith('.json'):
            return None
        parts = rel[:-5].split('/')
        if len(parts) < 2:
            return None
        src = self._map_path(parts[0], '/'.join(parts[1:]))
        if not src:
            return None
        f = os.path.join(out, *parts) + '.json'
        with self.lock:
            newest = max(os.path.getmtime(src), os.path.getmtime(C.__file__))
            if not os.path.isfile(f) or os.path.getmtime(f) < newest:
                os.makedirs(os.path.dirname(f), exist_ok=True)
                data = C.campaign(src, self.app.install, lang)
                with open(f + '.tmp', 'w', encoding='utf-8') as fh:
                    json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))
                os.replace(f + '.tmp', f)
        return f

    def campaign_index(self):
        """the single player campaign in playing order (pwexport.campaign.campaign_maps), with the localised mission
        titles and descriptions. Only each map's level info is read (0.3 s for the 17 missions), not the mission."""
        from pwexport import campaign as C, ula
        inst = self.app.install
        tx = C.TextTable(inst, self._lang())
        res = []
        for e in C.campaign_maps(inst):
            r = {'id': e['id'], 'key': e['key'], 'map': 'maps/%s/%s' % (e['pack'], e['rel']),
                 'data': 'campaign/%s/%s.json' % (e['pack'], e['rel']), 'name': os.path.splitext(e['file'])[0],
                 'title': '', 'description': '', 'tribe': '', 'point_buy': e['point_buy']}
            try:
                with open(e['path'], 'rb') as fh:
                    surf = ula.unpack(fh.read())
                li = None

                def find(c):
                    nonlocal li
                    for ch in c.children:
                        if ch.tag == 'LInf' and ch.data is not None and li is None:
                            li = ula.level_info(ch.data)
                        find(ch)
                find(ula.read_tree(surf, 0))
                d = (li or {}).get('description') or {}
                r['name'] = d.get('Root/Base/LevelName') or d.get('LevelName') or r['name']
                r['title'] = tx.get(r['name'], r['name'])
                key = d.get('Root/Base/Description') or ''
                r['description'] = tx.get(key, '') if key else ''
                r['tribe'] = (d.get('Root/PlayerSettings/Player_0/Restrictions/Base/Tribes') or '').split(':')[0]
            except (OSError, ValueError, KeyError, IndexError) as ex:
                r['error'] = str(ex)
            res.append(r)
        return res
