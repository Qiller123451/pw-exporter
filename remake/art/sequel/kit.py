"""Blender kit for the sequel campaign's models (docs/SEQUEL.md): build a model from parts with CC0 materials, bake
its look into one texture the way ParaWorld's models carry theirs (colour with the shading of the material and its
ambient occlusion painted in; the game lights it), and write a glb + texture the remake loads.

Runs in Blender's Python (the `bpy` module: pip install bpy==4.2.0, Python 3.11, no window needed):
    python3 -m remake.art.sequel.build [--out <folder>] [model ...]
The materials come from ambientCG and Poly Haven (CC0): fetch.py downloads the ones materials.json names.

Axes: Blender's, z up; the model's front looks along +y (it becomes -z in the glb: glTF y up, the game's front).
"""
import math, os, json, struct
import bpy, bmesh
from mathutils import Vector, Matrix
from .paint import kuwahara, grade

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.environ.get('PW_ART_LIB', os.path.join(HERE, '_lib'))      # downloaded materials (fetch.py), not in git
ATTR = 0x801F


# ------------------------------------------------------------------------------------------------ scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.node_groups):
        for x in list(c):
            c.remove(x)


# ------------------------------------------------------------------------------------------------ materials
_mats = {}


def lin(c):
    """a colour as written (sRGB, how a painter picks it) to the linear value Blender's nodes take"""
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def _nodes(m):
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = 0.9
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return nt, bsdf


def _img(path, data=False):
    im = bpy.data.images.load(path, check_existing=True)
    if data:
        im.colorspace_settings.name = 'Non-Color'
    return im


