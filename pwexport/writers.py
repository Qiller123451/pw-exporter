"""Write a composed Scene (pwexport.scene) to files.

    write(scene, 'out/allosaurus', 'glb')       -> ['out/allosaurus.glb']
    FORMATS                                      the built-in formats and what they keep

glb / gltf keep everything (meshes, textures, skeleton, animations). The others are static: the model is posed at the
chosen animation frame (or the rest pose) and written as plain triangles - what 3D printing, CAD and most simple
viewers want. FBX, Blender, USD and Alembic files go through Blender (pwexport.blender) when it is installed.
"""
import base64
import json
import os
import shutil
import struct

import numpy as np

from . import glb as glbmod

FORMATS = {
    'glb': {'label': 'glTF binary (.glb)', 'animated': True, 'ext': '.glb'},
    'gltf': {'label': 'glTF + textures (.gltf)', 'animated': True, 'ext': '.gltf'},
    'obj': {'label': 'Wavefront OBJ + MTL (.obj)', 'animated': False, 'ext': '.obj'},
    'dae': {'label': 'Collada (.dae)', 'animated': False, 'ext': '.dae'},
    'stl': {'label': 'STL for 3D printing (.stl)', 'animated': False, 'ext': '.stl'},
    'ply': {'label': 'Stanford PLY (.ply)', 'animated': False, 'ext': '.ply'},
}


def _safe(s):
    return ''.join(c if c.isalnum() or c in '-_.' else '_' for c in s).strip('_') or 'model'


def _mime(path):
    return 'image/png' if path.lower().endswith('.png') else 'image/jpeg'


def _final_json(scene):
    j = json.loads(json.dumps(scene.j))
    for k in ('animations', 'skins', 'textures', 'images', 'samplers', 'materials'):
        if not j.get(k):
            j.pop(k, None)
    return j


def write_glb(scene, base):
    j = _final_json(scene)
    binb = bytearray(scene.bin)
    for i, im in enumerate(j.get('images', [])):
        src = scene.image_files[i]
        if src and os.path.exists(src):
            data = open(src, 'rb').read()
            while len(binb) % 4: binb.append(0)
            j['bufferViews'].append({'buffer': 0, 'byteOffset': len(binb), 'byteLength': len(data)})
            binb += data
            im.pop('uri', None)
            im['bufferView'] = len(j['bufferViews']) - 1
            im['mimeType'] = _mime(src)
    while len(binb) % 4: binb.append(0)
    j['buffers'] = [{'byteLength': len(binb)}]
    out = base + '.glb'
    with open(out, 'wb') as f:
        f.write(glbmod.pack(j, bytes(binb)))
    return [out]


def _copy_textures(scene, folder, sub):
    """copy the images into <folder>/<sub>/ -> {image index: relative path}"""
    rel = {}
    for i, src in enumerate(scene.image_files):
        if src and os.path.exists(src):
            os.makedirs(os.path.join(folder, sub), exist_ok=True)
            name = os.path.basename(src)
            dst = os.path.join(folder, sub, name)
            if not os.path.exists(dst):
                shutil.copyfile(src, dst)
            rel[i] = sub + '/' + name
    return rel


def write_gltf(scene, base):
    folder, name = os.path.dirname(base), os.path.basename(base)
    j = _final_json(scene)
    rel = _copy_textures(scene, folder, name + '_textures')
    for i, im in enumerate(j.get('images', [])):
        if i in rel:
            im['uri'] = rel[i]
    binb = bytes(scene.bin) + b'\0' * ((-len(scene.bin)) % 4)
    j['buffers'] = [{'byteLength': len(binb), 'uri': name + '.bin'}]
    with open(base + '.bin', 'wb') as f:
        f.write(binb)
    with open(base + '.gltf', 'w', encoding='utf-8') as f:
        json.dump(j, f, indent=1)
    return [base + '.gltf', base + '.bin'] + [os.path.join(folder, r) for r in rel.values()]


def _materials(scene):
    """[(name, texture image index or None, alpha mode)] per material"""
    out = []
    for i, m in enumerate(scene.j['materials']):
        tex = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        img = scene.j['textures'][tex['index']].get('source') if tex else None
        out.append((_safe(m.get('name') or 'material_%d' % i) + '_%d' % i, img, m.get('alphaMode', 'OPAQUE')))
    return out


