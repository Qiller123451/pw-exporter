"""Variant "HD remodelled": the model's surfaces rebuilt in Blender (run by hd/__init__.py; needs Blender 4.0 or newer,
or the bpy module).

    blender -b --factory-startup --python remodel_blender.py -- in.npz out.npz
    python remodel_blender.py in.npz out.npz          (with the bpy module installed)

in.npz holds the parts (one per primitive): p<k>_P positions, _UV texture coordinates, _J / _W skin joints and
weights, _T triangles, _H the height picture to carve into the surface (a .png path, may be empty), _S (strength in
metres, Catmull-Clark levels - 0: the parts come subdivided already, see subdivide.py -, crease angle in degrees).
Per part Blender
  * welds the vertices split for the texture's seams (the texture coordinates stay per corner),
  * marks the edges sharper than the crease angle as creases and sharp,
  * carves the height picture into the surface along the normals (Displace on the texture coordinates): panel
    lines, plates, cloth folds become geometry,
  * shades smooth by angle (new normals),
and writes the triangles back with their corner normals, texture coordinates and the skin weights Blender carried
through the modifiers (vertex groups "j<joint>"), the four strongest per vertex.
"""
import sys

import numpy as np


def remodel_part(bpy, P, UV, J, W, T, height, strength, levels, crease_deg):
    import bmesh
    me = bpy.data.meshes.new('part')
    me.from_pydata([tuple(p) for p in P], [], [tuple(int(i) for i in t) for t in T])
    me.update()
    ob = bpy.data.objects.new('part', me)
    bpy.context.scene.collection.objects.link(ob)
    # texture coordinates per corner (glTF v runs down, Blender's up)
    uvl = me.uv_layers.new(name='UV')
    li = np.zeros(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', li)
    uv = UV[li].copy()
    uv[:, 1] = 1.0 - uv[:, 1]
    uvl.data.foreach_set('uv', uv.reshape(-1))
    # skin weights as vertex groups
    groups = {}
    for v in range(len(P)):
        for k in range(J.shape[1]):
            if W[v, k] > 0:
                j = int(J[v, k])
                if j not in groups:
                    groups[j] = ob.vertex_groups.new(name='j%d' % j)
                groups[j].add([v], float(W[v, k]), 'ADD')
    # weld the seams, crease the sharp edges
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.normal_update()
    cl = bm.edges.layers.float.get('crease_edge') or bm.edges.layers.float.new('crease_edge')
    lim = np.radians(crease_deg)
    for e in bm.edges:
        if len(e.link_faces) != 2 or e.calc_face_angle(0.0) > lim:
            e[cl] = 1.0
            e.smooth = False
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    if levels > 0:                                         # (hd/__init__.py subdivides itself: subdivide.py)
        sub = ob.modifiers.new('sub', 'SUBSURF')
        sub.levels = sub.render_levels = levels
        sub.uv_smooth = 'NONE'
        sub.use_creases = True
    if height and strength > 0:
        img = bpy.data.images.load(height)
        tex = bpy.data.textures.new('h', 'IMAGE')
        tex.image = img
        tex.extension = 'EXTEND'
        d = ob.modifiers.new('disp', 'DISPLACE')
        d.texture = tex
        d.texture_coords = 'UV'
        d.uv_layer = 'UV'
        d.strength = strength
        d.mid_level = 0.5
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=np.radians(crease_deg))
    tri = ob.modifiers.new('tri', 'TRIANGULATE')
    if hasattr(tri, 'keep_custom_normals'):                 # (Blender < 4.2; later ones always keep them)
        tri.keep_custom_normals = True
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    m2 = ev.to_mesh()
    nv, nl, nf = len(m2.vertices), len(m2.loops), len(m2.polygons)
    co = np.zeros(nv * 3, np.float32)
    m2.vertices.foreach_get('co', co)
    lv = np.zeros(nl, np.int64)
    m2.loops.foreach_get('vertex_index', lv)
    ln = np.zeros(nl * 3, np.float32)
    if hasattr(m2, 'corner_normals'):                       # Blender 4.1+
        m2.corner_normals.foreach_get('vector', ln)
    else:
        m2.calc_normals_split()
        m2.loops.foreach_get('normal', ln)
    luv = np.zeros(nl * 2, np.float32)
    m2.uv_layers['UV'].data.foreach_get('uv', luv)
    luv = luv.reshape(-1, 2)
    luv[:, 1] = 1.0 - luv[:, 1]
    names = {g.index: int(g.name[1:]) for g in ev.vertex_groups}
    vj = np.zeros((nv, 4), np.int64)
    vw = np.zeros((nv, 4), np.float32)
    for v in m2.vertices:
        gs = sorted(((g.weight, names.get(g.group, 0)) for g in v.groups if g.weight > 0), reverse=True)[:4]
        s = sum(w for w, _ in gs) or 1.0
        for k, (w, j) in enumerate(gs):
            vj[v.index, k], vw[v.index, k] = j, w / s
    # corners -> vertices (a vertex per distinct position / normal / texture coordinate)
    ln = ln.reshape(-1, 3)
    key = np.concatenate([lv[:, None].astype(np.float64), np.round(ln * 1e4), np.round(luv * 1e5)], 1)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    out = {'P': co.reshape(-1, 3)[lv[first]], 'N': ln[first], 'UV': luv[first], 'J': vj[lv[first]], 'W': vw[lv[first]],
           'T': inv.reshape(-1).reshape(-1, 3)}
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    return out


def main(src, dst):
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    d = np.load(src, allow_pickle=False)
    parts = sorted({k.split('_')[0] for k in d.files})
    out = {}
    for p in parts:
        S = d[p + '_S']
        r = remodel_part(bpy, d[p + '_P'], d[p + '_UV'], d[p + '_J'], d[p + '_W'], d[p + '_T'], str(d[p + '_H']),
                         float(S[0]), int(S[1]), float(S[2]))
        for k, v in r.items():
            out[p + '_' + k] = v
        print('PART', p, len(d[p + '_T']), '->', len(r['T']), flush=True)
    np.savez(dst, **out)
    print('PWEXPORT_OK', flush=True)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    main(args[0], args[1])