def _weather(nt, col, grime=0.35, vary=0.10, streak=0.45):
    """dirt near the ground (an object-space height falloff broken up by noise) and a slow variation of the value:
    the worn look of ParaWorld's textures"""
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Position'], sep.inputs[0])
    fall = nt.nodes.new('ShaderNodeMapRange')            # z 0 .. 1.4 m -> 1 .. 0
    fall.inputs['From Min'].default_value = 0.0
    fall.inputs['From Max'].default_value = 1.4
    fall.inputs['To Min'].default_value = 1.0
    fall.inputs['To Max'].default_value = 0.0
    nt.links.new(sep.outputs['Z'], fall.inputs['Value'])
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 1.6
    noise.inputs['Detail'].default_value = 6
    nt.links.new(geo.outputs['Position'], noise.inputs['Vector'])
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
    nt.links.new(fall.outputs['Result'], mul.inputs[0])
    nt.links.new(noise.outputs['Fac'], mul.inputs[1])
    g = nt.nodes.new('ShaderNodeMath'); g.operation = 'MULTIPLY'; g.inputs[1].default_value = grime * 1.6
    nt.links.new(mul.outputs[0], g.inputs[0])
    dirt = nt.nodes.new('ShaderNodeMix'); dirt.data_type = 'RGBA'; dirt.blend_type = 'MULTIPLY'
    dirt.inputs['B'].default_value = (*lin((0.42, 0.36, 0.28)), 1)
    nt.links.new(g.outputs[0], dirt.inputs['Factor'])
    nt.links.new(col, dirt.inputs['A'])
    # rain streaks: noise stretched down the walls (the vertical surfaces), darker under edges
    sv = nt.nodes.new('ShaderNodeVectorMath'); sv.operation = 'MULTIPLY'; sv.inputs[1].default_value = (3.0, 3.0, 0.22)
    nt.links.new(geo.outputs['Position'], sv.inputs[0])
    sn = nt.nodes.new('ShaderNodeTexNoise'); sn.inputs['Scale'].default_value = 2.2; sn.inputs['Detail'].default_value = 3
    nt.links.new(sv.outputs['Vector'], sn.inputs['Vector'])
    sr = nt.nodes.new('ShaderNodeMapRange'); sr.inputs['From Min'].default_value = 0.52; sr.inputs['From Max'].default_value = 0.75
    sr.inputs['To Min'].default_value = 0.0; sr.inputs['To Max'].default_value = streak
    nt.links.new(sn.outputs['Fac'], sr.inputs['Value'])
    sepn = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Normal'], sepn.inputs[0])
    vert = nt.nodes.new('ShaderNodeMath'); vert.operation = 'ABSOLUTE'; nt.links.new(sepn.outputs['Z'], vert.inputs[0])
    vm = nt.nodes.new('ShaderNodeMath'); vm.operation = 'SUBTRACT'; vm.inputs[0].default_value = 1.0; nt.links.new(vert.outputs[0], vm.inputs[1])
    sm = nt.nodes.new('ShaderNodeMath'); sm.operation = 'MULTIPLY'; nt.links.new(sr.outputs['Result'], sm.inputs[0]); nt.links.new(vm.outputs[0], sm.inputs[1])
    st = nt.nodes.new('ShaderNodeMix'); st.data_type = 'RGBA'; st.blend_type = 'MULTIPLY'
    st.inputs['B'].default_value = (*lin((0.36, 0.33, 0.30)), 1)
    nt.links.new(sm.outputs[0], st.inputs['Factor']); nt.links.new(dirt.outputs['Result'], st.inputs['A'])
    dirt = st
    # value variation over a few metres
    n2 = nt.nodes.new('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = 0.35; n2.inputs['Detail'].default_value = 2
    nt.links.new(geo.outputs['Position'], n2.inputs['Vector'])
    rng = nt.nodes.new('ShaderNodeMapRange')
    rng.inputs['To Min'].default_value = 1 - vary
    rng.inputs['To Max'].default_value = 1 + vary
    nt.links.new(n2.outputs['Fac'], rng.inputs['Value'])
    v = nt.nodes.new('ShaderNodeMix'); v.data_type = 'RGBA'; v.blend_type = 'MULTIPLY'; v.inputs['Factor'].default_value = 1
    nt.links.new(dirt.outputs['Result'], v.inputs['A'])
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    for k in 'XYZ':
        nt.links.new(rng.outputs['Result'], comb.inputs[k])
    nt.links.new(comb.outputs[0], v.inputs['B'])
    return v.outputs['Result']


def tex(name, lib, tint=None, scale=1.0, grime=0.35, strength=1.0, contrast=1.0, sheen=None):
    """a material from a downloaded texture set (lib: its folder name), repeated every `scale` metres (the part's
    'uv' map is a box projection in metres); tint: keep the texture's light and shade, take this colour's hue"""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    nt, bsdf = _nodes(m)
    uv = nt.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'uv'
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1 / scale, 1 / scale, 1)
    nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])
    d = os.path.join(LIB, lib)
    col = nt.nodes.new('ShaderNodeTexImage'); col.image = _img(os.path.join(d, 'color.jpg'))
    nt.links.new(mp.outputs['Vector'], col.inputs['Vector'])
    c = col.outputs['Color']
    if contrast != 1.0:
        bc = nt.nodes.new('ShaderNodeBrightContrast'); bc.inputs['Contrast'].default_value = (contrast - 1) * 0.5
        nt.links.new(c, bc.inputs['Color']); c = bc.outputs['Color']
    if sheen is not None:
        sm = mirror(name + '_sheen', **sheen)
        snt = sm.node_tree
        ramp_out = next(n for n in snt.nodes if n.type == 'VALTORGB')
        # rebuild the same ramp here (materials do not share nodes): copy the nodes' settings
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Normal'], sep.inputs[0])
        mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = -1.2; mr.inputs['From Max'].default_value = 1.2
        nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        r0 = ramp_out.color_ramp
        while len(ramp.color_ramp.elements) < len(r0.elements):
            ramp.color_ramp.elements.new(0.5)
        for a, b in zip(ramp.color_ramp.elements, r0.elements):
            a.position = b.position; a.color = b.color
        nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
        bw = nt.nodes.new('ShaderNodeRGBToBW'); nt.links.new(c, bw.inputs['Color'])
        k = nt.nodes.new('ShaderNodeMath'); k.operation = 'MULTIPLY'; k.inputs[1].default_value = 2.2
        nt.links.new(bw.outputs[0], k.inputs[0])
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1
        nt.links.new(ramp.outputs['Color'], mx.inputs['A'])
        cb = nt.nodes.new('ShaderNodeCombineXYZ')
        for kk in 'XYZ':
            nt.links.new(k.outputs[0], cb.inputs[kk])
        nt.links.new(cb.outputs[0], mx.inputs['B'])
        c = mx.outputs['Result']
        bpy.data.materials.remove(sm); _mats.pop(name + '_sheen', None)
    if tint is not None:
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'COLOR'; mx.inputs['Factor'].default_value = strength
        mx.inputs['B'].default_value = (*lin(tint), 1)
        nt.links.new(c, mx.inputs['A']); c = mx.outputs['Result']
    if os.path.exists(os.path.join(d, 'ao.jpg')):
        ao = nt.nodes.new('ShaderNodeTexImage'); ao.image = _img(os.path.join(d, 'ao.jpg'), True)
        nt.links.new(mp.outputs['Vector'], ao.inputs['Vector'])
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 0.8
        nt.links.new(c, mx.inputs['A']); nt.links.new(ao.outputs['Color'], mx.inputs['B']); c = mx.outputs['Result']
    nt.links.new(_weather(nt, c, grime, streak=min(0.5, grime * 1.3)), bsdf.inputs['Base Color'])
    if os.path.exists(os.path.join(d, 'normal.jpg')):
        nm = nt.nodes.new('ShaderNodeTexImage'); nm.image = _img(os.path.join(d, 'normal.jpg'), True)
        nt.links.new(mp.outputs['Vector'], nm.inputs['Vector'])
        nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.uv_map = 'uv'; nmap.inputs['Strength'].default_value = 1.0
        nt.links.new(nm.outputs['Color'], nmap.inputs['Color']); nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    m['pw_kind'] = 'tex'
    _mats[name] = m
    return m


