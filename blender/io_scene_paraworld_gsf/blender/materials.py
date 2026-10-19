"""GSF materials <-> Blender materials, and finding the game's textures."""
import os
import re

import bpy

from ..core.materials import Material
from . import props as P

HARD_ALPHA = {0x1, 0x3, 0x5, 0xB, 0xD, 0xF}
SOFT_ALPHA = {0x2, 0x6, 0x7, 0xA, 0xE}
MOD_ORDER = ['BoosterPack1', 'Base']


class TextureFinder:
    """<Data>/<mod>/Texture/<path>_(<size>).dds, largest size first; .tga / .dds / .png without size as fallback"""

    def __init__(self, data_dir):
        self.data_dir = data_dir if data_dir and os.path.isdir(data_dir) else None
        self.roots = []
        if self.data_dir:
            mods = sorted(d for d in os.listdir(self.data_dir) if os.path.isdir(os.path.join(self.data_dir, d, 'Texture')))
            mods.sort(key=lambda m: MOD_ORDER.index(m) if m in MOD_ORDER else len(MOD_ORDER))
            self.roots = [os.path.join(self.data_dir, m, 'Texture') for m in mods]
        self.cache = {}
        self.indexes = {}

    def _index(self, root):
        """lower-case path without size suffix and extension -> [(size, path)] (the game's file names differ in case
        from the names in the archives)"""
        idx = {}
        for d, _, files in os.walk(root):
            rel = os.path.relpath(d, root)
            rel = '' if rel == '.' else rel.replace('\\', '/').lower() + '/'
            for f in files:
                stem, ext = os.path.splitext(f)
                ext = ext.lower()
                if ext not in ('.dds', '.tga', '.png'):
                    continue
                m = re.match(r'(.*)_\((\d+)\)$', stem)
                size = int(m.group(2)) if m and ext == '.dds' else (0 if ext == '.dds' else -1)
                key = rel + (m.group(1) if m and ext == '.dds' else stem).lower()
                idx.setdefault(key, []).append((size, os.path.join(d, f)))
        return idx

    def find(self, name):
        if not name or not self.roots:
            return None
        if name in self.cache:
            return self.cache[name]
        key = os.path.splitext(name.replace('\\', '/'))[0].lower()
        best = None
        for root in self.roots:
            if root not in self.indexes:
                self.indexes[root] = self._index(root)
            cands = self.indexes[root].get(key)
            if cands:
                best = max(cands)[1]           # the largest .dds, else the .tga / .png
                break
        self.cache[name] = best
        return best


def guess_data_dir(gsf_path):
    """<...>/Data/<Mod>/GSF/x.gsf -> <...>/Data"""
    d = os.path.dirname(os.path.abspath(gsf_path))
    if os.path.basename(d).lower() == 'gsf':
        data = os.path.dirname(os.path.dirname(d))
        if os.path.isdir(data):
            return data
    return ''


def _key(m):
    return (m.texture, m.normal_map, m.env_map, m.v['attributes1'], m.v['attributes2'], m.v['unk_zero'])


def _bkey(bm):
    g = bm.gsf
    return (g.texture if g.has_texture else None, g.normal_map if g.has_normal_map else None,
            g.env_map if g.has_env_map else None, P.parse_hex(g.attributes1), P.parse_hex(g.attributes2), g.unk_zero)


def to_blender(m, finder, cache):
    """core Material -> Blender material (reused when an identical one exists)"""
    if m is None or isinstance(m, int):
        return None
    k = _key(m)
    if k in cache:
        return cache[k]
    for bm in bpy.data.materials:
        if bm.gsf.is_gsf and _bkey(bm) == k:
            cache[k] = bm
            return bm
    stem = os.path.splitext(os.path.basename(m.texture or 'gsf_material'))[0] or 'gsf_material'
    bm = bpy.data.materials.new(stem)
    g = bm.gsf
    g.is_gsf = True
    P.to_props(g, P.GSF_PG_material_fields.STRUCT, m.v, 'material')
    g.has_texture = m.texture is not None
    g.texture = m.texture or ''
    g.has_normal_map = m.normal_map is not None
    g.normal_map = m.normal_map or ''
    g.has_env_map = m.env_map is not None
    g.env_map = m.env_map or ''
    build_nodes(bm, finder)
    cache[k] = bm
    return bm


