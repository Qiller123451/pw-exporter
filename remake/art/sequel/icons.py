"""The sequel's own cards (the pictures of the build menu, the selection and the army pyramid), rendered from the
built models the way ParaWorld's SEAS cards look: the model from the front left above, lit from the upper left, on
SEAS' rust-red card ground with a dark rim.
    python3 -m remake.art.sequel.icons [--out <built folder>]
writes <folder>/ui/sq_cards.jpg (a sheet of CARD-sized pictures) and the 'cards' entries of <folder>/manifest.json
({class: [x, y, w, h]}). The pipeline step "sequel" (pipeline/sequel_assets.py) adds them to the game's card atlas.
The units that keep an original model (troopers, heroes) keep the original's card (the step marks some of them)."""
import os, sys, json, math
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance

CARD = (128, 122)          # twice the original's largest card (64 x 61): sharp at any of the HUD's sizes
COLS = 4
# class -> the models of its picture: name, or (name, (x, y, z) in the model's frame (glTF: y up, front -z));
# {'models', 'yaw'}: seen from another side
ICONS = {
    'sq_jeep': ['sq_jeep'], 'sq_capture_truck': ['sq_capture_truck'], 'sq_aa_halftrack': ['sq_aa_halftrack'],
    'sq_arc_halftrack': ['sq_arc_halftrack'],
    'sq_stabilizer': ['sq_stabilizer'], 'sq_searchlight': ['sq_searchlight'], 'sq_flak': ['sq_flak'], 'sq_radar': ['sq_radar'],
    'sq_field_hq': ['sq_field_hq'], 'sq_electric_net': ['sq_electric_net'],
    'sq_power_station': ['sq_power_station_b'], 'sq_power_pole': ['sq_power_pole'], 'sq_generator': ['sq_generator'],
    'sq_windmill': ['sq_windmill', ('sq_windmill_rotor', (0, 13.05, -1.45))],          # ui/sequel_ui.js ROTORS
    'sq_watermill': {'models': ['sq_watermill', ('sq_waterwheel', (0, 2.2, 4.0))], 'yaw': 118},     # the wheel is at the back
    'sq_tesla_coil': ['sq_tesla_coil'],
    'sq_launch_pad': ['sq_launch_pad', ('sq_rocket_body', (0, 5.0, 0))],               # works.py TABLE_TOP
    'sq_gate_machine': ['sq_gate_machine'], 'sq_rift': ['sq_rift_b'],
}
PARTY = (0.42, 0.07, 0.05)          # the owner's colour in the picture: SEAS red


def render(built, models, out, size=(256, 244), yaw=34, pitch=30, samples=48):
    if isinstance(models, dict): yaw, models = models.get('yaw', yaw), models['models']
    """one model group, transparent background"""
    import bpy
    from mathutils import Vector
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    meshes = []
    for m in models:
        name, at = (m, None) if isinstance(m, str) else m
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(built, 'models', name + '.glb'))
        new = [o for o in bpy.data.objects if o not in before]
        if at:
            for o in new:
                if o.parent is None: o.location = (at[0], -at[2], at[1])
        meshes += [o for o in new if o.type == 'MESH']
    for o in meshes:
        for mat in o.data.materials:
            if not mat or not mat.node_tree: continue
            b = mat.node_tree.nodes.get('Principled BSDF')
            if not b: continue
            b.inputs['Roughness'].default_value = 0.85
            b.inputs['Specular IOR Level'].default_value = 0.15
            if not b.inputs['Base Color'].is_linked and 'party' in mat.name.lower():
                b.inputs['Base Color'].default_value = (*PARTY, 1)
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    # light: a warm key from the upper left, a cool sky
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 2.4; sun.angle = math.radians(8); sun.color = (1.0, 0.94, 0.84)
    so = bpy.data.objects.new('sun', sun); scn.collection.objects.link(so)
    so.rotation_euler = (math.radians(45), 0, math.radians(-60))
    scn.world = bpy.data.worlds.new('w'); scn.world.use_nodes = True
    bg = scn.world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.62, 0.66, 0.74, 1); bg.inputs['Strength'].default_value = 0.55
    # the camera: orthographic, front left above, framed to the model's outline
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'
    co = bpy.data.objects.new('cam', cam); scn.collection.objects.link(co); scn.camera = co
    a, p = math.radians(yaw), math.radians(pitch)
    fwd = Vector((math.sin(a) * math.cos(p), -math.cos(a) * math.cos(p), -math.sin(p)))      # looking at the front (+y)
    c = sum(pts, Vector()) / len(pts)
    co.location = c - fwd * 400
    co.rotation_euler = fwd.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.update()
    inv = co.matrix_world.inverted()
    cp = [inv @ q for q in pts]
    x0, x1 = min(q.x for q in cp), max(q.x for q in cp)
    y0, y1 = min(q.y for q in cp), max(q.y for q in cp)
    aspect = size[0] / size[1]
    w = max(x1 - x0, (y1 - y0) * aspect) / 0.9
    cam.ortho_scale = w
    cam.shift_x = (x0 + x1) / 2 / w
    cam.shift_y = (y0 + y1) / 2 / w - 0.02
    cam.clip_end = 2000
    scn.render.engine = 'CYCLES'; scn.cycles.samples = samples; scn.cycles.device = 'CPU'
    scn.render.film_transparent = True
    scn.render.resolution_x, scn.render.resolution_y = size
    scn.render.image_settings.file_format = 'PNG'; scn.render.image_settings.color_mode = 'RGBA'
    scn.view_settings.view_transform = 'Standard'
    scn.render.filepath = out
    bpy.ops.render.render(write_still=True)


