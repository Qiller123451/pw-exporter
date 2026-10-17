"""HD versions of the game's models (a proof of concept): finer meshes and four times sharper textures, made on the
player's computer from the game's own models - nothing of the game is stored in the toolkit.

Two variants of a model, side by side with the original:
  hd        the same look with more detail: curved PN triangles (tessellate.py) - the original vertices stay put, the
            facets round off, hard edges stay; textures enlarged 4x by Real-ESRGAN (esrgan.py) with a normal map
            from their relief (textures.py)
  remodel   rebuilt: fine curved PN patches (16 or 64 triangles each), then in Blender (remodel_blender.py) seams
            welded, the texture's relief carved into the surface as geometry and the normals made anew by angle;
            the same textures and normal maps

    python -m pwexport.hd <prepared data folder> seas_turret seas_gunner_s4 seas_lumberjack_minigun [--only hd|remodel]

The source is the remake's prepared data (<data>/assets/models/<name>.glb and ../tex), so the result fits the
remake and the shooter exactly (same nodes, skins, animations and extras); the exporter's viewer shows it too.
Output: <toolkit data>/hd/<name>/{hd,remodel}.glb + info.json. The viewer and the shooter look there and in the
folder "hd" next to the toolkit (find()).
"""
import json
import os
import subprocess
import sys
import tempfile
import time

import numpy as np

from .gltf import Gltf
from . import tessellate, textures

VARIANTS = ('hd', 'remodel')
LABELS = {'hd': 'HD', 'remodel': 'HD remodelled'}
HERE = os.path.dirname(os.path.abspath(__file__))
TOOLKIT = os.path.dirname(os.path.dirname(HERE))


def hd_dirs():
    """where HD models are looked for: the toolkit's data folder, then the folder "hd" next to the toolkit"""
    from ..config import data_home
    return [os.path.join(data_home(), 'hd'), os.path.join(TOOLKIT, 'hd')]


def find(name):
    """{variant: path} of the HD versions of a model ({} if there are none)"""
    out = {}
    for d in hd_dirs():
        for v in VARIANTS:
            p = os.path.join(d, name.lower(), v + '.glb')
            if v not in out and os.path.isfile(p):
                out[v] = p
    return out


def available():
    """{model: [variants]} of every HD model there is"""
    out = {}
    for d in hd_dirs():
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            vs = [v for v in VARIANTS if os.path.isfile(os.path.join(d, name, v + '.glb'))]
            if vs:
                out.setdefault(name.lower(), [])
                out[name.lower()] += [v for v in vs if v not in out[name.lower()]]
    return out


def _flags(mat):
    try:
        return int(str((mat.get('extras') or {}).get('gsf_flags', '0')).split('/')[0], 16)
    except ValueError:
        return 0


def is_effect(mat):
    """effect materials (blood decals, muzzle rays, particles: GSF flag 0x100) keep their geometry and texture"""
    return bool(_flags(mat) & 0x100) or 'baseColorTexture' not in (mat.get('pbrMetallicRoughness') or {})


def build(name, data, out_root=None, only=VARIANTS, cache=None, log=print, level=3, blender=None):
    """make the HD versions of one model of the prepared data folder `data`; returns {variant: path}"""
    from ..config import cache_dir, data_home
    src = os.path.join(data, 'assets', 'models', name.lower() + '.glb')
    tex_dir = os.path.join(data, 'assets', 'tex')
    if not os.path.isfile(src):
        raise FileNotFoundError(src)
    out_dir = os.path.join(out_root or os.path.join(data_home(), 'hd'), name.lower())
    os.makedirs(out_dir, exist_ok=True)
    cache = cache or cache_dir('hd')
    res = {}
    for variant in only:
        t0 = time.time()
        g = Gltf(src)
        hd_tex = textures.embed(g, tex_dir, cache, log)                  # {image index: {'height': png path}}
        heights = {}
        for mesh, prim in g.primitives():
            mat = g.material(prim)
            if is_effect(mat):
                continue
            ti = mat['pbrMetallicRoughness']['baseColorTexture']['index']
            heights[id(prim)] = hd_tex.get(g.j['textures'][ti]['source'], {}).get('height', '')
        if variant == 'hd':
            n0 = n1 = 0
            for mesh, prim in g.primitives():
                if id(prim) not in heights:
                    continue
                v = g.vertices(prim)
                nv = tessellate.pn_tessellate(v, level)
                n0 += len(v['indices']); n1 += len(nv['indices'])
                g.set_vertices(prim, nv)
            log('%s hd: %d -> %d triangles' % (name, n0, n1))
        else:
            n0, n1 = remodel(g, heights, log, blender)
            log('%s remodel: %d -> %d triangles' % (name, n0, n1))
        out = os.path.join(out_dir, variant + '.glb')
        size = g.save(out + '.part', extras={'hd': variant})
        os.replace(out + '.part', out)
        res[variant] = out
        log('  %s: %.1f MB, %.0f s' % (out, size / 1e6, time.time() - t0))
    info = {'model': name.lower(), 'source': src, 'source_mtime': os.path.getmtime(src), 'variants': sorted(find(name)), 'made': time.time()}
    with open(os.path.join(out_dir, 'info.json'), 'w') as f:
        json.dump(info, f, indent=1)
    return res


