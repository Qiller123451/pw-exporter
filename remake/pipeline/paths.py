"""Where the asset build reads and writes. Set by pipeline.configure() (or the command line of a single step).

    DATA   the game's Data folder (from the player's own ParaWorld installation)
    MOD    the mod configuration the data is built for ('' = the official game: Base + BoosterPack1;
           'MIRAGE' = MIRAGE with everything it requires, pwexport/mods.py)
    OUT    the remake's data folder: assets/, gamedata.json, techtree.json (served next to the game code)
    CONV   scratch folder for the converted models (deleted after the build)
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))          # the toolkit folder (pwexport lives there)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

DATA = os.environ.get('PW_DATA', '')
MOD = os.environ.get('PW_MOD', '')
OUT = os.environ.get('PW_OUT', '')
CONV = os.environ.get('PW_CONV', '')


def configure(data, out, conv=None, mod=''):
    global DATA, OUT, CONV, MOD
    DATA = os.path.abspath(data)
    MOD = mod or ''
    OUT = os.path.abspath(out)
    CONV = os.path.abspath(conv or os.path.join(OUT, '_conv'))
    os.makedirs(OUT, exist_ok=True)


def install(data, mod=''):
    """a configuration of an installation as the remake is built from it: its Data folders (`mods`, base first; a
    file is taken from the last one that has it) and the model archives of those folders only - another mod's copy
    of all_characters.gsf must not leak into it"""
    from pwexport.install import Install
    from pwexport.mods import ModInstall
    g = ModInstall(data, mod) if mod else Install(data)
    g.model_mods = list(g.mods)
    return g


def game():
    """the installation this build reads (configure())"""
    return install(DATA, MOD)


_composites = {}


def composites():
    """{object (lower case): normalized parts} of the multi-part objects (riders, turrets, build-ups, flags ...): the
    table written from the base game (pwexport/data/composites.json) and, in a mod configuration, the parts the
    mod's scripts attach to objects the table does not know (pwexport/modparts.py, as the exporter shows them)"""
    key = (DATA, MOD)
    if key not in _composites:
        from pwexport import composites as table, gamedata, modparts
        out = dict(table.normalized())
        if MOD:
            g = game()
            raw = modparts.table(g, gamedata.techtree(g), gamedata.classes(g), skip=out)
            out.update({k: modparts.normalize(v) for k, v in raw.items()})
        _composites[key] = out
    return _composites[key]


def ci(path):
    """the path with each part matched case-insensitively (copies of the game on Linux / macOS)"""
    if os.path.exists(path):
        return path
    drive, rest = os.path.splitdrive(os.path.abspath(path))
    parts = rest.replace('\\', '/').split('/')
    p = drive + (os.sep if rest.startswith(('/', '\\')) else '')
    for part in parts:
        if not part:
            continue
        q = os.path.join(p, part)
        if not os.path.exists(q):
            try:
                hit = next((e for e in os.listdir(p) if e.lower() == part.lower()), None)
            except OSError:
                hit = None
            if hit is None:
                return path
            q = os.path.join(p, hit)
        p = q
    return p


def data(rel):
    """Data/<rel>, case-insensitively"""
    return ci(os.path.join(DATA, rel))
