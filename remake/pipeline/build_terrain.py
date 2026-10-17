"""Step "terrain": the ground textures of every setting, from the original scape atlases (see docs/TERRAIN_NOTES.md).

Texture/Scape/<Setting>/ScapeTexture<Q>.dat lists, for every map cell pattern, one atlas tile per material; the
variants of a material tile seamlessly, so a random mosaic of them is a faithful repeating ground texture for the
remake's splat shader (pwexport/scape.py does the reading; the Model Exporter's map viewer uses it too).

Output (<OUT>/assets/terrain): <Setting>/scape_<k>.jpg (8 materials, 512 px), <Setting>/setting.json (the minimap's colour table),
<Setting>/grass.png (grass clump atlas, drawn by engine/grass.js), the jungle set again at the top (random skirmish
maps) plus the fallback names grass_green.jpg ..., water_normal.png (sea ripples), objbrush.json (the buildings' ground
brushes: how the ground levels where a player puts one down, game/ground.js).
"""
import base64
import json
import os
import sys

from PIL import Image, ImageFilter
try:
    from . import paths
except ImportError:
    import paths
from pwexport import scape                    # noqa: E402

SETTINGS = ['Jungle', 'Northland', 'Savanna', 'Icewaste', 'Ashvalley', 'Cave1', 'Cave2', 'Cave3']     # (Cave2: the volcano crater of mission 16)
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


def brushes(game, base, log):
    """objbrush.json: {'metres_per_pixel', 'brushes': {gfx: {'w', 'h', 'a': base64 alpha, 'm': base64 ground material
    0..7 per pixel, row 0 = -y of the model}}} (pwexport/scape.py obj_brushes, brush_materials)"""
    out = {}
    for name, img in scape.obj_brushes(game).items():
        h, w = img.shape[:2]
        out[name] = {'w': int(w), 'h': int(h), 'a': base64.b64encode(img[:, :, 3].tobytes()).decode('ascii'),
                     'm': base64.b64encode(scape.brush_materials(img).tobytes()).decode('ascii')}
    with open(os.path.join(base, 'objbrush.json'), 'w') as f:
        json.dump({'metres_per_pixel': scape.BRUSH_METRES_PER_PIXEL, 'brushes': out}, f, separators=(',', ':'))
    log('object brushes', len(out))


def minimap_colors(game, setting):
    """the setting's minimap colour table Texture/Scape/<Setting>/minimap_colors.tga (21 x 6, docs/MINIMAP.md): rows
    [visible ground, buildings, units, explored ground, buildings / units in the fog] x columns [5 relief shades, the
    same for special ground, shallow water, deep water, forest, resources, items, (passability), player colours ...],
    each [r, g, b, a]. The engine keeps them as ARGB4444 textures: 4 bits a channel. None if the setting has none."""
    f = game.file('Texture/Scape/%s/minimap_colors.tga' % setting)
    if not f:
        return None
    im = Image.open(f).convert('RGBA')
    q = lambda c: (c & 0xF0) | (c >> 4)
    return [[[q(c) for c in im.getpixel((x, y))] for x in range(im.size[0])] for y in range(im.size[1])]


def run(log=print, progress=None):
    game = paths.game()
    base = os.path.join(paths.OUT, 'assets', 'terrain')
    os.makedirs(base, exist_ok=True)
    # sea ripples (the same normal map for every setting)
    wn = game.file('Texture/Scape/Settings/Jungle/WaterNormalMap.tga')
    if wn:
        Image.open(wn).convert('RGB').resize((512, 512), Image.BILINEAR).save(os.path.join(base, 'water_normal.png'))
    brushes(game, base, log)
    for i, s in enumerate(SETTINGS):
        if progress:
            progress('Ground textures: %s' % s, i / len(SETTINGS))
        if not game.dir('Texture/Scape/%s' % s):
            log('missing', s)
            continue
        out = os.path.join(base, s)
        os.makedirs(out, exist_ok=True)
        imgs = scape.material_textures(game, s)
        for k, img in enumerate(imgs):
            img.save(os.path.join(out, 'scape_%d.jpg' % k), quality=90)
            if s == 'Jungle':
                img.save(os.path.join(base, 'scape_%d.jpg' % k), quality=90)
                if k < len(FALLBACK):
                    img.resize((256, 256)).save(os.path.join(base, FALLBACK[k] + '.jpg'), quality=88)
        with open(os.path.join(out, 'setting.json'), 'w') as f:
            json.dump({'materials': 8, 'minimap': minimap_colors(game, s)}, f)
        grass(game, s, out)
        log(s, 'ok')


if __name__ == '__main__':
    paths.configure(sys.argv[1], sys.argv[2])
    run()
