"""The remake as the launcher serves it: its game data (built from the player's installation by remake/pipeline,
stored in <toolkit data>/remake/<installation id>/: pwexport/config.py data_home), the game code (remake/game:
index.html + game.js) and the files it reads straight from the game folder (maps, music, sound effects).

Configurations: the official game (Base + BoosterPack1) is served under /remake/, a mod with everything it requires
(pwexport/mods.py: MIRAGE = Base + BoosterPack3 + MIRAGE) under /remake/mod/<id>/ - the same game code with that
configuration's own data, built on first use into <toolkit data>/remake/<installation id>@<id>/. The base data is
never touched by a mod build. Methods take the configuration as `mod` ('' = the official game).

URL layout below /remake/ and /remake/mod/<id>/ (the game only uses relative URLs, so it runs from any folder):
    index.html, game.js, ...      remake/game/
    gamedata.json, techtree.json  built data
    help.json                     built data: the in-game help (Texts/Help, remake/pipeline/build_data.py help_book)
    ai.json                       built data: the computer player's tables (remake/pipeline/build_ai.py; made on
                                  first use when the data was built before that step existed)
    forest.json                   built data: tree layouts of forest blocks (remake/pipeline/build_forest.py; likewise)
    assets/snd/<path>             Data/<mod>/Audio/Sound/<path> of the installation (or built data; speech kept only
                                  in a language pack: Data/locale/<lang>/Audio/..., pwexport.install.audio_file)
    assets/music/<file>           Data/<mod>/Audio/Music/<file>
    assets/SeqSounds/<path>       Data/<mod>/Audio/SeqSounds/<path> (speech of dialogue scenes and sequences)
    assets/...                    built data
    maps/index.json               every map of the installation: [{path: "maps/<pack>/<rel>", size, players, modes, type}]
                                  (players / modes / type: Root/Base MaxPlayers, GameType, MapType - pwexport.ula.mp_header)
    maps/<pack>/<rel>             Data/<pack>/Maps/<rel>
    campaign/index.json           the campaign missions in playing order: [{id, key, map: "maps/<pack>/<rel>",
                                  data: "campaign/<pack>/<rel>.json", name, title, description, tribe, point_buy,
                                  min_credits (the army budget: Campaigns.txt PB_Available, MinCredits)}]
    campaign/<pack>/<rel>.json    a map's mission data (pwexport.campaign: players, objects, triggers, quests, texts ...,
                                  docs/CAMPAIGN_FORMAT.md §10), made on first use and kept in <built data>/campaign/
    assets/video/<film>.webm      the story films (Bink, Data/locale/<lang>/Video) converted to WebM by pwexport.video:
                                  all of them in the background when the campaign menu first asks for its missions
"""
import os
import shutil
import sys
import threading
import time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GAME = os.path.join(ROOT, 'remake', 'game')
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from pwexport.config import data_home       # noqa: E402
from pwexport.install import _ci_join       # noqa: E402


NEED_GB = 4                                 # free space a first build wants: ~2 GB of data, its conversions, the films


