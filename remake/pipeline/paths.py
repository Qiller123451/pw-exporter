"""Where the asset build reads and writes. Set by pipeline.configure() (or the command line of a single step).

    DATA   the game's Data folder (from the player's own ParaWorld installation)
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
OUT = os.environ.get('PW_OUT', '')
CONV = os.environ.get('PW_CONV', '')


def configure(data, out, conv=None):
    global DATA, OUT, CONV
    DATA = os.path.abspath(data)
    OUT = os.path.abspath(out)
    CONV = os.path.abspath(conv or os.path.join(OUT, '_conv'))
    os.makedirs(OUT, exist_ok=True)


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
