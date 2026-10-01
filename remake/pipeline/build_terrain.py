"""Step "terrain": the ground textures of every setting, from the original scape atlases (see docs/TERRAIN_NOTES.md).

Texture/Scape/<Setting>/ScapeTexture<Q>.dat lists, for every map cell pattern, one atlas tile per material; the
variants of a material tile seamlessly, so a random mosaic of them is a faithful repeating ground texture for the
remake's splat shader (pwexport/scape.py does the reading; the Model Exporter's map viewer uses it too).

Output (<OUT>/assets/terrain): <Setting>/scape_<k>.jpg (8 materials, 512 px), <Setting>/setting.json (minimap colours),
<Setting>/grass.png (grass clump atlas, drawn by engine/grass.js), the jungle set again at the top (random skirmish
maps) plus the fallback names grass_green.jpg ..., water_normal.png (sea ripples).
"""
import json
import os
import sys

from PIL import Image, ImageFilter
try:
    from . import paths
except ImportError:
    import paths
from pwexport import scape                    # noqa: E402
from pwexport.install import Install          # noqa: E402

SETTINGS = ['Jungle', 'Northland', 'Savanna', 'Icewaste', 'Ashvalley', 'Cave1']
FALLBACK = ['grass_green', 'grass_yellow', 'dirt', 'rock', 'mud', 'sand']


def grass(game, setting, out):
    """grass clumps the original scatters over the ground: 4 x 4 atlas with alpha. Colours under transparent pixels
    are bled from their neighbours so the mipmaps don't get dark fringes."""
    folder = game.dir('Texture/Scape/%s' % setting)
    src = paths.ci(os.path.join(folder, 'grassblades_(0512).dds')) if folder else None
    if not src or not os.path.exists(src):
        return False
    im = Image.open(src).convert('RGBA')
    rgb, a = im.convert('RGB'), im.getchannel('A')
    solid = a.point(lambda v: 255 if v > 100 else 0)
    bled = rgb.copy()
    for _ in range(6):
        grown = Image.composite(bled, bled.filter(ImageFilter.MaxFilter(5)), solid)
        bled = Image.composite(rgb, grown, solid)
    o = bled.convert('RGBA'); o.putalpha(a)
    o.save(os.path.join(out, 'grass.png'), optimize=True)
    return True


def run(log=print, progress=None):
    game = Install(paths.DATA)
    base = os.path.join(paths.OUT, 'assets', 'terrain')
    os.makedirs(base, exist_ok=True)
    # sea ripples (the same normal map for every setting)
    wn = game.file('Texture/Scape/Settings/Jungle/WaterNormalMap.tga')
    if wn:
        Image.open(wn).convert('RGB').resize((512, 512), Image.BILINEAR).save(os.path.join(base, 'water_normal.png'))
    for i, s in enumerate(SETTINGS):
        if progress:
            progress('Ground textures: %s' % s, i / len(SETTINGS))
        if not game.dir('Texture/Scape/%s' % s):
            log('missing', s)
            continue
        out = os.path.join(base, s)
        os.makedirs(out, exist_ok=True)
        imgs = scape.material_textures(game, s)
        cols = []
        for k, img in enumerate(imgs):
            img.save(os.path.join(out, 'scape_%d.jpg' % k), quality=90)
            cols.append([int(c) for c in img.resize((1, 1), Image.BILINEAR).getpixel((0, 0))])
            if s == 'Jungle':
                img.save(os.path.join(base, 'scape_%d.jpg' % k), quality=90)
                if k < len(FALLBACK):
                    img.resize((256, 256)).save(os.path.join(base, FALLBACK[k] + '.jpg'), quality=88)
        with open(os.path.join(out, 'setting.json'), 'w') as f:
            json.dump({'materials': 8, 'minimap': cols}, f)
        grass(game, s, out)
        log(s, 'ok')


if __name__ == '__main__':
    paths.configure(sys.argv[1], sys.argv[2])
    run()
