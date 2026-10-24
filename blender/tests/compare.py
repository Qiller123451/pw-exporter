"""Compare a model of two archives (original vs written by the add-on), in game terms.

    python tests/compare.py original.gsf exported.gsf [model ...]
"""
import os
import sys
from collections import Counter

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from io_scene_paraworld_gsf.core import GsfArchive  # noqa: E402
from io_scene_paraworld_gsf.core import vertex as VX  # noqa: E402
from io_scene_paraworld_gsf.core.chunks.base import Chunk  # noqa: E402


def tri_soup(md, mats, quant_bbox=None):
    """canonical triangle list: corners (q pos on quant_bbox, normal, u, v, extra, bones), material texture"""
    out = Counter()
    bb = quant_bbox or md.bbox
    for k, s in enumerate(md.submeshes):
        if not len(s.raw):
            continue
        d = VX.decode_mesh(s.raw)
        pos = VX.dequantize(d['q'], md.bbox)
        q = VX.quantize(pos, bb)
        flat = (np.array(bb[3:]) - np.array(bb[:3])) < 1e-5
        q[:, flat] = 0
        mat = mats[md.submesh_materials[k]] if k < len(md.submesh_materials) and md.submesh_materials[k] < len(mats) else None
        tex = getattr(mat, 'texture', None)
        for t in s.tris:
            corners = []
            for i in t:
                bones = tuple(sorted((int(b), int(w)) for b, w in zip(d['bone_ids'][i], d['bone_weights'][i])
                                     if b != 255 and w)) if 'bone_ids' in d else ()
                c = (tuple(int(x) for x in q[i]), int(d['uv'][i][0]), int(d['uv'][i][1]),
                     int(d['extra'][i]) if 'extra' in d else -1, bones)
                corners.append((c, int(d['normal'][i])))
            corners = min(corners[r:] + corners[:r] for r in range(3))
            out[(tuple(c for c, _ in corners), tex)] += 1
            out[('N',) + tuple(n for _, n in corners)] += 0
    return out


def normals_match(md0, md1, mats0, mats1):
    """fraction of corners whose normal index matches, matched by (position, uv)"""
    def corner_map(md):
        m = {}
        for s in md.submeshes:
            if not len(s.raw):
                continue
            d = VX.decode_mesh(s.raw)
            pos = VX.dequantize(d['q'], md.bbox)
            q = VX.quantize(pos, md0.bbox)
            for t in s.tris:
                key = tuple(sorted(tuple(int(x) for x in q[i]) for i in t))
                for i in t:
                    m[(key, tuple(int(x) for x in q[i]))] = int(d['normal'][i])
        return m
    a, b = corner_map(md0), corner_map(md1)
    common = set(a) & set(b)
    same = sum(1 for k in common if a[k] == b[k])
    return same, len(common), len(a)


def bone_worlds(sk, a):
    """GSF world matrices (bones, frames, 4, 4) of a bone animation on a skeleton"""
    from io_scene_paraworld_gsf.blender import bonemath as BM
    S = BM.Skeleton(sk)
    nf = max(int(a.v['num_anim_frames']), 1)
    local = np.repeat(S.local[:, None], nf, axis=1)
    for t, p in a.root.walk():
        if t.bone == 255 or t.bone >= S.n or t.v['flags'] & 2 or not len(t.keys):
            continue
        local[t.bone] = BM.track_locals(S, t.bone, t.format, t.constant, t.keys, nf, p is None)
    return BM.world_of(local, S.parent)