def ground(size, seed=7):
    """SEAS' card ground: rust-red, brushed sideways, lighter in the middle, a dark rim"""
    w, h = size
    rng = np.random.default_rng(seed)
    n = np.zeros((h, w))
    for s, amp in ((4, 0.5), (12, 0.3), (40, 0.2)):
        g = rng.random((max(2, h * s // 120), max(2, w // (s * 3) + 2)))
        n += amp * np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)) / 255
    streak = np.asarray(Image.fromarray((rng.random((h, 6)) * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR)) / 255
    t = np.clip(0.55 * n + 0.45 * streak, 0, 1)
    dark, light = np.array([88, 34, 18]), np.array([200, 92, 50])
    col = dark + (light - dark) * t[..., None]
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot((xx - w * 0.45) / w, (yy - h * 0.42) / h)
    col *= np.clip(1.25 - 1.1 * r, 0.45, 1.1)[..., None]
    scratch = rng.random((h, w)) > 0.995
    col[scratch] = col[scratch] * 0.6 + 70
    return Image.fromarray(np.clip(col, 0, 255).astype(np.uint8))


def card(render_png, size=CARD, seed=7):
    fg = Image.open(render_png).convert('RGBA')
    fg = ImageEnhance.Color(fg).enhance(1.15)
    fg = ImageEnhance.Contrast(fg).enhance(1.08)
    fg = fg.filter(ImageFilter.UnsharpMask(radius=1.6, percent=90, threshold=2))
    bg = ground(fg.size, seed).convert('RGBA')
    a = fg.split()[3]
    shadow = Image.new('RGBA', fg.size, (20, 6, 2, 0))
    shadow.putalpha(a.filter(ImageFilter.GaussianBlur(5)).point(lambda v: int(v * 0.75)))
    bg.alpha_composite(shadow, (5, 6))
    rim = Image.new('RGBA', fg.size, (25, 8, 4, 0))                       # a dark outline holds the shape on the ground
    rim.putalpha(a.filter(ImageFilter.MaxFilter(5)))
    bg.alpha_composite(rim)
    bg.alpha_composite(fg)
    return bg.convert('RGB').resize(size, Image.LANCZOS)


def build(out, only=None):
    import tempfile
    tmp = os.path.join(tempfile.gettempdir(), 'sq_cards'); os.makedirs(tmp, exist_ok=True)      # the renders (kept: names re-render only those)
    os.makedirs(os.path.join(out, 'ui'), exist_ok=True)
    names = list(ICONS)
    for n in names:
        if only and n not in only and os.path.exists(os.path.join(tmp, n + '.png')): continue
        render(out, ICONS[n], os.path.join(tmp, n + '.png'))
    rows = (len(names) + COLS - 1) // COLS
    sheet = Image.new('RGB', (COLS * CARD[0], rows * CARD[1]), (40, 16, 10))
    cards = {}
    for i, n in enumerate(names):
        x, y = (i % COLS) * CARD[0], (i // COLS) * CARD[1]
        sheet.paste(card(os.path.join(tmp, n + '.png'), seed=i + 3), (x, y))
        cards[n] = [x, y, CARD[0], CARD[1]]
    f = os.path.join(out, 'ui', 'sq_cards.jpg')
    sheet.save(f, quality=92)
    import hashlib
    mp = os.path.join(out, 'manifest.json')
    man = json.load(open(mp))
    man['cards'] = {'file': 'sq_cards.jpg', 'size': list(sheet.size), 'cards': cards, 'sha': hashlib.sha1(open(f, 'rb').read()).hexdigest()[:12]}
    json.dump(man, open(mp, 'w'), indent=0, separators=(',', ':'))
    return cards


if __name__ == '__main__':
    args = sys.argv[1:]
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'built')
    if args[:1] == ['--out']: out, args = args[1], args[2:]
    print(len(build(out, set(args) or None)), 'cards')
