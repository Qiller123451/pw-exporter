"""Editing scenarios inside Blender: change a mesh, a property, an animation; add / remove animations; build a new
skinned, animated model from scratch with links and an emitter; save; read the result back and check it.

    python tests/blender_edit_test.py <Data/Base/GSF folder> <output folder>
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bpy  # noqa: E402
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Quaternion  # noqa: E402

import io_scene_paraworld_gsf as addon  # noqa: E402
from io_scene_paraworld_gsf.core import GsfArchive, vertex as VX, normals as NRM  # noqa: E402
from io_scene_paraworld_gsf.blender import compat  # noqa: E402

gsf_dir, out_dir = sys.argv[-2], sys.argv[-1]
addon.register()
fails = []


def check(cond, msg):
    print(('ok    ' if cond else 'FAIL  ') + msg)
    if not cond:
        fails.append(msg)


# ------------------------------------------------------------------ 1. mesh + property edit (hu_tools)
src = os.path.join(gsf_dir, 'hu_tools.gsf')
bpy.ops.import_scene.paraworld_gsf(filepath=src, models='hu_hoe', textures=False)
col = next(c for c in bpy.data.collections if c.gsf_archive.is_archive and c.gsf_archive.file_name == 'hu_tools')
hoe = next(o for o in bpy.data.objects if o.type == 'MESH' and o.gsf.kind == 'MESH' and o.name.startswith('hu_hoe'))
bm = bmesh.new()
bm.from_mesh(hoe.data)
for v in bm.verts:
    v.co.z += 0.25
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:10], cuts=1)
bm.to_mesh(hoe.data)
bm.free()
hoe.gsf.p_mesh.flags = '0x00000003'                 # an unknown bit set by hand
root = next(o for o in bpy.data.objects if o.gsf_model.is_root and o.gsf_model.name == 'hu_hoe')
root.gsf_model.unk_one = 7
out1 = os.path.join(out_dir, 'edit_hu_tools.gsf')
bpy.ops.export_scene.paraworld_gsf(filepath=out1, archive=col.name)
A, B = GsfArchive.load(src), GsfArchive.load(out1)
m0, m1 = A.model('hu_hoe'), B.model('hu_hoe')
c0 = next(c for c in m0.chunks if c.KIND == 'mesh')
c1 = next(c for c in m1.chunks if c.KIND == 'mesh' and c.guid == c0.guid)
check(sum(len(s.tris) for s in c1.mesh.submeshes) > sum(len(s.tris) for s in c0.mesh.submeshes), 'subdivided mesh has more triangles')
check(abs((c1.mesh.bbox[5] - c0.mesh.bbox[5]) - 0.25) < 1e-3 or abs((c1.mesh.bbox[2] - c0.mesh.bbox[2]) - 0.25) < 1e-3,
      'moved vertices: bounding box shifted by 0.25')
check(c1.v['flags'] == 3, 'mesh flags edited (0x3)')
check(m1.v['unk_one'] == 7, 'model unk_one edited')
# game-style normals on the edited mesh: unit length, pointing away from the centre roughly like before
d = VX.decode_mesh(c1.mesh.submeshes[0].raw)
check(d['normal'].max() < 511, 'normal indices inside the lookup sphere')
for n in [x for x in A.names() if x != 'hu_hoe']:
    same = A.model(n).chunks[0].mesh.submeshes[0].raw.tobytes() == B.model(n).chunks[0].mesh.submeshes[0].raw.tobytes() \
        if A.model(n).chunks and A.model(n).chunks[0].KIND == 'mesh' else True
    check(same, '%s kept byte for byte' % n)

# ------------------------------------------------------------------ 2. animation edit (all_animals / allosaurus)
src2 = os.path.join(gsf_dir, 'all_animals.gsf')
bpy.ops.import_scene.paraworld_gsf(filepath=src2, models='allosaurus', textures=False)
col2 = next(c for c in bpy.data.collections if c.gsf_archive.is_archive and c.gsf_archive.file_name == 'all_animals')
root2 = next(o for o in bpy.data.objects if o.gsf_model.is_root and o.gsf_model.name == 'allosaurus')
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE' and o.name.startswith('allosaurus'))
g = root2.gsf_model
names = [a.name for a in g.anims]
walk = next(a for a in g.anims if a.name == 'walk_1')
act = walk.tracks[0].action
bone = arm.data.bones[5].name
fc = compat.fcurve_map(act).get(('pose.bones["%s"].rotation_quaternion' % bone, 1))
if fc is None:
    fc = compat.new_fcurve(act, 'pose.bones["%s"].rotation_quaternion' % bone, 1, bone)
    compat.set_keys(fc, np.arange(act.gsf.frames), np.zeros(act.gsf.frames))
kp = fc.keyframe_points[min(3, len(fc.keyframe_points) - 1)]
kp.co.y += 0.3
fc.update()
# remove one animation, add one made from scratch
idx = next(i for i, a in enumerate(g.anims) if a.name == names[-1])
g.anims.remove(idx)
new = compat.new_action('allosaurus|wave', 'OBJECT')
for i, q in enumerate([Quaternion((0, 0, 1), math.radians(x)) for x in (0, 30, 60, 30, 0)]):
    for k in range(4):
        path = 'pose.bones["%s"].rotation_quaternion' % arm.data.bones[10].name
        f = compat.fcurve_map(new).get((path, k)) or compat.new_fcurve(new, path, k, arm.data.bones[10].name)
        f.keyframe_points.insert(i * 5, q[k])
it = g.anims.add()
it.name = 'wave'
tr = it.tracks.add()
tr.target, tr.action = arm, new
out2 = os.path.join(out_dir, 'edit_all_animals.gsf')
bpy.ops.export_scene.paraworld_gsf(filepath=out2, archive=col2.name)
A2, B2 = GsfArchive.load(src2), GsfArchive.load(out2)
a0, a1 = A2.model('allosaurus'), B2.model('allosaurus')
check(a1.anim_name(names[-1]) is None and a0.anim_name(names[-1]) is not None, 'removed animation %s is gone' % names[-1])
w = a1.anim_name('wave')
check(w is not None and w.anim.tracks and w.anim.tracks[0][1].v['num_anim_frames'] == 21, 'new animation "wave" with 21 frames')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compare  # noqa: E402
sk0 = next(c for c in a0.chunks if c.KIND == 'skeleton')
sk1 = next(c for c in a1.chunks if c.KIND == 'skeleton')
W0 = compare.bone_worlds(sk0, a0.anim_name('walk_1').anim.tracks[0][1])
W1 = compare.bone_worlds(sk1, a1.anim_name('walk_1').anim.tracks[0][1])
err = np.abs(W0 - W1).max(axis=(2, 3))
check(err[5, 3] > 0.01, 'edited key moves bone 5 at frame 3 (%.3f)' % err[5, 3])
check(err[:5].max() < 2e-3, 'bones above the edited one unchanged')
other = [n for n in names[:-1] if n != 'walk_1'][0]
check(a1.anim_name(other).anim.tracks[0][1].root.keys.tobytes() == a0.anim_name(other).anim.tracks[0][1].root.keys.tobytes(),
      'unedited animation %s written byte for byte' % other)
check(len(B2.models) == len(A2.models), 'other models of all_animals kept')

# ------------------------------------------------------------------ 3. a new model from scratch
bpy.ops.gsf.archive_new(name='my_models')
col3 = bpy.data.collections['GSF my_models']
bpy.context.scene['gsf_active_archive'] = col3.name
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.object.armature_add()
armo = bpy.context.active_object
bpy.ops.object.mode_set(mode='EDIT')
b2 = armo.data.edit_bones.new('Bone.001')
b2.head, b2.tail, b2.parent = (0, 0, 1), (0, 0, 2), armo.data.edit_bones[0]
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.mesh.primitive_cylinder_add(vertices=8, depth=2, location=(0, 0, 1))
cyl = bpy.context.active_object
cyl.parent = armo
for vg_name in ('Bone', 'Bone.001'):
    vg = cyl.vertex_groups.new(name=vg_name)
    vg.add([v.index for v in cyl.data.vertices if (v.co.z > 0) == (vg_name == 'Bone.001')], 1.0, 'REPLACE')
cyl.modifiers.new('Armature', 'ARMATURE').object = armo
mat = bpy.data.materials.new('pillar')
mat.gsf.is_gsf = True
mat.gsf.texture = 'buildings/my_pillar.tga'
mat.gsf.attributes1 = '0x00000001'
cyl.data.materials.append(mat)
link = bpy.data.objects.new('HndR', None)
bpy.context.scene.collection.objects.link(link)
link.location = (0.5, 0, 1.5)
emit = bpy.data.objects.new('smoke', None)
bpy.context.scene.collection.objects.link(emit)
emit.location = (0, 0, 2.2)
for o in (armo, cyl, link, emit):
    o.select_set(True)
bpy.context.view_layer.objects.active = armo
bpy.ops.gsf.model_new(name='my_pillar', fourcc='Deko')
link.gsf.p_link.link_fourcc = 'HndR'
emit.gsf.kind = 'PARTICLE'
emit.gsf.particle_name = 'smoke'
p = emit.gsf.params.add()
p.pname, p.ptype, p.f = 'size', 'f', 0.75
t = emit.gsf.tiles.add()
t.material = mat
cyl.gsf.p_mesh.type_id = '0x80000000'
# a bending animation
bend = compat.new_action('my_pillar|bend', 'OBJECT')
for i, ang in enumerate((0, 20, 40, 20, 0)):
    q = Quaternion((1, 0, 0), math.radians(ang))
    for k in range(4):
        path = 'pose.bones["Bone.001"].rotation_quaternion'
        f = compat.fcurve_map(bend).get((path, k)) or compat.new_fcurve(bend, path, k, 'Bone.001')
        f.keyframe_points.insert(i * 6, q[k])
proot = next(o for o in bpy.data.objects if o.gsf_model.is_root and o.gsf_model.name == 'my_pillar')
it = proot.gsf_model.anims.add()
it.name = 'standanim'
tr = it.tracks.add()
tr.target, tr.action = armo, bend
out3 = os.path.join(out_dir, 'my_models.gsf')
r = bpy.ops.export_scene.paraworld_gsf(filepath=out3, archive=col3.name)
check(r == {'FINISHED'}, 'new archive exported')
C = GsfArchive.load(out3)
pm = C.model('my_pillar')
kinds = sorted(c.KIND for c in pm.chunks)
check(kinds == ['link', 'mesh', 'particle', 'skeleton'], 'chunks of the new model: %s' % kinds)
mesh = next(c for c in pm.chunks if c.KIND == 'mesh')
check(mesh.type_id == 0x80000000 and mesh.mesh.submeshes[0].stride == 16, 'skinned mesh with 16 byte vertices')
dd = VX.decode_mesh(mesh.mesh.submeshes[0].raw)
check(set(np.unique(dd['bone_ids'][:, 0])) == {0, 1}, 'vertices weighted to both bones')
check(C.materials[pm.material_list.indices[0]].texture == 'buildings/my_pillar.tga', 'material texture name written')
sk = next(c for c in pm.chunks if c.KIND == 'skeleton')
check(len(sk.bones()) == 2 and sk.bind_poses.shape == (2, 16), 'skeleton with 2 bones and bind poses')
an = pm.anim_name('standanim')
check(an is not None and an.anim.tracks[0][1].v['num_anim_frames'] == 25, 'animation standanim, 25 frames')
Wb = compare.bone_worlds(sk, an.anim.tracks[0][1])
ang = math.degrees(math.acos(np.clip((np.trace(np.linalg.inv(Wb[1, 0][:3, :3]) @ Wb[1, 12][:3, :3]) - 1) / 2, -1, 1)))
check(abs(ang - 40) < 0.5, 'bone 1 bends 40 degrees at frame 12 (%.2f)' % ang)
part = next(c for c in pm.chunks if c.KIND == 'particle')
check(abs(part.param(0) - 0.75) < 1e-6 and part.name == 'smoke' and len(part.tiles) == 1, 'emitter parameters written')
lk = next(c for c in pm.chunks if c.KIND == 'link')
check(lk.v['link_fourcc'] == 'HndR' and abs(abs(lk.v['pos'][0]) - 0.5) < 1e-5 and abs(lk.v['pos'][2] - 1.5) < 1e-5, 'link position')
# read the new archive back into Blender
r = bpy.ops.import_scene.paraworld_gsf(filepath=out3, textures=False)
check(r == {'FINISHED'}, 'new archive imports again')
print('FAILURES:', fails or 'none')