class Remake:
    def __init__(self, app):
        self.app = app                       # the exporter app (settings, install)
        self.lock = threading.Lock()
        self.jobs = {}                       # mod -> {'stage', 'frac', 'log': [...], 'running', 'error', 't0'}
        self.film_jobs = {}                  # mod -> {'film', 'i', 'total', 'running', 'done', 'error'}
        self._insts = {}                     # (root, mod) -> the configuration's installation
        self.paused = lambda: False          # True while the data folder moves (toolkit/datadir.py): nothing is built

    # ---------------------------------------------------------------- configurations
    def _root(self):
        inst = getattr(self.app, 'official', None) or self.app.install
        return inst.root if inst else None

    def inst(self, mod=''):
        """the installation as the remake reads it in a configuration: its Data folders and their model archives
        only (remake.pipeline.paths.install), whatever mod the exporter is showing. None without an installation or
        for an unknown mod."""
        root = self._root()
        if not root:
            return None
        key = (root, mod)
        if key not in self._insts:
            from remake.pipeline import paths
            if mod and mod not in {c['id'] for c in self.configs(with_state=False)}:
                return None
            self._insts[key] = paths.install(root, mod)
        return self._insts[key]

    def configs(self, with_state=True):
        """what the campaign menu offers: the official game and every mod configuration that differs from it
        (Booster Pack 1 is part of the official game): [{'id', 'name', 'version', 'folders', 'url', 'built'}]"""
        from pwexport.install import Install
        from pwexport.mods import ModInstall
        root = self._root()
        if not root:
            return []
        official = Install(root).mods
        rows = [{'id': '', 'name': 'ParaWorld', 'version': '', 'folders': official, 'url': '/remake/'}]
        for c in ModInstall(root).configurations():
            if c['id'] and [f.lower() for f in c['folders']] != [f.lower() for f in official]:
                rows.append({'id': c['id'], 'name': c['name'], 'version': c['version'], 'folders': c['folders'],
                             'url': '/remake/mod/%s/' % c['id']})
        if with_state:
            for r in rows:
                r['built'] = self._built(r['id'])
                r['building'] = bool((self.jobs.get(r['id']) or {}).get('running'))
        return rows

    # ---------------------------------------------------------------- where
    def out_dir(self, mod=''):
        """<toolkit data>/remake/<installation id> for the official game, ...@<mod> for a mod configuration"""
        inst = self.inst(mod)
        if not inst:
            return None
        key = '%08x' % (zlib.crc32(inst.data.lower().encode('utf-8')) & 0xffffffff)
        return os.path.join(data_home(), 'remake', key + ('@' + mod if mod else ''))     # made by the first build

    def _built(self, mod):
        """a finished build of this toolkit version exists (cheap: no fingerprints; state() checks it fully)"""
        import json
        from remake import pipeline
        out = self.out_dir(mod)
        try:
            with open(os.path.join(out, 'build.json'), encoding='utf-8') as fh:
                b = json.load(fh)
        except (OSError, ValueError, TypeError):
            return False
        return b.get('ok') is True and b.get('version') == pipeline.ASSET_VERSION

    def state(self, mod=''):
        from remake import pipeline
        out = self.out_dir(mod)
        st = {'code': os.path.exists(os.path.join(GAME, 'game.js')), 'out': out, 'mod': mod}
        if not out:
            st.update(ready=False, reason='no installation' if not self._root() else 'unknown mod')
            return st
        job = self.jobs.get(mod)
        if job and job.get('running'):
            st.update(ready=False, building=True, stage=job['stage'], frac=job['frac'], log=job['log'][-6:],
                      elapsed=round(time.time() - job['t0']))
            return st
        s = pipeline.status(self.inst(mod).data, out, mod)
        st.update(ready=s['ready'], reason=s.get('reason'), built=s.get('built'), todo=s.get('todo'))
        if mod in self.film_jobs:
            st['films'] = dict(self.film_jobs[mod])
        if job and job.get('error'):
            st['error'] = job['error']; st['log'] = job['log'][-30:]
        return st

    def build(self, force=False, mod=''):
        """build what is out of date of a configuration in the background (force: everything again). One build
        runs at a time (a build uses every core and a lot of memory): False while another one runs."""
        with self.lock:
            if any(j.get('running') for j in self.jobs.values()) or self.paused():
                return False
            if not self.inst(mod):
                raise ValueError('no installation' if not self._root() else 'unknown mod: %s' % mod)
            need = (1 if self._built(mod) and not force else NEED_GB) << 30
            free = shutil.disk_usage(data_home()).free
            if free < need:                     # a full drive breaks the build halfway (and everything else on it)
                self.jobs[mod] = {'stage': 'failed', 'frac': 0.0, 'log': [], 'running': False, 't0': time.time(),
                                  'error': 'only %.1f GB free on the drive of the toolkit data (%s); preparing the game data '
                                           'needs about %d GB. Move the toolkit data to another drive (Toolkit data: Change).'
                                           % (free / (1 << 30), data_home(), need >> 30)}
                return False
            self.jobs[mod] = {'stage': 'starting', 'frac': 0.0, 'log': [], 'running': True, 'error': None, 't0': time.time()}
        threading.Thread(target=self._run, args=(force, mod), daemon=True).start()
        return True

    def building(self):
        """a data build runs"""
        return any(j.get('running') for j in self.jobs.values())

    def converting(self):
        """a film conversion runs (it stops after the current film when paused)"""
        return any(j.get('running') for j in self.film_jobs.values())

    def _run(self, force=False, mod=''):
        from remake import pipeline
        job = self.jobs[mod]

        def prog(stage, f):
            job['stage'], job['frac'] = stage, f

        def log(s):
            job['log'].append(s)
            if len(job['log']) > 400:
                del job['log'][:100]
        try:
            rec = pipeline.build(self.inst(mod).data, self.out_dir(mod), progress=prog, log=log, force=force, mod=mod)
            if not rec.get('ok'):
                job['error'] = rec.get('error') or 'failed'
        except Exception as e:                  # noqa: BLE001
            job['error'] = str(e)
        job['running'] = False

    # ---------------------------------------------------------------- films
    def films(self, mod=''):
        """convert the story films of the configuration in the background (once; pwexport.video). Runs when no data
        build runs, one film after the other; the game plays a film when its WebM exists, else shows its subtitles."""
        out = self.out_dir(mod)
        if not out or not self._built(mod) or self.paused():
            return False
        with self.lock:
            j = self.film_jobs.get(mod)
            if j and (j.get('running') or j.get('finished')):
                return False
            j = self.film_jobs[mod] = {'film': '', 'i': 0, 'total': 0, 'running': True, 'done': 0, 'error': None}
        threading.Thread(target=self._films, args=(mod, j), daemon=True).start()
        return True

    def _films(self, mod, j):
        from pwexport import video
        lang = self._lang()

        def prog(n, i, t):
            j['film'], j['i'], j['total'] = n, i, t
        try:
            while any(x.get('running') for x in self.jobs.values()):
                time.sleep(5)                       # a data build uses every core
            j['done'], j['total'] = video.convert_all(self.inst(mod), os.path.join(self.out_dir(mod), 'assets', 'video'), lang,
                                                      log=lambda s: j.update(error=s), progress=prog,
                                                      stop=lambda: self.paused() or any(x.get('running') for x in self.jobs.values()))
            j['finished'] = True
        except Exception as e:                      # noqa: BLE001
            j['error'] = str(e)
        j['running'] = False

    # ---------------------------------------------------------------- files
    def resolve(self, rel, mod=''):
        """path of the file for /remake/<rel> (/remake/mod/<mod>/<rel>), or None"""
        rel = rel.lstrip('/') or 'index.html'
        if '..' in rel.replace('\\', '/').split('/'):
            return None
        inst = self.inst(mod)
        out = self.out_dir(mod)
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
                return inst.audio_file('Audio/Sound/' + rel[len('assets/snd/'):], self._lang())
            # speech of dialogue scenes and sequences: dialogsounds.txt names '../SeqSounds/<..>.mp3' relative to Audio/Sound,
            # so the browser asks for assets/snd/../SeqSounds/<..> = assets/SeqSounds/<..> (remake/src/ui/mission.js)
            if inst and rel.lower().startswith('assets/seqsounds/'):
                return inst.audio_file('Audio/SeqSounds/' + rel[len('assets/seqsounds/'):], self._lang())
            if inst and rel.startswith('assets/music/'):
                return inst.file('Audio/Music/' + rel[len('assets/music/'):])
            return None
        if rel.startswith('campaign/') and inst and out:
            return self.campaign_file(rel[len('campaign/'):], mod)
        if rel in ('gamedata.json', 'techtree.json', 'ai.json', 'forest.json', 'help.json') and out:
            p = os.path.join(out, rel)
            if rel in ('ai.json', 'forest.json') and inst and not os.path.isfile(p):
                self._build_small(out, rel, mod)
            return p if os.path.isfile(p) else None
        p = os.path.join(GAME, rel)
        return p if os.path.isfile(p) else None

    def _build_small(self, out, rel, mod=''):
        """ai.json / forest.json for a data folder that predates the pipeline's 'ai' / 'forest' step (a second of
        work, no other step runs)"""
        with self.lock:
            if os.path.isfile(os.path.join(out, rel)) or any(j.get('running') for j in self.jobs.values()):
                return
            try:
                from remake.pipeline import build_ai, build_forest, paths
                paths.configure(self.inst(mod).data, out, mod=mod)
                (build_ai if rel == 'ai.json' else build_forest).run(log=lambda *a: None)
            except Exception as e:                  # noqa: BLE001  (the game falls back: built-in AI tables, no forest trees)
                sys.stderr.write('%s: %s\n' % (rel, e))

    def maps_index(self, mod=''):
        inst = self.inst(mod)
        if not inst:
            return []
        return [dict({'path': 'maps/%s/%s' % (e['pack'], e['rel']), 'size': e['size']}, **self._map_header(e['path'])) for e in inst.maps()]

    _headers = {}                            # path -> (size, mtime, header): read once per map file

    def _map_header(self, path):
        """a map's players, game modes and type (pwexport.ula.mp_header) for the skirmish list; {} when unreadable"""
        from pwexport import ula
        try:
            st = os.stat(path)
            key = (st.st_size, st.st_mtime)
            hit = Remake._headers.get(path)
            if hit and hit[0] == key:
                return hit[1]
            h = ula.mp_header(path)
        except Exception:                    # not a readable map: listed without them
            return {}
        Remake._headers[path] = (key, h)
        return h

    # ---------------------------------------------------------------- campaign
    def _lang(self):
        return (getattr(self.app, 'settings', None) or {}).get('lang') or 'uk'

    def _map_path(self, pack, sub, mod=''):
        d = _ci_join(self.inst(mod).data, pack)
        p = _ci_join(d, 'Maps/' + sub) if d else None
        return p if p and os.path.isfile(p) else None

    def campaign_file(self, rel, mod=''):
        """campaign/<rel> -> path of the cached file: index.json (rebuilt hourly) or <pack>/<map rel>.json = the
        mission data of that map (built when missing or older than the map or the exporter)"""
        import json
        from pwexport import campaign as C
        lang = self._lang()
        out = os.path.join(self.out_dir(mod), 'campaign', C.SCHEMA.replace('/', '_'), lang)
        if rel == 'index.json':
            self.films(mod)                         # the campaign menu is open: the films are converted meanwhile
            f = os.path.join(out, 'index.json')
            with self.lock:
                if not os.path.isfile(f) or time.time() - os.path.getmtime(f) > 3600:
                    os.makedirs(out, exist_ok=True)
                    with open(f + '.tmp', 'w', encoding='utf-8') as fh:
                        json.dump(self.campaign_index(mod), fh, ensure_ascii=False)
                    os.replace(f + '.tmp', f)
            return f
        if not rel.endswith('.json'):
            return None
        parts = rel[:-5].split('/')
        if len(parts) < 2:
            return None
        src = self._map_path(parts[0], '/'.join(parts[1:]), mod)
        if not src:
            return None
        f = os.path.join(out, *parts) + '.json'
        with self.lock:
            newest = max(os.path.getmtime(src), os.path.getmtime(C.__file__))
            if not os.path.isfile(f) or os.path.getmtime(f) < newest:
                os.makedirs(os.path.dirname(f), exist_ok=True)
                data = C.campaign(src, self.inst(mod), lang)
                with open(f + '.tmp', 'w', encoding='utf-8') as fh:
                    json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))
                os.replace(f + '.tmp', f)
        return f

    def campaign_index(self, mod=''):
        """the single player campaign in playing order (pwexport.campaign.campaign_maps), with the localised mission
        titles and descriptions. Only each map's level info is read (0.3 s for the 17 missions), not the mission."""
        from pwexport import campaign as C, ula
        inst = self.inst(mod)
        tx = C.TextTable(inst, self._lang())
        res = []
        for e in C.campaign_maps(inst):
            r = {'id': e['id'], 'key': e['key'], 'map': 'maps/%s/%s' % (e['pack'], e['rel']),
                 'data': 'campaign/%s/%s.json' % (e['pack'], e['rel']), 'name': os.path.splitext(e['file'])[0],
                 'title': '', 'description': '', 'tribe': '', 'point_buy': e['point_buy'], 'min_credits': e['min_credits']}
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
