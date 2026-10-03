"""Step "forest": what the game needs to grow the forest blocks of original maps -> <OUT>/forest.json
(read by src/game/maps/forest.js; the format and the engine's rules are in pwexport/forest.py, docs/MAP_FORMAT.md).

A map stores its forests as 32 m squares (chunk Frst) without tree positions: the engine has 32 fixed layouts of
31 spots built into PWServer.exe / PWClient.exe. This step copies that table out of the player's own program file
and reads the kinds of trees and undergrowth of every setting (Scripts/Server/classes/vegetation/Forest_<Setting>.txt).

    {"patterns": base64 of the table (32 x 624 bytes) or null when no program file was found,
     "settings": {"Jungle": {"trees": [{"standard", "stump", "timber"} x 5], "deco": [model x 8]}, ...}}

    python -m remake.pipeline.build_forest <Data folder> <output folder>
"""
import base64
import json
import os
import sys

try:
    from . import paths
except ImportError:
    import paths


def build():
    from pwexport import forest, ula
    from pwexport.install import Install
    inst = Install(paths.DATA)
    pat = forest.patterns(inst)
    settings = {}
    for s in ula.SETTINGS:
        cfg = forest.config(inst, s)
        if not any(cfg['trees']) and not any(cfg['deco']):
            continue
        settings[s] = {'trees': [t and {'standard': t['standard'], 'stump': t['stump'], 'timber': t['timber']} for t in cfg['trees']],
                       'deco': [d and d['standard'] for d in cfg['deco']]}
    return {'patterns': base64.b64encode(pat.raw).decode('ascii') if pat else None, 'settings': settings}


def run(log=print, progress=None):
    data = build()
    f = os.path.join(paths.OUT, 'forest.json')
    with open(f + '.tmp', 'w', encoding='utf-8') as fh:
        json.dump(data, fh, separators=(',', ':'))
    os.replace(f + '.tmp', f)
    log('forest blocks: %s, tree kinds of %s (%d KB)' % (
        'layouts read from the game program' if data['patterns'] else 'NO layouts (PWServer.exe / PWClient.exe not found): maps have no forest trees',
        '/'.join(sorted(data['settings'])) or 'no setting', os.path.getsize(f) // 1024))
    return data


if __name__ == '__main__':
    paths.configure(sys.argv[1], sys.argv[2])
    run()