def anim_error(c0, a0, c1, a1, sk0, sk1):
    """largest difference between two animation chunks in game terms (metres / matrix units)"""
    if a0.KIND != a1.KIND:
        return float('inf'), 'kind %s -> %s' % (a0.KIND, a1.KIND)
    if a0.KIND == 'bone_anim':
        if sk0 is None or sk1 is None:
            return 0.0, ''
        W0, W1 = bone_worlds(sk0, a0), bone_worlds(sk1, a1)
        if W0.shape != W1.shape:
            return float('inf'), 'shape %s -> %s' % (W0.shape, W1.shape)
        e = np.abs(W0 - W1).max()
        bad = []
        if a0.v['num_anim_frames'] != a1.v['num_anim_frames']:
            bad.append('frames')
        for f in ('flags', 'loop_start_frame', 'loop_end_frame', 'attributes', 'guid'):
            if a0.v[f] != a1.v[f]:
                bad.append('%s %r -> %r' % (f, a0.v[f], a1.v[f]))
        if abs(a0.v['root_height'] - a1.v['root_height']) > 1e-4 or np.abs(np.array(a0.v['root_dist']) - a1.v['root_dist']).max() > 1e-4:
            bad.append('root height / dist')
        r0, r1 = a0.root, a1.root
        if r0.format in (0, 1) and not r0.constant and len(r0.keys) and len(r1.keys) and r1.keys.shape[1] >= 10:
            ev = np.abs(r0.keys[:, 7:10] - r1.keys[:, 7:10]).max()
            if ev > 1e-4:
                bad.append('root velocity differs by %.5f' % ev)
        return e, ', '.join(bad)
    if a0.KIND in ('particle_anim', 'speedline_anim'):
        if a0.positions.shape != a1.positions.shape:
            return float('inf'), 'positions %s -> %s' % (a0.positions.shape, a1.positions.shape)
        return float(np.abs(a0.positions - a1.positions).max()) if len(a0.positions) else 0.0, ''
    if a0.KIND == 'mesh_anim':
        def mats(a):
            if len(a.matrices):
                return np.array(a.matrices, float).reshape(-1, 4, 4)
            if len(a.key_index):
                from io_scene_paraworld_gsf.blender import bonemath as BM
                k = a.keys[np.clip(a.key_index.astype(int), 0, len(a.keys) - 1)]
                M = np.zeros((len(k), 4, 4))
                M[:, :3, :3] = np.swapaxes(BM.gsf_quat_to_mat(k[:, 3:7]), 1, 2)
                M[:, 3, :3] = k[:, :3]
                M[:, 3, 3] = 1
                return M
            return np.zeros((0, 4, 4))
        M0, M1 = mats(a0), mats(a1)
        bad = []
        if len(a0.meshes) != len(a1.meshes) or list(a0.mesh_index) != list(a1.mesh_index):
            bad.append('mesh frames %d -> %d' % (len(a0.meshes), len(a1.meshes)))
        if M0.shape != M1.shape:
            return float('inf'), 'transforms %s -> %s' % (M0.shape, M1.shape)
        return float(np.abs(M0 - M1).max()) if len(M0) else 0.0, ', '.join(bad)
    return 0.0, ''