def remodel(g, heights, log, blender=None):
    """run remodel_blender.py over the textured primitives of g and put the results in; -> triangles before, after"""
    parts, prims = {}, []
    total = sum(len(g.vertices(p)['indices']) for _, p in g.primitives() if id(p) in heights)
    level = 8 if total <= 2500 else 4                        # 64 or 16 triangles each: the relief needs vertices
    for mesh, prim in g.primitives():
        if id(prim) not in heights:
            continue
        v0 = g.vertices(prim)
        # finer first, on the full curved patches (Catmull-Clark - Blender's or a Loop subdivision - would slide the
        # texture over the surface: a painted rivet comes out as a heart)
        v = tessellate.pn_tessellate(v0, level, bend=0.9)
        k = 'p%d' % len(prims)
        P = v['POSITION']
        diag = float(np.linalg.norm(P.max(0) - P.min(0))) if len(P) else 1.0
        J = v.get('JOINTS_0', np.zeros((len(P), 4), np.int64))
        W = v.get('WEIGHTS_0', np.zeros((len(P), 4)))
        if 'JOINTS_0' not in v:
            W[:, 0] = 0
        parts.update({k + '_P': P, k + '_UV': v['TEXCOORD_0'], k + '_J': J, k + '_W': W, k + '_T': v['indices'],
                      k + '_H': np.array(heights[id(prim)] or ''),
                      # relief: 0.6 % of the part's size; no Catmull-Clark (done above); edges over 55 degrees
                      # shaded sharp (an octagonal column stays round)
                      k + '_S': np.array([0.006 * max(diag, 0.5), 0, 55.0])})
        prims.append((prim, 'JOINTS_0' in v, len(v0['indices'])))
    if not prims:
        return 0, 0
    with tempfile.TemporaryDirectory() as td:
        a, b = os.path.join(td, 'in.npz'), os.path.join(td, 'out.npz')
        np.savez(a, **parts)
        script = os.path.join(HERE, 'remodel_blender.py')
        cmd = _blender_cmd(script, a, b, blender)
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
        if 'PWEXPORT_OK' not in r.stdout:
            raise RuntimeError('Blender failed:\n' + (r.stdout + r.stderr)[-3000:])
        d = np.load(b)
        n0 = n1 = 0
        for i, (prim, skinned, nt) in enumerate(prims):
            k = 'p%d' % i
            nv = {'POSITION': d[k + '_P'], 'NORMAL': d[k + '_N'], 'TEXCOORD_0': d[k + '_UV'], 'indices': d[k + '_T']}
            if skinned:
                nv['JOINTS_0'], nv['WEIGHTS_0'] = d[k + '_J'], d[k + '_W']
            g.set_vertices(prim, nv)
            n0 += nt; n1 += len(nv['indices'])
    return n0, n1


def _blender_cmd(script, a, b, blender=None):
    """Blender in the background, or this Python when it has the bpy module"""
    from .. import blender as bl
    exe = bl.find(blender or '')
    if exe:
        return [exe, '-b', '--factory-startup', '--python', script, '--', a, b]
    try:
        import importlib.util
        if importlib.util.find_spec('bpy'):
            return [sys.executable, script, a, b]
    except (ImportError, ValueError):
        pass
    raise RuntimeError('the remodelled variant needs Blender (https://www.blender.org) - set its path in the exporter')
