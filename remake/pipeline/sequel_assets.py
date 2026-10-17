"""Pipeline step "sequel": the sequel campaign's own models and cards (docs/SEQUEL.md "Models") into the game data.

They are made in Blender from CC0 materials by art/sequel (build.py) and kept built in the repository
(art/sequel/built: models/*.glb, tex/*.jpg and the road surfaces tex/sq_road_*.png, manifest.json), so building the game data needs neither Blender nor
the materials. This step copies them next to the converted ParaWorld models and adds their manifest entries (after
"assets", whose manifest it extends). The cards (art/sequel/icons.py: built/ui/sq_cards.jpg) go into the HUD's card
atlas (after "ui"), and the units that keep an original model get the original's card with a mark of their own
(BADGES: drawn here, from the converted cards). The sequel's buildings get ground brushes like the game's (after
"terrain": brushes). The step runs again when the built manifest changes (it names the file, so its
hash is part of the step's fingerprint: stamps.py)."""
import json
import os
import shutil

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
BUILT_MANIFEST = '../art/sequel/built/manifest.json'


def install(out_dir):
    """copy the built models into <out_dir>/assets; returns how many"""
    built = os.path.dirname(os.path.join(HERE, BUILT_MANIFEST))
    entries = json.load(open(os.path.join(built, 'manifest.json')))['models']
    assets = os.path.join(out_dir, 'assets')
    os.makedirs(os.path.join(assets, 'models'), exist_ok=True)
    os.makedirs(os.path.join(assets, 'tex'), exist_ok=True)
    for name in entries:
        shutil.copyfile(os.path.join(built, 'models', name + '.glb'), os.path.join(assets, 'models', name + '.glb'))
    for f in os.listdir(os.path.join(built, 'tex')):            # the models' textures and the road surfaces
        shutil.copyfile(os.path.join(built, 'tex', f), os.path.join(assets, 'tex', f))
    man_path = os.path.join(assets, 'manifest.json')
    man = json.load(open(man_path))
    for name, e in entries.items():
        man['models'][name] = {k: v for k, v in e.items() if k != 'sha'}
    json.dump(man, open(man_path, 'w'), separators=(',', ':'))
    cards(built, assets)
    brushes(entries, assets)
    return len(entries)


def brushes(entries, assets, mpp=0.5):
    """ground brushes for the sequel's buildings (assets/terrain/objbrush.json, made by the step "terrain" from the
    game's Texture/Scape/ObjBrush; game/ground.js): like ParaWorld's - levelled under the building with a soft rim,
    gravel (material 5) on the 4 m cells under it, earth (3) around it, grass (2) at the corners"""
    import base64
    import numpy as np
    path = os.path.join(assets, 'terrain', 'objbrush.json')
    if not os.path.exists(path):
        return
    data = json.load(open(path))
    for name, e in entries.items():
        if e.get('sequel') != 'building' or not e.get('foot') or name == 'sq_power_pole':
            continue
        cx, cz, hx, hz = e['foot']
        w, h = (int(np.ceil((2 * (abs(c) + r) + 8) / 4)) * 8 for c, r in ((cx, hx), (cz, hz)))
        xs = (np.arange(w) + 0.5) * mpp - w * mpp / 2 - cx
        zs = (np.arange(h) + 0.5) * mpp - h * mpp / 2 - cz
        dx = np.maximum(np.abs(xs)[None, :] - hx, 0)
        dz = np.maximum(np.abs(zs)[:, None] - hz, 0)
        d = np.hypot(dx, dz)                                   # metres outside the footprint
        a = np.clip(255 * (1 - (d - 0.5) / 3), 0, 255).astype(np.uint8)
        bd = np.repeat(np.repeat(d[4::8, 4::8], 8, 0), 8, 1)[:h, :w]      # per 4 m block (its middle pixel)
        m = np.where(bd <= 0.5, 5, np.where(bd <= 4.5, 3, 2)).astype(np.uint8)
        data['brushes'][name] = {'w': w, 'h': h, 'a': base64.b64encode(a.tobytes()).decode('ascii'),
                                 'm': base64.b64encode(m.tobytes()).decode('ascii')}
    json.dump(data, open(path, 'w'), separators=(',', ':'))


# class -> (the original whose card it takes, the mark in its corner)
BADGES = {'sq_shock_trooper': ('seas_gunner', 'bolt'), 'sq_tranq': ('seas_marksman', 'dart')}
CARD = (128, 122)


def _badge(im, kind):
    """a round dark plate in the lower right corner with the mark: a lightning bolt, a tranquilizer dart"""
    d = ImageDraw.Draw(im)
    w, h = im.size
    cx, cy, r = w - 24, h - 24, 19
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(30, 14, 8), outline=(214, 170, 90), width=3)
    if kind == 'bolt':
        pts = [(4, -15), (-9, 2), (-1, 2), (-5, 15), (9, -3), (1, -3), (6, -15)]
        d.polygon([(cx + x, cy + y) for x, y in pts], fill=(255, 226, 80), outline=(140, 90, 10))
    else:
        d.line((cx - 11, cy + 11, cx + 8, cy - 8), fill=(220, 220, 225), width=3)              # the needle and barrel
        d.line((cx - 4, cy + 4, cx + 6, cy - 6), fill=(70, 190, 200), width=7)
        d.polygon([(cx + 6, cy - 6), (cx + 15, cy - 9), (cx + 9, cy - 15)], fill=(230, 60, 40))   # the tuft


def cards(built, assets):
    """the sequel's cards into the card atlas (assets/ui/atlas.json: {name: {level: [file, x, y, w, h]}})"""
    ui = os.path.join(assets, 'ui')
    atlas_path = os.path.join(ui, 'atlas.json')
    atlas = json.load(open(atlas_path, encoding='utf-8'))
    c = json.load(open(os.path.join(built, 'manifest.json')))['cards']
    shutil.copyfile(os.path.join(built, 'ui', c['file']), os.path.join(ui, c['file']))
    levels = ('0', '1', '2', '3', '4')
    for name, box in c['cards'].items():
        atlas[name] = {lv: [c['file'], *box] for lv in levels}
    sheet = Image.new('RGB', (CARD[0] * len(BADGES), CARD[1]))
    x = 0
    for name, (orig, kind) in BADGES.items():
        e = atlas.get(orig)
        if not e: continue
        f, sx, sy, sw, sh = max(e.values(), key=lambda v: v[3] * v[4])
        im = Image.open(os.path.join(ui, f)).convert('RGB').crop((sx, sy, sx + sw, sy + sh)).resize(CARD, Image.LANCZOS)
        _badge(im, kind)
        sheet.paste(im, (x, 0))
        atlas[name] = {lv: ['sq_cards_x.jpg', x, 0, *CARD] for lv in levels}
        x += CARD[0]
    sheet.save(os.path.join(ui, 'sq_cards_x.jpg'), quality=92)
    json.dump(atlas, open(atlas_path, 'w', encoding='utf-8'), separators=(',', ':'))


def run(log=print, progress=None):
    from . import paths
    log('sequel campaign: %d models' % install(paths.OUT))


if __name__ == '__main__':
    import sys
    print(install(sys.argv[1]), 'sequel models')