def compare_model(m0, m1, mats0, mats1):
    issues = []
    stats = {}
    if len(m0.chunks) != len(m1.chunks):
        issues.append('chunk count %d -> %d' % (len(m0.chunks), len(m1.chunks)))
    k0 = Counter(c.KIND for c in m0.chunks if isinstance(c, Chunk))
    k1 = Counter(c.KIND for c in m1.chunks if isinstance(c, Chunk))
    if k0 != k1:
        issues.append('chunk kinds %s -> %s' % (dict(k0), dict(k1)))
    by_guid1 = {}
    for c in m1.chunks:
        if isinstance(c, Chunk):
            by_guid1.setdefault((c.KIND, c.v.get('guid')), []).append(c)
    e0 = [(i, getattr(c, 'raw', None), type(c).__name__) for i, c in enumerate(m0.chunks) if not isinstance(c, Chunk)]
    e1 = [(i, getattr(c, 'raw', None), type(c).__name__) for i, c in enumerate(m1.chunks) if not isinstance(c, Chunk)]
    if e0 != e1:
        issues.append('empty chunk slots %s -> %s' % (e0, e1))
    ml0 = [x for x in (m0.material_list.materials if m0.material_list else [])]
    ml1 = [x for x in (m1.material_list.materials if m1.material_list else [])]
    nsame = ntot = 0
    for c0 in m0.chunks:
        if not isinstance(c0, Chunk):
            continue
        lst = by_guid1.get((c0.KIND, c0.v.get('guid')), [])
        if not lst:
            issues.append('%s %08X missing' % (c0.KIND, c0.v.get('guid', 0)))
            continue
        c1 = lst.pop(0)
        if c0.type_id != c1.type_id:
            issues.append('%s %08X type %08X -> %08X' % (c0.KIND, c0.guid, c0.type_id, c1.type_id))
        for f in c0.STRUCT.fields:
            if f.kind == 'ptr' or f.derived or f.name not in c0.v:
                continue
            a, b = c0.v[f.name], c1.v.get(f.name)
            if f.kind in ('f32', 'vec3', 'quat', 'mat4', 'bbox'):
                aa, bb = np.atleast_1d(np.array(a, float)), np.atleast_1d(np.array(b, float))
                if f.kind == 'quat' and np.dot(aa, bb) < 0:
                    bb = -bb
                tol = 2e-3 if f.kind != 'bbox' else 1e-2
                if aa.shape != bb.shape or np.abs(aa - bb).max() > tol * max(1, np.abs(aa).max()):
                    issues.append('%s %08X %s %s -> %s' % (c0.KIND, c0.guid, f.name, np.round(aa, 4).tolist(), np.round(bb, 4).tolist()))
            elif a != b:
                issues.append('%s %08X %s %r -> %r' % (c0.KIND, c0.guid, f.name, a, b))
        if c0.KIND == 'mesh':
            s0 = tri_soup(c0.mesh, ml0, c0.mesh.bbox)
            s1 = tri_soup(c1.mesh, ml1, c0.mesh.bbox)
            t0 = Counter({k: v for k, v in s0.items() if k[0] != 'N'})
            t1 = Counter({k: v for k, v in s1.items() if k[0] != 'N'})
            common = sum((t0 & t1).values())
            if common != sum(t0.values()) or sum(t1.values()) != sum(t0.values()):
                issues.append('mesh %08X: %d of %d triangles identical (exported %d)' % (c0.guid, common, sum(t0.values()), sum(t1.values())))
            a, b, c = normals_match(c0.mesh, c1.mesh, ml0, ml1)
            nsame += a
            ntot += b
        if c0.KIND == 'skeleton':
            b0 = c0.bones()
            b1 = c1.bones()
            if len(b0) != len(b1):
                issues.append('skeleton bones %d -> %d' % (len(b0), len(b1)))
            else:
                bp = np.abs(np.array(c0.bind_poses, float) - np.array(c1.bind_poses, float)).max() if len(c0.bind_poses) else 0
                if bp > 1e-3:
                    issues.append('bind poses differ by %.4f' % bp)
                for (x, px), (y, py) in zip(b0, b1):
                    if x.v['guid'] != y.v['guid'] or px != py:
                        issues.append('bone order / guid differs')
                        break
        if c0.KIND in ('billboard',):
            p0 = VX.dequantize(VX.decode_billboard(c0.raw)['q'], c0.v['bounding_box'])
            p1 = VX.dequantize(VX.decode_billboard(c1.raw)['q'], c1.v['bounding_box'])
            if p0.shape != p1.shape or np.abs(p0 - p1).max() > 1e-3 * max(1, np.abs(p0).max()):
                issues.append('billboard %08X sprite positions differ' % c0.guid)
        if c0.KIND == 'particle':
            if c0.params != c1.params:
                issues.append('particle %08X params differ' % c0.guid)
            if [dict(t, material=None) for t in c0.tiles] != [dict(t, material=None) for t in c1.tiles]:
                issues.append('particle %08X tiles differ' % c0.guid)
            if c0.name != c1.name:
                issues.append('particle name %r -> %r' % (c0.name, c1.name))
    stats['normals'] = (nsame, ntot)
    # animations
    n0 = [e.name for e in m0.anim_names]
    n1 = [e.name for e in m1.anim_names]
    if n0 != n1:
        issues.append('animation names differ: %s' % sorted(set(n0) ^ set(n1))[:10])
    for e0 in m0.anim_names:
        e1 = m1.anim_name(e0.name)
        if e1 is None or e0.anim is None or e1.anim is None:
            continue
        if len(e0.anim.tracks) != len(e1.anim.tracks):
            issues.append('anim %s: %d animated chunks -> %d' % (e0.name, len(e0.anim.tracks), len(e1.anim.tracks)))
        if e0.v != e1.v or [s.name for s in e0.sounds] != [s.name for s in e1.sounds]:
            issues.append('anim %s: flags / sounds differ' % e0.name)
        sk0 = next((c for c in m0.chunks if getattr(c, 'KIND', '') == 'skeleton'), None)
        sk1 = next((c for c in m1.chunks if getattr(c, 'KIND', '') == 'skeleton'), None)
        t1 = {(c.KIND, getattr(c, 'v', {}).get('guid')): (a, n) for c, a, n in e1.anim.tracks}
        for c0, a0, n0 in e0.anim.tracks:
            hit = t1.get((c0.KIND, getattr(c0, 'v', {}).get('guid')))
            if hit is None:
                issues.append('anim %s: %s %08X not animated' % (e0.name, c0.KIND, c0.guid))
                continue
            a1, n1 = hit
            err, why = anim_error(c0, a0, None, a1, sk0, sk1)
            stats['anim_err'] = max(stats.get('anim_err', 0.0), err)
            if err > 2e-3 or why or n0 != n1:
                issues.append('anim %s %s: error %.4f %s frames %d -> %d' % (e0.name, a0.KIND, err, why, n0, n1))
    stats['anims'] = len(m0.anim_names)
    if len(m0.walksets) != len(m1.walksets) or any(
            [getattr(x, 'name', x) for x in a.slots] != [getattr(x, 'name', x) for x in b.slots] or a.name != b.name
            for a, b in zip(m0.walksets, m1.walksets)):
        issues.append('walk sets differ')
    if len(m0.collision) != len(m1.collision):
        issues.append('collision volumes %d -> %d' % (len(m0.collision), len(m1.collision)))
    else:
        for a, b in zip(m0.collision, m1.collision):
            if a.v['shape'] != b.v['shape'] or a.v['attributes'] != b.v['attributes'] or \
                    np.abs(np.array(a.v['pos'] + a.v['size']) - np.array(b.v['pos'] + b.v['size'])).max() > 1e-3:
                issues.append('collision %s -> %s' % (a.v, b.v))
    for f in ('fourcc', 'unk_one', 'unk_zero'):
        if m0.v[f] != m1.v[f]:
            issues.append('model %s %r -> %r' % (f, m0.v[f], m1.v[f]))
    if np.abs(np.array(m0.v['bounding_box']) - np.array(m1.v['bounding_box'])).max() > 1e-3:
        issues.append('bounding box %s -> %s' % (np.round(m0.v['bounding_box'], 3), np.round(m1.v['bounding_box'], 3)))
    return issues, stats


def main(a_path, b_path, names):
    A = GsfArchive.load(a_path)
    B = GsfArchive.load(b_path)
    names = names or A.names()
    for n in names:
        try:
            m0, m1 = A.model(n), B.model(n)
        except KeyError:
            print(n, 'missing')
            continue
        issues, stats = compare_model(m0, m1, None, None)
        print('%-30s %s normals %d/%d  %s' % (n, 'OK' if not issues else '%d issues' % len(issues), stats['normals'][0],
                                             stats['normals'][1], ''))
        for i in issues[:8]:
            print('    ', i)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
