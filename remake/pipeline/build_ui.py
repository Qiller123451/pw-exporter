"""Convert the original HUD textures to PNG and write an atlas index (from UI/All_def.txt) for the game UI."""
import json, os, sys
from PIL import Image
try:
    from . import paths
except ImportError:
    import paths


def main(log=print, progress=None):
    UI = paths.data('Base/UI')
    OUT = os.path.join(paths.OUT, 'assets', 'ui')
    os.makedirs(OUT, exist_ok=True)
    have = set()
    for dp, _, fs in os.walk(paths.ci(UI + '/hud')):
        for f in fs:
            if f.lower().endswith('.tga'):
                rel = os.path.relpath(os.path.join(dp, f), UI).replace('\\', '/')
                im = Image.open(os.path.join(dp, f)).convert('RGBA')
                name = rel.replace('/', '_')[:-4] + '.png'
                im.save(os.path.join(OUT, name), optimize=True)
                have.add(rel.lower())
    atlas = {}
    cur = None
    for line in open(paths.ci(UI + '/All_def.txt'), encoding='latin1'):
        line = line.split('#')[0].strip()
        if not line: continue
        t = line.split()
        if t[0] == 'file':
            cur = t[1].replace('\\', '/') if t[1].lower() in have else None
            continue
        if t[0] == 'source' and cur and len(t) >= 7:
            try:
                lvl = int(t[2]); x, y, w, h = map(int, t[3:7])
            except ValueError:
                continue
            key = t[1]
            atlas.setdefault(key, {})[str(lvl)] = [cur.replace('/', '_')[:-4] + '.png', x, y, w, h]
    json.dump(atlas, open(os.path.join(OUT, 'atlas.json'), 'w'), separators=(',', ':'))
    log('images', len(have), 'atlas entries', len(atlas))


run = main

if __name__ == '__main__':
    paths.configure(sys.argv[1], sys.argv[2])
    main()
