"""Where the toolkit keeps its data (the conversion cache and the remake's game data, several gigabytes): the launcher's
"Toolkit data: Change" moves it to another folder, e.g. onto the drive ParaWorld is on (pwexport/config.py data_home,
move_data). The settings stay in the toolkit's home folder.

    GET  /api/toolkit/data[?size=1]  {path, home, env, moving, error[, size, free]}
    POST /api/toolkit/data           {path} -> {ok, error}: moves the data there in the background
"""
import os
import shutil
import threading
import time

from pwexport import config


class DataFolder:
    def __init__(self, app, remake):
        self.app = app                  # the exporter app: its settings object is the one that gets saved
        self.remake = remake
        self.job = None                 # {'to', 'stage': waiting | moving, 'done', 'total' (bytes), 'file', 'running', 'error'}

    def state(self, size=False):
        d = config.data_home()
        st = {'path': d, 'home': config.home(), 'env': bool(os.environ.get('PWTOOLKIT_DATA')),
              'moving': dict(self.job) if self.job and self.job['running'] else None,
              'error': self.job.get('error') if self.job and not self.job['running'] else None}
        if size:
            st['size'] = config.data_size(d)
            st['free'] = shutil.disk_usage(d).free
        return st

    def busy(self):
        return bool(self.job and self.job['running'])

    def move(self, path):
        """start moving the data into path; (False, why) when that cannot be done now"""
        if os.environ.get('PWTOOLKIT_DATA'):
            return False, 'the environment variable PWTOOLKIT_DATA sets the data folder'
        path = os.path.abspath(os.path.expanduser(path or ''))
        why = config.check_data_dir(path)
        if why:
            return False, why
        with self.remake.lock:                      # no data build starts meanwhile (Remake.paused)
            if self.busy():
                return False, 'the data is being moved already'
            if self.remake.building():
                return False, 'the game data is being prepared: try again when that is done'
            self.job = {'to': path, 'stage': 'waiting', 'done': 0, 'total': 0, 'file': '', 'running': True, 'error': None}
        threading.Thread(target=self._move, args=(path, self.job), daemon=True).start()
        return True, None

    def _move(self, path, j):
        def prog(done, total, f):
            j['done'], j['total'], j['file'] = done, total, f

        def commit():                               # the data is in place: from now on it is read from there
            same = os.path.normcase(os.path.realpath(path)) == os.path.normcase(os.path.realpath(config.home()))
            self.app.settings['data_dir'] = '' if same else path
            self.app.settings.save()
        try:
            while self.remake.converting():         # it stops after the current film (Remake.paused)
                time.sleep(1)
            j['stage'] = 'moving'
            config.move_data(path, prog, commit)
        except Exception as e:                      # noqa: BLE001
            j['error'] = str(e)
        j['running'] = False