def write_obj(scene, base, anim=None, t=0.0):
    folder, name = os.path.dirname(base), os.path.basename(base)
    geo = scene.pose(anim, t)
    mats = _materials(scene)
    rel = _copy_textures(scene, folder, name + '_textures')
    lines = ['# ParaWorld Model Exporter', 'mtllib %s.mtl' % name]
    vo = 1
    for g in geo:
        lines.append('o %s' % _safe(g['name']))
        lines += ['v %.5f %.5f %.5f' % tuple(p) for p in g['pos']]
        lines += ['vt %.5f %.5f' % (u, 1.0 - v) for u, v in g['uv']]
        lines += ['vn %.4f %.4f %.4f' % tuple(n) for n in g['nrm']]
        if g['material'] is not None and g['material'] < len(mats):
            lines.append('usemtl %s' % mats[g['material']][0])
        for a, b, c in g['tri'] + vo:
            lines.append('f %d/%d/%d %d/%d/%d %d/%d/%d' % (a, a, a, b, b, b, c, c, c))
        vo += len(g['pos'])
    with open(base + '.obj', 'w') as f:
        f.write('\n'.join(lines) + '\n')
    ml = ['# ParaWorld Model Exporter']
    for mname, img, alpha in mats:
        ml += ['newmtl %s' % mname, 'Ka 1 1 1', 'Kd 1 1 1', 'Ks 0 0 0', 'd 1', 'illum 1']
        if img is not None and img in rel:
            ml.append('map_Kd %s' % rel[img])
            if alpha != 'OPAQUE':
                ml.append('map_d %s' % rel[img])
        ml.append('')
    with open(base + '.mtl', 'w') as f:
        f.write('\n'.join(ml))
    return [base + '.obj', base + '.mtl'] + [os.path.join(folder, r) for r in rel.values()]


