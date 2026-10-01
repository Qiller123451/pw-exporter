"""Maps -> 3D files and data: the terrain (textured with the setting's ground materials), the sea, and the placed
objects with their models.

    m = ula.Map.load(path)
    files = export_map(m, install, index, 'out/berg', 'glb', objects=True)     # glb, gltf, obj, dae, stl, ply
    heightmap_png(m, 'out/berg_height.png')     16-bit greyscale, 1 pixel = 2 m, black = 0 m, white = max_height
    materials_png(m, 'out/berg_materials.png')  1 pixel = 4 m, value = ground material 0..7 (x 32 for visibility)
    objects_csv(m, 'out/berg_objects.csv')      type, name, class, model, x, y, z, heading, owner, attributes

Coordinates of the 3D files: Y up, X east, -Z north (glTF convention), metres, origin at the map's centre.
"""
import csv
import json
import math
import os
import tempfile

import numpy as np

from . import parts, scape, scene as scene_mod, writers


def to_world(m, x, y, z):
    """map coordinates -> 3D file coordinates (Y up, origin at the map centre)"""
    return np.array([x - m.w / 2.0, z, -(y - m.h / 2.0)], dtype=np.float64)


def terrain_grid(m, step=2):
    """vertices (Y up) of the terrain every `step` height samples (2 m each), normals, uvs, triangle indices"""
    H = m.heights[::step, ::step]
    ny, nx = H.shape
    xs = np.arange(nx) * 2.0 * step
    ys = np.arange(ny) * 2.0 * step
    X, Y = np.meshgrid(xs, ys)
    pos = np.stack([X - m.w / 2.0, H, -(Y - m.h / 2.0)], -1).reshape(-1, 3)
    # normals from the height gradient
    gy, gx = np.gradient(H, 2.0 * step)
    nrm = np.stack([-gx, np.ones_like(H), gy], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    uv = np.stack([X / max(m.w, 1), 1.0 - Y / max(m.h, 1)], -1).reshape(-1, 2)
    i = np.arange(nx * ny).reshape(ny, nx)
    a, b, c, d = i[:-1, :-1], i[:-1, 1:], i[1:, :-1], i[1:, 1:]
    tri = np.concatenate([np.stack([a, b, d], -1).reshape(-1, 3), np.stack([a, d, c], -1).reshape(-1, 3)])
    return pos.astype(np.float32), nrm.reshape(-1, 3).astype(np.float32), uv.astype(np.float32), tri.astype(np.uint32)


def _add_mesh(sc, name, pos, nrm, uv, tri, material):
    attrs = {'POSITION': sc.add_accessor(pos, 'VEC3', minmax=True)}
    if nrm is not None:
        attrs['NORMAL'] = sc.add_accessor(nrm, 'VEC3')
    if uv is not None:
        attrs['TEXCOORD_0'] = sc.add_accessor(uv, 'VEC2')
    idx = np.asarray(tri, dtype='<u4').reshape(-1)
    while len(sc.bin) % 4:
        sc.bin.append(0)
    data = idx.tobytes()
    sc.j['bufferViews'].append({'buffer': 0, 'byteOffset': len(sc.bin), 'byteLength': len(data), 'target': 34963})
    sc.bin += data
    sc.j['accessors'].append({'bufferView': len(sc.j['bufferViews']) - 1, 'componentType': 5125, 'count': int(idx.size), 'type': 'SCALAR'})
    sc.j['meshes'].append({'name': name, 'primitives': [{'attributes': attrs, 'indices': len(sc.j['accessors']) - 1, 'material': material}]})
    return len(sc.j['meshes']) - 1


def _add_texture_material(sc, name, image_path, **extra):
    sc.j['images'].append({'uri': os.path.basename(image_path), 'name': name})
    sc.image_files.append(image_path)
    if not sc.j['samplers']:
        sc.j['samplers'].append({'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497})
    sc.j['textures'].append({'source': len(sc.j['images']) - 1, 'sampler': 0})
    mat = {'name': name, 'pbrMetallicRoughness': {'baseColorTexture': {'index': len(sc.j['textures']) - 1},
                                                  'metallicFactor': 0.0, 'roughnessFactor': 0.95}}
    mat.update(extra)
    sc.j['materials'].append(mat)
    return len(sc.j['materials']) - 1


def _node(sc, name, mesh=None, t=None, r=None, children=None):
    n = {'name': name}
    if mesh is not None:
        n['mesh'] = mesh
    if t is not None:
        n['translation'] = [float(v) for v in t]
    if r is not None:
        n['rotation'] = [float(v) for v in r]
    if children:
        n['children'] = children
    sc.j['nodes'].append(n)
    return len(sc.j['nodes']) - 1


def model_name(m_obj, index):
    """the model of a map object: its gfx, else its class (case-insensitive), else None"""
    for cand in (m_obj.get('gfx'), m_obj.get('cls'), (m_obj.get('name') or '').rsplit('_', 1)[0]):
        if cand and index.has(cand):
            return index.get(cand)['name']
    return None


def _static_model(sc, index, name, cache):
    """a model's default look baked into static meshes of the map scene (one mesh per material) -> mesh ids"""
    if name in cache:
        return cache[name]
    from . import glb as glbmod
    path = index.convert(name)
    j, _ = glbmod.load(path)
    msc = scene_mod.compose([{'glb': path, 'hide': parts.hidden_nodes(j), 'parent': None, 'link': None}], animations=[])
    geo = msc.pose()
    # copy the model's textures / materials into the map scene
    mat_map = {}
    out = []
    groups = {}
    for g in geo:
        groups.setdefault(g['material'], []).append(g)
    for mi, gs in groups.items():
        if mi is not None and mi not in mat_map:
            mj = json.loads(json.dumps(msc.j['materials'][mi]))
            tex = mj.get('pbrMetallicRoughness', {}).get('baseColorTexture')
            if tex:
                img_i = msc.j['textures'][tex['index']]['source']
                src = msc.image_files[img_i]
                key = ('img', src)
                if key not in cache:
                    sc.j['images'].append({'uri': os.path.basename(src or 'missing.png'), 'name': os.path.basename(src or '')})
                    sc.image_files.append(src)
                    if not sc.j['samplers']:
                        sc.j['samplers'].append({'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497})
                    sc.j['textures'].append({'source': len(sc.j['images']) - 1, 'sampler': 0})
                    cache[key] = len(sc.j['textures']) - 1
                tex['index'] = cache[key]
            sc.j['materials'].append(mj)
            mat_map[mi] = len(sc.j['materials']) - 1
        pos = np.concatenate([g['pos'] for g in gs]); nrm = np.concatenate([g['nrm'] for g in gs])
        uv = np.concatenate([g['uv'] for g in gs])
        tri, o = [], 0
        for g in gs:
            tri.append(g['tri'] + o); o += len(g['pos'])
        out.append(_add_mesh(sc, '%s_%d' % (name, len(out)), pos.astype(np.float32), nrm.astype(np.float32),
                             uv.astype(np.float32), np.concatenate(tri), mat_map.get(mi)))
    cache[name] = out
    return out


def build_scene(m, install, index=None, objects=True, step=2, px_per_m=2.0, water=True, plants=False, progress=None):
    """the map as a pwexport Scene (writers.write(scene, base, fmt) saves it in any format)"""
    sc = scene_mod.Scene()
    sc.j['asset']['generator'] = 'ParaWorld Toolkit map export (pwexport)'
    tmp = tempfile.mkdtemp(prefix='pwmap_')
    if progress: progress('Ground texture', 0.05)
    tex = scape.bake(install, m.setting, m.mats, m.w, m.h, px_per_m=px_per_m)
    tex_path = os.path.join(tmp, 'terrain.jpg')
    tex.save(tex_path, quality=90)
    mat = _add_texture_material(sc, 'terrain', tex_path)
    if progress: progress('Terrain mesh', 0.2)
    pos, nrm, uv, tri = terrain_grid(m, step)
    top = []
    top.append(_node(sc, 'terrain', _add_mesh(sc, 'terrain', pos, nrm, uv, tri, mat)))
    if water and m.water > 0:
        sc.j['materials'].append({'name': 'water', 'alphaMode': 'BLEND', 'doubleSided': True,
                                  'pbrMetallicRoughness': {'baseColorFactor': [0.16, 0.36, 0.42, 0.62], 'metallicFactor': 0.0,
                                                           'roughnessFactor': 0.15}})
        w2, h2 = m.w / 2.0, m.h / 2.0
        wp = np.array([[-w2, m.water, h2], [w2, m.water, h2], [w2, m.water, -h2], [-w2, m.water, -h2]], np.float32)
        wn = np.tile([0, 1, 0], (4, 1)).astype(np.float32)
        top.append(_node(sc, 'water', _add_mesh(sc, 'water', wp, wn, None, [[0, 1, 2], [0, 2, 3]], len(sc.j['materials']) - 1)))
    if objects and index is not None:
        cache = {}
        objs = [o for o in m.objects if o['type'] != 'SLOC']
        if plants:
            objs += [dict(type='PLNT', name=p['name'], cls=p['name'], gfx=p['name'], x=p['x'], y=p['y'], z=p['z'], rot=p['rot'])
                     for p in m.plants]
        groups = {}
        missing = {}
        for o in objs:
            nm = model_name(o, index)
            if nm:
                groups.setdefault(nm, []).append(o)
            else:
                missing[o.get('cls') or o['name']] = missing.get(o.get('cls') or o['name'], 0) + 1
        kids = []
        for k, (nm, lst) in enumerate(sorted(groups.items())):
            if progress: progress('Objects: %s' % nm, 0.3 + 0.65 * k / max(1, len(groups)))
            try:
                meshes = _static_model(sc, index, nm, cache)
            except Exception:
                continue
            for o in lst:
                t = to_world(m, o['x'], o['y'], o['z'])
                a = o['rot'] / 2.0
                q = [0.0, math.sin(a), 0.0, math.cos(a)]           # heading about the up axis (map z -> Y)
                inst = [_node(sc, o['name'] + ('_%d' % i if i else ''), mi) for i, mi in enumerate(meshes)]
                kids.append(_node(sc, o['name'], t=t, r=q, children=inst))
        if kids:
            top.append(_node(sc, 'objects', children=kids))
        sc.j.setdefault('extras', {})['missing_models'] = missing
    root = _node(sc, m.name or 'map', children=top)
    sc.j['scenes'][0]['nodes'] = [root]
    sc.part_roots = [root]
    sc.j['scenes'][0]['extras'] = {'map': m.summary()}
    if progress: progress('Writing', 0.97)
    return sc


def export_map(m, install, index, base, fmt='glb', **kw):
    sc = build_scene(m, install, index, **kw)
    if fmt not in writers.FORMATS:
        raise ValueError('unknown format %s' % fmt)
    return writers.write(sc, base, fmt)


def heightmap_png(m, path):
    from PIL import Image
    H = m.heights
    top = float(H.max()) or 1.0
    img = (np.flipud(H) / top * 65535.0).astype(np.uint16)          # image row 0 = north
    Image.fromarray(img, mode='I;16').save(path)
    return path, top


def materials_png(m, path):
    from PIL import Image
    Image.fromarray((np.flipud(m.mats).astype(np.uint16) * 32).clip(0, 255).astype(np.uint8), mode='L').save(path)
    return path


def objects_csv(m, path):
    keys = sorted({k for o in m.objects for k in o.get('attr', {})})
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['type', 'name', 'class', 'model', 'x', 'y', 'z', 'heading_deg', 'owner'] + keys)
        for o in m.objects:
            w.writerow([o['type'], o['name'], o['cls'], o.get('gfx', ''), round(o['x'], 3), round(o['y'], 3), round(o['z'], 3),
                        round(math.degrees(o['rot']), 2), '' if o['owner'] is None else o['owner']] +
                       [o.get('attr', {}).get(k, '') for k in keys])
    return path


def map_json(m, path):
    d = {'summary': m.summary(), 'info': m.info, 'players': m.players, 'description': m.description,
         'objects': m.objects, 'plants': m.plants}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    return path
