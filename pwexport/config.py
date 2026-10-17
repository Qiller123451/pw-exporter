"""Settings that survive restarts (install folder, language, export folder ...) and the toolkit's data: the
conversion cache (cache/) and the remake's game data built from the installation (remake/), several gigabytes.

Settings    Windows: %APPDATA%\\ParaWorldToolkit\\settings.json
            macOS/Linux: ~/.config/paraworld-toolkit/settings.json
            the environment variable PWTOOLKIT_HOME (or the older PWEXPORT_HOME) puts them somewhere else, e.g. next to
            the toolkit on a USB stick. Settings of the earlier stand-alone Model Exporter are taken over on the first
            start.
Data        the same folder, unless the setting data_dir names another one (the launcher's "Toolkit data: Change",
            which moves what is there: move_data) or the environment variable PWTOOLKIT_DATA does.
"""
import json
import os
import shutil
import sys


def _default(name_win, name_unix):
    if sys.platform == 'win32':
        return os.path.join(os.environ.get('APPDATA') or os.path.expanduser('~'), name_win)
    return os.path.join(os.environ.get('XDG_CONFIG_HOME') or os.path.expanduser('~/.config'), name_unix)


def home():
    h = os.environ.get('PWTOOLKIT_HOME') or os.environ.get('PWEXPORT_HOME')
    if not h:
        h = _default('ParaWorldToolkit', 'paraworld-toolkit')
        old = os.path.join(_default('ParaWorldModelExporter', 'paraworld-model-exporter'), 'settings.json')
        if not os.path.exists(os.path.join(h, 'settings.json')) and os.path.exists(old):
            os.makedirs(h, exist_ok=True)
            try:
                with open(old, 'rb') as a, open(os.path.join(h, 'settings.json'), 'wb') as b:
                    b.write(a.read())
            except OSError:
                pass
    os.makedirs(h, exist_ok=True)
    return h


DEFAULTS = {
    'install': '',              # ParaWorld install folder
    'lang': '',                 # text language of the game ('uk' English, 'de' German, ...); '' = ask
    'ui_lang': 'en',            # language of the tool itself ('en' / 'de')
    'export_dir': '',           # last export folder
    'blender': '',              # blender executable (found automatically when empty)
    'fps': 25.0,                # playback rate of the game's animations
    'tex_quality': 'max',       # texture size by the game's detail table: max | high | medium | low
}


class Settings(dict):
    def __init__(self):
        super().__init__(DEFAULTS)
        self.path = os.path.join(home(), 'settings.json')
        try:
            with open(self.path, encoding='utf-8') as f:
                self.update(json.load(f))
        except (OSError, ValueError):
            pass

    def save(self):
        tmp = self.path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(dict(self), f, indent=2, ensure_ascii=False)
        os.replace(tmp, self.path)


_saved = [None, {}]                 # (mtime, contents) of settings.json as data_home last read it


def _setting(key):
    p = os.path.join(home(), 'settings.json')
    try:
        mt = os.path.getmtime(p)
        if mt != _saved[0]:
            with open(p, encoding='utf-8') as f:
                _saved[1] = json.load(f)
            _saved[0] = mt
    except (OSError, ValueError):
        return None
    return _saved[1].get(key)


DATA_ITEMS = ('cache', 'remake')    # what lives in the data folder (all of it made by the toolkit, made again if lost)


def data_home():
    """the folder of the toolkit's data: PWTOOLKIT_DATA, else the setting data_dir, else home()"""
    d = os.environ.get('PWTOOLKIT_DATA') or _setting('data_dir') or home()
    os.makedirs(d, exist_ok=True)
    return d


def cache_dir(*parts):
    d = os.path.join(data_home(), 'cache', *parts)
    os.makedirs(d, exist_ok=True)
    return d


def data_size(root=None):
    """bytes of the toolkit's data in root (default: the data folder)"""
    root = root or data_home()
    n = 0
    for it in DATA_ITEMS:
        for dp, _, fs in os.walk(os.path.join(root, it)):
            for f in fs:
                try:
                    n += os.path.getsize(os.path.join(dp, f))
                except OSError:
                    pass
    return n


def check_data_dir(dst):
    """why dst cannot be the data folder (a message), or None"""
    if not dst or not os.path.isabs(dst):
        return 'not an absolute path'
    src = os.path.realpath(data_home())
    d = os.path.realpath(dst)
    if d == src:
        return 'that is already the data folder'
    for a, b in ((d, src), (src, d)):           # e.g. the new folder inside the old cache folder: it would move itself
        if any(a == os.path.join(b, it) or a.startswith(os.path.join(b, it) + os.sep) for it in DATA_ITEMS):
            return 'one folder lies inside the other'
    if os.path.exists(d) and not os.path.isdir(d):
        return 'not a folder'
    try:
        os.makedirs(d, exist_ok=True)
        t = os.path.join(d, '.pwtoolkit-write-test')
        with open(t, 'w') as f:
            f.write('ok')
        os.remove(t)
    except OSError as e:
        return 'cannot write there: %s' % (e.strerror or e)
    need = data_size(src)
    free = shutil.disk_usage(d).free
    if _device(d) != _device(src) and free < need + (256 << 20):
        return 'not enough space there: %d MB needed, %d MB free' % (need >> 20, free >> 20)
    return None


def _device(p):
    try:
        return os.stat(p).st_dev
    except OSError:
        return None


def move_data(dst, progress=None, commit=None):
    """move the toolkit's data (DATA_ITEMS) from the data folder into dst. A folder is renamed when both lie on one
    drive, else copied file by file; then commit() runs (the caller stores dst as data_dir) and only after that the
    originals are removed. A failed copy leaves the data where it was (renamed folders go back). What dst already
    has is kept (the toolkit's own data, e.g. moved there by hand earlier). progress(bytes done, bytes total, file)."""
    src = data_home()
    dst = os.path.abspath(dst)
    total, done = data_size(src), 0
    renamed, copied = [], []
    try:
        for it in DATA_ITEMS:
            a, b = os.path.join(src, it), os.path.join(dst, it)
            if not os.path.isdir(a):
                continue
            if not os.path.exists(b):
                try:
                    os.rename(a, b)                      # same drive: instant
                    renamed.append((a, b))
                    continue
                except OSError:
                    pass
            for dp, _, fs in os.walk(a):
                to = os.path.join(b, os.path.relpath(dp, a))
                os.makedirs(to, exist_ok=True)
                for f in fs:
                    s, t = os.path.join(dp, f), os.path.join(to, f)
                    n = os.path.getsize(s)
                    if not os.path.exists(t):
                        shutil.copy2(s, t + '.part')
                        os.replace(t + '.part', t)
                    done += n
                    if progress:
                        progress(done, total, os.path.relpath(s, src))
            copied.append(a)
    except BaseException:
        for a, b in renamed:
            try:
                os.rename(b, a)
            except OSError:
                pass
        raise
    if commit:
        commit()
    for a in copied:
        shutil.rmtree(a, ignore_errors=True)
    return dst