def write_stl(scene, base, anim=None, t=0.0):
    geo = scene.pose(anim, t)
    tris = []
    for g in geo:
        tris.append(g['pos'][g['tri']])
    T = np.concatenate(tris) if tris else np.zeros((0, 3, 3))
    n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    rec = np.zeros(len(T), dtype=[('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
    rec['n'] = n; rec['v'] = T
    with open(base + '.stl', 'wb') as f:
        f.write(b'ParaWorld Model Exporter'.ljust(80, b' '))
        f.write(struct.pack('<I', len(T)))
        f.write(rec.tobytes())
    return [base + '.stl']


def write_ply(scene, base, anim=None, t=0.0):
    geo = scene.pose(anim, t)
    P = np.concatenate([g['pos'] for g in geo]) if geo else np.zeros((0, 3))
    N = np.concatenate([g['nrm'] for g in geo]) if geo else np.zeros((0, 3))
    UV = np.concatenate([g['uv'] for g in geo]) if geo else np.zeros((0, 2))
    F, o = [], 0
    for g in geo:
        F.append(g['tri'] + o); o += len(g['pos'])
    F = np.concatenate(F) if F else np.zeros((0, 3), int)
    head = ('ply\nformat binary_little_endian 1.0\ncomment ParaWorld Model Exporter\nelement vertex %d\n'
            'property float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\n'
            'property float s\nproperty float t\nelement face %d\nproperty list uchar int vertex_indices\nend_header\n') % (len(P), len(F))
    v = np.zeros(len(P), dtype=[('p', '<f4', 3), ('n', '<f4', 3), ('uv', '<f4', 2)])
    v['p'] = P; v['n'] = N; v['uv'] = np.c_[UV[:, 0], 1 - UV[:, 1]] if len(UV) else UV
    f = np.zeros(len(F), dtype=[('c', 'u1'), ('i', '<i4', 3)])
    f['c'] = 3; f['i'] = F
    with open(base + '.ply', 'wb') as fh:
        fh.write(head.encode('ascii')); fh.write(v.tobytes()); fh.write(f.tobytes())
    return [base + '.ply']


def write_dae(scene, base, anim=None, t=0.0):
    folder, name = os.path.dirname(base), os.path.basename(base)
    geo = scene.pose(anim, t)
    mats = _materials(scene)
    rel = _copy_textures(scene, folder, name + '_textures')
    used = sorted({g['material'] for g in geo if g['material'] is not None})
    X = []
    X.append('<?xml version="1.0" encoding="utf-8"?>')
    X.append('<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">')
    X.append('<asset><contributor><authoring_tool>ParaWorld Model Exporter</authoring_tool></contributor>'
             '<unit name="meter" meter="1"/><up_axis>Y_UP</up_axis></asset>')
    X.append('<library_images>')
    for i, r in rel.items():
        X.append('<image id="img%d"><init_from>%s</init_from></image>' % (i, r))
    X.append('</library_images><library_effects>')
    for mi in used:
        mname, img, _ = mats[mi]
        if img is not None and img in rel:
            X.append('<effect id="fx%d"><profile_COMMON><newparam sid="s%d"><surface type="2D"><init_from>img%d</init_from></surface></newparam>'
                     '<newparam sid="p%d"><sampler2D><source>s%d</source></sampler2D></newparam><technique sid="t"><lambert><diffuse>'
                     '<texture texture="p%d" texcoord="UV0"/></diffuse></lambert></technique></profile_COMMON></effect>' % (mi, mi, img, mi, mi, mi))
        else:
            X.append('<effect id="fx%d"><profile_COMMON><technique sid="t"><lambert><diffuse><color>0.8 0.8 0.8 1</color></diffuse></lambert></technique></profile_COMMON></effect>' % mi)
    X.append('</library_effects><library_materials>')
    for mi in used:
        X.append('<material id="m%d" name="%s"><instance_effect url="#fx%d"/></material>' % (mi, mats[mi][0], mi))
    X.append('</library_materials><library_geometries>')
    nodes = []
    for k, g in enumerate(geo):
        gid = 'g%d' % k
        P, N, UV, T = g['pos'], g['nrm'], np.c_[g['uv'][:, 0], 1 - g['uv'][:, 1]], g['tri']
        fl = lambda a: ' '.join('%.5f' % x for x in a.reshape(-1))
        X.append('<geometry id="%s" name="%s"><mesh>' % (gid, _safe(g['name'])))
        for sid, arr, st, params in (('p', P, 3, 'XYZ'), ('n', N, 3, 'XYZ'), ('t', UV, 2, 'ST')):
            X.append('<source id="%s-%s"><float_array id="%s-%s-a" count="%d">%s</float_array><technique_common>'
                     '<accessor source="#%s-%s-a" count="%d" stride="%d">%s</accessor></technique_common></source>'
                     % (gid, sid, gid, sid, arr.size, fl(arr), gid, sid, len(arr), st,
                        ''.join('<param name="%s" type="float"/>' % c for c in params)))
        X.append('<vertices id="%s-v"><input semantic="POSITION" source="#%s-p"/></vertices>' % (gid, gid))
        mat = 'm%d' % g['material'] if g['material'] is not None else 'none'
        idx = ' '.join('%d %d %d' % (i, i, i) for i in T.reshape(-1))
        X.append('<triangles material="%s" count="%d"><input semantic="VERTEX" source="#%s-v" offset="0"/>'
                 '<input semantic="NORMAL" source="#%s-n" offset="1"/><input semantic="TEXCOORD" source="#%s-t" offset="2" set="0"/>'
                 '<p>%s</p></triangles></mesh></geometry>' % (mat, len(T), gid, gid, gid, idx))
        bind = ('<bind_material><technique_common><instance_material symbol="%s" target="#%s"><bind_vertex_input semantic="UV0" '
                'input_semantic="TEXCOORD" input_set="0"/></instance_material></technique_common></bind_material>' % (mat, mat)) \
            if g['material'] is not None else ''
        nodes.append('<node id="n%d" name="%s"><instance_geometry url="#%s">%s</instance_geometry></node>' % (k, _safe(g['name']), gid, bind))
    X.append('</library_geometries><library_visual_scenes><visual_scene id="scene">')
    X += nodes
    X.append('</visual_scene></library_visual_scenes><scene><instance_visual_scene url="#scene"/></scene></COLLADA>')
    with open(base + '.dae', 'w', encoding='utf-8') as f:
        f.write('\n'.join(X))
    return [base + '.dae'] + [os.path.join(folder, r) for r in rel.values()]


def write(scene, base, fmt, anim=None, t=0.0):
    os.makedirs(os.path.dirname(os.path.abspath(base)), exist_ok=True)
    if fmt == 'glb':
        return write_glb(scene, base)
    if fmt == 'gltf':
        return write_gltf(scene, base)
    if fmt == 'obj':
        return write_obj(scene, base, anim, t)
    if fmt == 'stl':
        return write_stl(scene, base, anim, t)
    if fmt == 'ply':
        return write_ply(scene, base, anim, t)
    if fmt == 'dae':
        return write_dae(scene, base, anim, t)
    raise ValueError('unknown format %s' % fmt)
