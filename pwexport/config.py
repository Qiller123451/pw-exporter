"""Settings that survive restarts (install folder, language, export folder ...), the conversion cache and the
remake's game data built from the installation.

Stored in   Windows: %APPDATA%\\ParaWorldToolkit\\
            macOS/Linux: ~/.config/paraworld-toolkit/
Set the environment variable PWTOOLKIT_HOME (or the older PWEXPORT_HOME) to keep them somewhere else, e.g. next to
the toolkit on a USB stick. Settings of the earlier stand-alone Model Exporter are taken over on the first start.
"""
import json
import os
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


def cache_dir(*parts):
    d = os.path.join(home(), 'cache', *parts)
    os.makedirs(d, exist_ok=True)
    return d