def paint(name, color, grime=0.3, rough=0.6, noise=0.06):
    """a painted or plain surface: the colour with a fine mottling"""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    nt, bsdf = _nodes(m)
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 9; n.inputs['Detail'].default_value = 8
    nt.links.new(geo.outputs['Position'], n.inputs['Vector'])
    rng = nt.nodes.new('ShaderNodeMapRange'); rng.inputs['To Min'].default_value = 1 - noise; rng.inputs['To Max'].default_value = 1 + noise
    nt.links.new(n.outputs['Fac'], rng.inputs['Value'])
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1
    mx.inputs['A'].default_value = (*lin(color), 1)
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    for k in 'XYZ':
        nt.links.new(rng.outputs['Result'], comb.inputs[k])
    nt.links.new(comb.outputs[0], mx.inputs['B'])
    nt.links.new(_weather(nt, mx.outputs['Result'], grime, streak=min(0.5, grime * 1.3)), bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    m['pw_kind'] = 'paint'
    _mats[name] = m
    return m


def mirror(name, sky=(0.78, 0.86, 0.95), horizon=(0.22, 0.24, 0.27), ground=(0.30, 0.25, 0.20), dark=1.0):
    """chrome and glass for a game lit without reflections: the sky above, a dark horizon band and the ground below
    are painted into the colour by the direction the surface faces (how games of 2006 drew chrome)"""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    nt, bsdf = _nodes(m)
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Normal'], sep.inputs[0])
    # a little of the position, so flat panels get a gradient rather than one colour
    sp = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Position'], sp.inputs[0])
    k = nt.nodes.new('ShaderNodeMath'); k.operation = 'MULTIPLY_ADD'; k.inputs[1].default_value = 0.6
    nt.links.new(sep.outputs['Z'], k.inputs[0])
    kz = nt.nodes.new('ShaderNodeMath'); kz.operation = 'MULTIPLY'; kz.inputs[1].default_value = 0.25
    nt.links.new(sp.outputs['Z'], kz.inputs[0]); nt.links.new(kz.outputs[0], k.inputs[2])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    r = ramp.color_ramp
    r.elements[0].position = 0.0; r.elements[0].color = (*lin([c * dark for c in ground]), 1)
    r.elements[1].position = 1.0; r.elements[1].color = (*lin([c * dark for c in sky]), 1)
    e = r.elements.new(0.42); e.color = (*lin([c * dark for c in horizon]), 1)
    e = r.elements.new(0.50); e.color = (*lin([min(1, c * dark * 1.5) for c in horizon]), 1)
    e = r.elements.new(0.60); e.color = (*lin([c * dark * 0.8 for c in sky]), 1)
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = -1.2; mr.inputs['From Max'].default_value = 1.2
    nt.links.new(k.outputs[0], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    m['pw_kind'] = 'mirror'
    _mats[name] = m
    return m


def party(name='party', grey=0.82, grime=0.3):
    """the owner's colour: baked as a light grey, the game multiplies it by the player's colour (GSF flag 0x1000)"""
    m = paint(name, (grey, grey, grey), grime=grime, noise=0.05)
    m['pw_party'] = True
    return m


def glow(name, color, strength=1.0):
    """a lit sign or lamp: its colour also goes into the emissive texture"""
    m = paint(name, color, grime=0.0, noise=0.0)
    m['pw_glow'] = strength
    return m


# ------------------------------------------------------------------------------------------------ geometry
PARTS = []


def _obj(bm, mat, name='part', uvscale=1.0, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    _box_uv(me, uvscale)
    PARTS.append(ob)
    return ob


def _box_uv(me, scale):
    """'uv': each face projected along its main axis, in metres / scale (textures repeat every `scale` m)"""
    uv = me.uv_layers.new(name='uv')
    for p in me.polygons:
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 2:
                u, v = co.x, co.y * (1 if n.z > 0 else -1)
            elif ax == 0:
                u, v = co.y * (1 if n.x > 0 else -1), co.z
            else:
                u, v = co.x * (-1 if n.y > 0 else 1), co.z
            uv.data[li].uv = (u / scale, v / scale)


def _xf(bm, loc=(0, 0, 0), rot=(0, 0, 0)):
    M = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X')
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)


def _bevel(bm, w, segs=1):
    if w > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=w, segments=segs, affect='EDGES', profile=0.5, clamp_overlap=True)


def box(size, loc, mat, rot=(0, 0, 0), bevel=0.0, segs=1, uvscale=1.0):
    """size (x, y, z), loc = the centre of the bottom face"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((0, 0, size[2] / 2)), verts=bm.verts)
    _bevel(bm, bevel, segs)
    _xf(bm, loc, rot)
    return _obj(bm, mat, uvscale=uvscale)


def cyl(r, h, loc, mat, segs=16, rot=(0, 0, 0), r2=None, bevel=0.0, cap=True, uvscale=1.0, smooth=True):
    """a cylinder (cone with r2) standing on loc, along z (rot turns it)"""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=h)
    bmesh.ops.translate(bm, vec=Vector((0, 0, h / 2)), verts=bm.verts)
    _bevel(bm, bevel)
    _xf(bm, loc, rot)
    return _obj(bm, mat, uvscale=uvscale, smooth=smooth)


def prism(profile, depth, loc, mat, axis='x', bevel=0.0, rot=(0, 0, 0), uvscale=1.0, smooth=False):
    """a 2D profile [(a, z) ...] (counter-clockwise) extruded `depth` along axis (centred): gables, roofs, ramps"""
    bm = bmesh.new()
    vs = []
    for a, z in profile:
        vs.append(bm.verts.new((-depth / 2, a, z) if axis == 'x' else (a, -depth / 2, z)))
    f = bm.faces.new(vs)
    bmesh.ops.recalc_face_normals(bm, faces=[f])
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [v for v in r['geom'] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((depth, 0, 0)) if axis == 'x' else Vector((0, depth, 0)), verts=nv)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _bevel(bm, bevel)
    _xf(bm, loc, rot)
    return _obj(bm, mat, uvscale=uvscale, smooth=smooth)


def loft(sections, mat, loc=(0, 0, 0), ring=16, smooth=True, cap=True, uvscale=1.0):
    """a body lofted through cross-sections along y: [(y, half width, z bottom, z top, round 0..1, top width factor)]
    each a rounded rectangle (round: the share of the half width / height turned into a corner)"""
    bm = bmesh.new()
    rings = []
    for y, hw, zb, zt, rnd, topw in sections:
        pts = _rrect(hw, zb, zt, rnd, topw, ring)
        rings.append([bm.verts.new((x, y, z)) for x, z in pts])
    for a, b in zip(rings, rings[1:]):
        n = len(a)
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _xf(bm, loc)
    return _obj(bm, mat, uvscale=uvscale, smooth=smooth)


def _rrect(hw, zb, zt, rnd, topw, n):
    """points of a rounded rectangle (x, z), counter-clockwise seen from -y, n per quarter; the top narrower (topw)"""
    h = (zt - zb) / 2
    zc = zb + h
    rx, rz = hw * rnd, min(h, hw) * rnd
    out = []
    q = max(2, n // 4)
    corners = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
    for k, (sx, sz) in enumerate(corners):
        w = hw * (topw if sz > 0 else 1.0)
        cx, cz = sx * (w - rx), zc + sz * (h - rz)
        a0 = [0, 90, 180, 270][k]
        for i in range(q + 1):
            a = math.radians(a0 + 90 * i / q)
            out.append((cx + rx * math.cos(a), cz + rz * math.sin(a)))
    return out


def array(fn, n, step, start=(0, 0, 0)):
    for i in range(n):
        fn(tuple(start[j] + step[j] * i for j in range(3)))


# ------------------------------------------------------------------------------------------------ bake + write
def finish(name, out_dir, kind='prop', size=1024, ao_dist=1.2, samples=48, scale=1.0):
    """join the parts, unwrap, bake colour + AO (+ glow) into one texture, write <out>/models/<name>.glb and
    <out>/tex/<name>.jpg; returns (lo, hi, triangles) of the model in glTF axes"""
    import numpy as np
    from PIL import Image
    scn = bpy.context.scene
    bpy.ops.object.select_all(action='DESELECT')
    for o in PARTS:
        o.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    PARTS.clear()
    if scale != 1.0:          # ParaWorld's proportions: buildings and machines larger than life next to its units
        ob.scale = (scale, scale, scale)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        ao_dist *= scale
    me = ob.data
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.object.mode_set(mode='OBJECT')
    # the bake map
    bake_uv = me.uv_layers.new(name='bake')
    me.uv_layers.active = bake_uv
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    # the bake
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.cycles.samples = samples
    scn.render.bake.margin = 6
    scn.render.bake.use_clear = True
    if scn.world is None:
        scn.world = bpy.data.worlds.new('w')
    scn.world.light_settings.distance = ao_dist
    imgs = {}
    for key in ('color', 'ao', 'seam', 'normal', 'glow'):
        im = bpy.data.images.new(f'{name}_{key}', size, size, alpha=False, float_buffer=False)
        if key != 'color':
            im.colorspace_settings.name = 'Non-Color'
        imgs[key] = im
    glowing = [m for m in me.materials if m.get('pw_glow')]

    def target(im):
        for m in me.materials:
            nt = m.node_tree
            t = nt.nodes.get('_bake') or nt.nodes.new('ShaderNodeTexImage')
            t.name = '_bake'
            t.image = im
            nt.nodes.active = t

    target(imgs['color'])
    scn.cycles.samples = 4
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, uv_layer='bake')
    target(imgs['ao'])
    scn.cycles.samples = samples
    bpy.ops.object.bake(type='AO', uv_layer='bake')
    # a short AO: dark seams and contact lines, the painted edges of ParaWorld's textures
    scn.world.light_settings.distance = 0.12 * scale
    target(imgs['seam'])
    bpy.ops.object.bake(type='AO', uv_layer='bake')
    scn.world.light_settings.distance = ao_dist
    # which way each texel faces (object space, z up): the painted light from above
    # (the shapes' own normals: the materials' normal maps are switched off for this bake)
    nmaps = [n for m in me.materials for n in m.node_tree.nodes if n.type == 'NORMAL_MAP']
    for n in nmaps:
        n.mute = True
    target(imgs['normal'])
    scn.cycles.samples = 2
    scn.render.bake.normal_space = 'OBJECT'
    bpy.ops.object.bake(type='NORMAL', uv_layer='bake')
    for n in nmaps:
        n.mute = False
    if glowing:
        # glow mask: the glowing materials white, the rest black (an emission bake of a temporary emission shader)
        saved = {}
        for m in me.materials:
            nt = m.node_tree
            out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
            saved[m.name] = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].links else None
            em = nt.nodes.new('ShaderNodeEmission'); em.name = '_em'
            g = m.get('pw_glow') or 0.0
            em.inputs['Color'].default_value = (g, g, g, 1)
            nt.links.new(em.outputs[0], out.inputs['Surface'])
        target(imgs['glow'])
        scn.cycles.samples = 4
        bpy.ops.object.bake(type='EMIT', uv_layer='bake')
        for m in me.materials:
            nt = m.node_tree
            out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
            if saved[m.name] is not None:
                nt.links.new(saved[m.name], out.inputs['Surface'])
            nt.nodes.remove(nt.nodes['_em'])

    def arr(im):
        a = np.array(im.pixels[:], dtype=np.float32).reshape(size, size, 4)[::-1, :, :3]
        return a

    col = arr(imgs['color'])
    ao = arr(imgs['ao'])[..., :1]
    seam = arr(imgs['seam'])[..., :1]
    nrm = arr(imgs['normal']) * 2 - 1
    final = paint_over(col, ao, seam, nrm, size)
    tex_dir = os.path.join(out_dir, 'tex'); mod_dir = os.path.join(out_dir, 'models')
    os.makedirs(tex_dir, exist_ok=True); os.makedirs(mod_dir, exist_ok=True)
    Image.fromarray((final * 255 + 0.5).astype(np.uint8)).save(os.path.join(tex_dir, name + '.jpg'), quality=90)
    has_glow = False
    if glowing:
        g = arr(imgs['glow'])
        if g.max() > 0.01:
            has_glow = True
            Image.fromarray((np.clip(g * final * 1.6, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(tex_dir, name + '_glow.jpg'), quality=90)
    # write: one material (two with the party colour), the bake map as the only UV map
    me.uv_layers.remove(me.uv_layers['uv'])
    is_party = [bool(me.materials[p.material_index].get('pw_party')) for p in me.polygons]
    me.materials.clear()
    me.materials.append(bpy.data.materials.new(name))
    if any(is_party):
        me.materials.append(bpy.data.materials.new(name + '_party'))
        for p, f in zip(me.polygons, is_party):
            p.material_index = 1 if f else 0
    path = os.path.join(mod_dir, name + '.glb')
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_image_format='NONE',
                              export_materials='EXPORT', export_yup=True, export_apply=True, export_normals=True,
                              export_texcoords=True, export_extras=False, export_animations=False)
    return _post(path, name, kind, has_glow)


def paint_over(col, ao, seam, nrm, size, seed=7):
    """the look of ParaWorld's hand-painted textures over the baked colour: the photo grain partly smoothed into
    flat brushy patches (a Kuwahara filter), the ambient occlusion and dark seams painted in, light from above (upward
    faces lighter, the undersides darker), the edges of the shapes picked out lighter, slow blotches of colour over
    the surface, then warmer and more saturated"""
    import numpy as np
    c = 0.6 * kuwahara(col, 2 if size >= 1024 else 1) + 0.4 * col
    nz = nrm[..., 2:3]
    # edges: where the direction the surface faces turns from one texel to the next
    g = np.zeros(nrm.shape[:2], dtype=np.float32)
    g[:-1] += np.abs(np.diff(nrm, axis=0)).sum(-1)
    g[:, :-1] += np.abs(np.diff(nrm, axis=1)).sum(-1)
    edge = np.clip(g * 1.5, 0, 1)
    edge = np.maximum(edge, np.maximum(np.roll(edge, 1, 0), np.roll(edge, 1, 1)))[..., None]
    shade = (0.18 + 0.82 * np.power(np.clip(ao, 0, 1), 1.5)) * (0.35 + 0.65 * np.power(np.clip(seam, 0, 1), 1.4))
    top = 0.86 + 0.24 * (np.clip(nz, -1, 1) * 0.5 + 0.5)
    rng = np.random.default_rng(seed)
    from PIL import Image
    blot = []
    for k in range(3):
        small = (rng.random((10, 10)) * 255).astype(np.uint8)
        blot.append(np.asarray(Image.fromarray(small).resize((size, size), Image.BICUBIC), dtype=np.float32) / 255.0)
    b = np.stack(blot, -1)
    lum = b.mean(-1, keepdims=True)
    blotch = (0.84 + 0.32 * lum) * (1 + (b - lum) * 0.12)
    out = c * shade * top * blotch * (1 + 0.22 * edge)
    # worn edges: here and there along the edges the paint is chipped down to rust and dirt
    small = (rng.random((size // 4, size // 4)) * 255).astype(np.uint8)
    chip_n = np.asarray(Image.fromarray(small).resize((size, size), Image.BICUBIC), dtype=np.float32)[..., None] / 255.0
    chips = np.clip((chip_n - 0.66) * 6, 0, 1) * np.clip((edge - 0.3) * 3, 0, 1)
    out = out * (1 - 0.7 * chips) + np.array([0.30, 0.18, 0.11], dtype=np.float32) * shade * 0.7 * chips
    return grade(out)


def _post(path, name, kind, glow):
    """the glb as the remake's loader expects a sequel model: a root node with the kind, a 'body' node with the
    mesh and the attribute, one material with the texture next to the game's (../tex/<name>.jpg)"""
    d = open(path, 'rb').read()
    n = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + n])
    rest = d[20 + n:]
    mesh = j['meshes'][0]
    names = [m.get('name', '') for m in j.get('materials', [])]
    for p in mesh['primitives']:
        p['material'] = 1 if names[p.get('material', 0)].endswith('_party') else 0
        p['attributes'] = {k: v for k, v in p['attributes'].items() if k in ('POSITION', 'NORMAL', 'TEXCOORD_0')}
    mesh['name'] = 'body'
    j['meshes'] = [mesh]
    mat = {'name': name, 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0.0, 'roughnessFactor': 0.9}}
    j['images'] = [{'uri': f'../tex/{name}.jpg', 'name': name + '.jpg'}]
    j['textures'] = [{'source': 0, 'sampler': 0}]
    if glow:
        j['images'].append({'uri': f'../tex/{name}_glow.jpg', 'name': name + '_glow.jpg'})
        j['textures'].append({'source': 1, 'sampler': 0})
        mat['emissiveTexture'] = {'index': 1}
        mat['emissiveFactor'] = [1, 1, 1]
    j['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}]
    j['materials'] = [mat]
    if any(n.endswith('_party') for n in names):
        pm = json.loads(json.dumps(mat)); pm['name'] = name + '_party'; pm['extras'] = {'gsf_flags': '1000'}
        j['materials'].append(pm)
    j['nodes'] = [{'name': name, 'children': [1], 'extras': {'fourcc': 'Sqel', 'kind': kind}},
                  {'name': 'body', 'mesh': 0, 'extras': {'attr': ATTR}}]
    j['scenes'] = [{'nodes': [0]}]
    j['scene'] = 0
    j['asset']['generator'] = 'pwtk sequel art (Blender)'
    pos = j['accessors'][mesh['primitives'][0]['attributes']['POSITION']]
    lo, hi = [1e9] * 3, [-1e9] * 3
    for p in mesh['primitives']:
        a = j['accessors'][p['attributes']['POSITION']]
        lo = [min(x, y) for x, y in zip(lo, a['min'])]
        hi = [max(x, y) for x, y in zip(hi, a['max'])]
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    body = struct.pack('<I', len(js)) + b'JSON' + js + rest
    open(path, 'wb').write(b'glTF' + struct.pack('<II', 2, 12 + len(body)) + body)
    tris = sum(j['accessors'][p['indices']]['count'] for p in mesh['primitives']) // 3
    return lo, hi, tris