def build_nodes(bm, finder):
    """simple preview shader: texture -> Principled BSDF, alpha as the material flags say"""
    g = bm.gsf
    a1 = P.parse_hex(g.attributes1)
    bm.use_nodes = True
    nt = bm.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        return
    if 'Roughness' in bsdf.inputs:
        bsdf.inputs['Roughness'].default_value = 0.9
    path = finder.find(g.texture) if finder and g.has_texture else None
    if not path:
        return
    img = bpy.data.images.load(path, check_existing=True)
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.location = (-400, 200)
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    low = a1 & 0xF
    if low in HARD_ALPHA or low in SOFT_ALPHA:
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        hard = low in HARD_ALPHA
        try:
            bm.surface_render_method = 'DITHERED' if hard else 'BLENDED'
        except (AttributeError, TypeError):
            pass
        try:
            bm.blend_method = 'CLIP' if hard else 'BLEND'
        except (AttributeError, TypeError):
            pass
        bm.use_backface_culling = False
    else:
        img.alpha_mode = 'NONE'
    npath = finder.find(g.normal_map) if (g.has_normal_map and a1 & 0x10) else None
    if npath:
        try:
            _normal_nodes(bm, nt, bsdf, npath)
        except (RuntimeError, KeyError) as e:
            print('GSF: normal map %s: %s' % (npath, e))


def _normal_nodes(bm, nt, bsdf, path):
    """the game's normal maps: DirectX y, and DXT5nm style (x in alpha) for some - rebuilt for Blender"""
    import numpy as np
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = 'Non-Color'
    px = np.zeros(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)[::97]
    swizzled = px[:, 3].std() > 0.02 and px[:, 0].std() < 0.02
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.location = (-900, -250)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    sep.location = (-650, -250)
    nt.links.new(tex.outputs['Color'], sep.inputs['Color'])
    inv = nt.nodes.new('ShaderNodeMath')
    inv.operation = 'SUBTRACT'
    inv.inputs[0].default_value = 1.0
    inv.location = (-450, -350)
    nt.links.new(sep.outputs[1], inv.inputs[1])
    comb = nt.nodes.new('ShaderNodeCombineColor')
    comb.location = (-300, -250)
    nt.links.new(tex.outputs['Alpha'] if swizzled else sep.outputs[0], comb.inputs[0])
    nt.links.new(inv.outputs[0], comb.inputs[1])
    comb.inputs[2].default_value = 1.0
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.location = (-150, -250)
    nt.links.new(comb.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])


def from_blender(bm, warn):
    """Blender material -> core Material"""
    m = Material()
    if bm is None:
        m.texture = ''
        return m
    g = bm.gsf
    if g.is_gsf:
        P.from_props(g, P.GSF_PG_material_fields.STRUCT, m.v, 'material')
        m.texture = g.texture if g.has_texture else None
        m.normal_map = g.normal_map if g.has_normal_map else None
        m.env_map = g.env_map if g.has_env_map else None
        return m
    # a material made in Blender: take the texture name from its first image
    img = None
    if bm.use_nodes and bm.node_tree:
        img = next((n.image for n in bm.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image), None)
    if img is not None:
        stem = re.sub(r'_\(\d+\)$', '', os.path.splitext(os.path.basename(img.filepath or img.name))[0])
        m.texture = stem + '.tga'
    else:
        m.texture = bm.name + '.tga'
    warn('material "%s" has no GSF settings: written with texture "%s" and no flags - set them in the material\'s '
         'GSF panel' % (bm.name, m.texture))
    return m


def material_key(m):
    return _key(m)
