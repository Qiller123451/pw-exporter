"""Convert the original HUD textures to PNG and write an atlas index (from UI/All_def.txt) for the game UI.

A mod replaces or adds single files (MIRAGE: its own All_def.txt and some cards, the rest stays Base's): the HUD
textures are those of every folder of the configuration, a later folder's file replacing the same path, and the
atlas entries those of every folder's All_def.txt, a later definition replacing the same name."""
import json, os, sys
from PIL import Image
try:
    from . import paths
except ImportError:
    import paths


def main(log=print, progress=None):
    game = paths.game()
    OUT = os.path.join(paths.OUT, 'assets', 'ui')
    os.makedirs(OUT, exist_ok=True)
    have = set()
    for rel, p in game.tree('UI/hud').items():
        if rel.endswith('.tga'):
            rel = 'hud/' + rel
            Image.open(p).convert('RGBA').save(os.path.join(OUT, rel.replace('/', '_')[:-4] + '.png'), optimize=True)
            have.add(rel)
    atlas = {}
    defs = [p for p in (game.file('UI/All_def.txt', [m]) for m in game.mods) if p]
    for d in defs:
        cur = None
        for line in open(d, encoding='latin1'):
            line = line.split('#')[0].strip()
            if not line: continue
            t = line.split()
            if t[0] == 'file':
                f = t[1].replace('\\', '/').lower()
                cur = f if f in have else None
                continue
            if t[0] == 'source' and cur and len(t) >= 7:
                try:
                    lvl = int(t[2]); x, y, w, h = map(int, t[3:7])
                except ValueError:
                    continue
                atlas.setdefault(t[1], {})[str(lvl)] = [cur.replace('/', '_')[:-4] + '.png', x, y, w, h]
    json.dump(atlas, open(os.path.join(OUT, 'atlas.json'), 'w'), separators=(',', ':'))
    # the decals under units with a buff (src/game/buffs.js; buffdecals.txt "tile": 4 x 4 tiles of 128 pixels)
    dec = game.file('Texture/Effects/UnitDecals_(0512).dds')
    if dec:
        Image.open(dec).convert('RGBA').save(os.path.join(OUT, 'unitdecals.png'), optimize=True)
    # the hero ring (PWClient: Effects/Selection.tga, its lower left quarter in the player's colour)
    sel = game.file('Texture/Effects/Selection_(0256).dds')
    if sel:
        im = Image.open(sel).convert('RGBA')
        w, h = im.size
        im.crop((0, h // 2, w // 2, h)).save(os.path.join(OUT, 'heroring.png'), optimize=True)
    log('images', len(have), 'atlas entries', len(atlas), 'definitions', len(defs))


run = main

if __name__ == '__main__':
    paths.configure(sys.argv[1], sys.argv[2])
    main()
