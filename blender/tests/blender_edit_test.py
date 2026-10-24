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
r = bpy.ops.import_scene.paraworld_gsf(filepath=out3, open_only=False, textures=False)
check(r == {'FINISHED'}, 'new archive imports again')

# ------------------------------------------------------------------ 4. rearranging the models (the list's arrow buttons)
src4 = os.path.join(gsf_dir, 'all_misc.gsf')
bpy.ops.import_scene.paraworld_gsf(filepath=src4, open_only=True, textures=False)
col4 = next(c for c in bpy.data.collections if c.gsf_archive.is_archive and c.gsf_archive.file_name == 'all_misc')
bpy.context.scene['gsf_active_archive'] = col4.name
bpy.context.view_layer.objects.active = None          # (the panel shows the active object's archive)
g4 = col4.gsf_archive
names0 = [e.name for e in g4.entries]
check(not g4.order_changed, 'a freshly opened archive keeps its own order')
g4.entry_index = len(g4.entries) - 1
bpy.ops.gsf.entry_move(direction='TOP')
check(g4.entries[0].name == names0[-1] and g4.entry_index == 0, 'last model moved to the top')
g4.entry_index = 6
bpy.ops.gsf.entry_move(direction='UP')
bpy.ops.gsf.entry_move(direction='UP')
check(g4.entries[4].name == names0[5] and g4.entry_index == 4, 'a model moved up twice')
# an edited model moved down
g4.entry_index = 10
edited = g4.entries[10].name
bpy.ops.gsf.import_entries()
bpy.ops.gsf.entry_move(direction='DOWN')
check(g4.entries[11].name == edited and g4.entries[11].state == 'SCENE', 'an edited model moved down')
# with a filter the arrows step over the hidden models
pref = names0[20].split('_')[0] + '_'
shown = [k for k, e in enumerate(g4.entries) if pref in e.name.lower()]
if len(shown) >= 2:
    g4.filter = pref
    g4.entry_index = shown[1]
    moved = g4.entries[shown[1]].name
    bpy.ops.gsf.entry_move(direction='UP')
    check(g4.entries[shown[0]].name == moved, 'with a filter: past the hidden models to the shown one above (%s)' % pref)
    g4.filter = ''
want = [e.name for e in g4.entries if e.state != 'REMOVE']
out4 = os.path.join(out_dir, 'reordered_all_misc.gsf')
r = bpy.ops.export_scene.paraworld_gsf(filepath=out4, archive=col4.name)
D4, E4 = GsfArchive.load(src4), GsfArchive.load(out4)
check(r == {'FINISHED'} and E4.names() == want, 'saved in the order of the list')
check([m.name for m in E4.models] == want, 'model infos in the same order')
from roundtrip import Canon, compare as cmp_canon  # noqa: E402
same = [n for n in want if n != edited and not cmp_canon(Canon()(D4.model(n)), Canon()(E4.model(n)))]
check(len(same) == len(want) - 1, 'every kept model unchanged by the move (%d of %d)' % (len(same), len(want) - 1))
# ------------------------------------------------------------------ 5. LOD and kind collections
from io_scene_paraworld_gsf.blender import lods  # noqa: E402
src5 = os.path.join(gsf_dir, 'aje_buildings.gsf')
bpy.ops.import_scene.paraworld_gsf(filepath=src5, models='aje_cook_house', textures=False)
root5 = next(o for o in bpy.data.objects if o.gsf_model.is_root and o.gsf_model.name == 'aje_cook_house')
mcol5 = lods.model_collection(root5)


def _tree(c):
    return [c] + [x for ch in c.children for x in _tree(ch)]


def placed_right(root, mcol):
    inside = set(_tree(mcol))
    for o in lods.components(root, mcol):
        cs = [c for c in o.users_collection if c in inside]
        lod = lods.best_lod(o)
        lcol = [p for p in mcol.children if len(cs) == 1 and cs[0].name in p.children]
        if len(cs) != 1 or cs[0].get('gsf_value') != lods.kind_key(o) or len(lcol) != 1 or \
                lcol[0].get('gsf_value') != (-1 if lod is None else lod):
            return False
    return list(mcol.objects) == [root]


check(placed_right(root5, mcol5), 'every component in the collection of its best LOD and its kind, the root on top')
lod_names = [c.name for c in mcol5.children]
check(lod_names == sorted(lod_names), 'LOD collections in order (%s)' % ', '.join(lod_names))
m5 = next(o for o in lods.components(root5) if o.gsf.kind == 'MESH' and lods.best_lod(o) == 0)
for k in range(5):
    m5.gsf.attributes[k] = k in (2, 3)
bpy.context.view_layer.objects.active = root5
bpy.ops.gsf.sort_lods()
check(placed_right(root5, mcol5) and m5.users_collection[0].name == 'aje_cook_house Lod2 Mesh',
      'a mesh shown on LOD 2 and 3 goes to Lod2 after sorting again')
root_new = next(o for o in bpy.data.objects if o.gsf_model.is_root and o.gsf_model.name == 'my_pillar')
check(emit.users_collection[0].name == 'my_pillar Lod0 Link', 'new model: components sorted (the emitter was a link then)')
bpy.ops.object.select_all(action='DESELECT')
emit.select_set(True)
bpy.ops.gsf.set_kind(kind='PARTICLE')
check(placed_right(root_new, lods.model_collection(root_new)), 'a new model from a selection is sorted too')
# ------------------------------------------------------------------ 6. archive lists: sounds, groups, transitions, dust trails
from io_scene_paraworld_gsf.core.archive import WALK_TRANSITION_SLOT  # noqa: E402
src6 = os.path.join(gsf_dir, 'all_animals.gsf')
bpy.ops.import_scene.paraworld_gsf(filepath=src6, models='stegosaurus', textures=False)
col6 = next(c for c in bpy.data.collections if c.gsf_archive.is_archive and c.gsf_archive.file_name == 'all_animals')
bpy.context.scene['gsf_active_archive'] = col6.name
bpy.context.view_layer.objects.active = None
g6 = col6.gsf_archive
D6 = GsfArchive.load(src6)


def meaning(a):
    """what every animation refers to, by name: {model: [(anim, sounds, groups), ...] + walk transitions}"""
    out = {}
    for m in a.models:
        pos = {id(x): k for k, x in enumerate(a.sounds)}
        anims = [(e.name, [pos[id(x)] for x in e.sounds],
                  sorted(a.anim_groups[k] if k < len(a.anim_groups) else 'bit%d' % k
                         for k in range(32) if e.v['anim_flags'] >> k & 1)) for e in m.anim_names]
        wts = [a.walk_transitions[ws.slots[WALK_TRANSITION_SLOT] - 1] if ws.slots[WALK_TRANSITION_SLOT] else None
               for ws in m.walksets]
        out[m.name] = (anims, wts)
    return out


before = meaning(D6)
brach = D6.model('brachiosaurus')
gone_snd = next(x for e in brach.anim_names for x in e.sounds)             # a sound of a kept model
gone_i = D6.sounds.index(gone_snd)
stego_root = next(o for o in bpy.data.objects if o.gsf_model.is_root and o.gsf_model.name == 'stegosaurus')


def op6(which, action, index=-1):
    return bpy.ops.gsf.archive_list(which=which, action=action, index=index)


check(op6('sounds', 'REMOVE', gone_i) == {'FINISHED'} and len(g6.sounds) == len(D6.sounds) - 1, 'sound removed')
g6.sound_index = len(g6.sounds) - 1
op6('sounds', 'ADD')
g6.sounds[-1].name = 'test\\new_sound.wav'
stego_root.gsf_model.anims[0].sounds = (stego_root.gsf_model.anims[0].sounds + ',%d' % (len(g6.sounds) - 1)).strip(',')
op6('walk_transitions', 'DOWN', 0)
op6('anim_groups', 'REMOVE', 0)
g6.anim_group_index = len(g6.anim_groups) - 1
op6('anim_groups', 'ADD')
g6.anim_groups[-1].name = 'swim'
g6.dusttrail_index = len(g6.dusttrails) - 1
op6('dusttrails', 'ADD')
d6 = g6.dusttrails[-1]
d6.name, d6.model, d6.anim = 'CLevelUpFX', 'stegosaurus', stego_root.gsf_model.anims[0].name
op6('dust_entries', 'ADD')
d6.entries[0].name, d6.entries[0].value = 'force', '2'
out6 = os.path.join(out_dir, 'lists_all_animals.gsf')
r = bpy.ops.export_scene.paraworld_gsf(filepath=out6, archive=col6.name)
E6 = GsfArchive.load(out6)
after = meaning(E6)
check(r == {'FINISHED'} and E6.anim_groups == ['walk', 'fight', 'work', 'swim'], 'groups saved: %s' % E6.anim_groups)
check(E6.walk_transitions == [D6.walk_transitions[1], D6.walk_transitions[0]] + D6.walk_transitions[2:],
      'walk transitions saved in the new order')
check(len(E6.sounds) == len(D6.sounds) and E6.sounds[-1].name == 'test\\new_sound.wav', 'sound added at the end')


def expected(name):
    """sound positions: the removed one gone, the ones behind it one place up"""
    anims, wts = before[name]
    anims = [(n, [k if k < gone_i else k - 1 for k in snd if k != gone_i], [x for x in grp if x != 'idle'])
             for n, snd, grp in anims]
    return anims, wts


kept6 = [e.name for e in g6.entries if e.state == 'FILE']       # (allosaurus was edited in scenario 2)
bad = [n for n in kept6 if after.get(n) != expected(n)]
check(not bad, 'kept models refer to the same sounds, groups and walk transitions (%d models, wrong: %s)'
      % (len(kept6), bad[:5]))
ea, ewt = expected('stegosaurus')
ea[0] = (ea[0][0], ea[0][1] + [len(E6.sounds) - 1], ea[0][2])
check(after['stegosaurus'] == (ea, ewt), 'the edited model too, plus its new sound')
dt = [d for d in E6.dusttrails if d.name == 'CLevelUpFX' and d.model is E6.model('stegosaurus')]
check(len(E6.dusttrails) == len(D6.dusttrails) + 1 and dt and dt[0].entries == [('force', '2')], 'dust trail added')
# ------------------------------------------------------------------ 7. "Keep" on an imported, edited model
src7 = os.path.join(gsf_dir, 'hu_tools.gsf')
bpy.ops.import_scene.paraworld_gsf(filepath=src7, models='hu_knife', textures=False)
col7 = next(c for c in bpy.data.collections if c.gsf_archive.is_archive and c.gsf_archive.file_name == 'hu_tools')
g7 = col7.gsf_archive
knife = next(e.root for e in g7.entries if e.name == 'hu_knife' and e.root is not None)
for o in knife.children_recursive:
    if o.type == 'MESH':
        for v in o.data.vertices:
            v.co.z += 0.5
bpy.context.scene['gsf_active_archive'] = col7.name
bpy.context.view_layer.objects.active = None
for e in g7.entries:
    e.select = e.name == 'hu_knife'
bpy.ops.gsf.entry_state(state='FILE')
for e in g7.entries:
    e.select = False
out7 = os.path.join(out_dir, 'keep_hu_tools.gsf')
bpy.ops.export_scene.paraworld_gsf(filepath=out7, archive=col7.name)
D7, E7 = GsfArchive.load(src7), GsfArchive.load(out7)
check(not cmp_canon(Canon()(D7.model('hu_knife')), Canon()(E7.model('hu_knife'))),
      'an imported model set back to Keep is written from the file, not from the edited objects')
# ------------------------------------------------------------------ 8. imported bones point at their children
for mirror8 in ('X', 'Y', 'NONE'):
    before8 = set(bpy.data.objects)
    bpy.ops.import_scene.paraworld_gsf(filepath=os.path.join(gsf_dir, 'all_animals.gsf'), models='macrolemys_land',
                                       textures=False, animations=False, mirror=mirror8)
    arm8 = next(o for o in set(bpy.data.objects) - before8 if o.type == 'ARMATURE')
    pairs = [(b, c) for b in arm8.data.bones for c in b.children if (c.head_local - b.head_local).length > 1e-3]
    good = sum(b.matrix_local.col[1].to_3d().dot((c.head_local - b.head_local).normalized()) > 0.9 for b, c in pairs)
    check(good == len(pairs) and arm8.data.display_type == 'OCTAHEDRAL',
          'mirror %s: every bone points at its children (%d of %d), octahedral display' % (mirror8, good, len(pairs)))
# ------------------------------------------------------------------ 9. legacy empty / zero chunks (modded archives)
mirage = os.path.join(gsf_dir, '..', '..', 'MIRAGE', 'GSF', 'mirage_animals.gsf')
if os.path.isfile(mirage):
    from io_scene_paraworld_gsf.core.archive import EmptySlot, ZeroChunk  # noqa: E402
    names9 = 'saltasaurud,dilophosaurud,atroxosaurud'
    bpy.ops.import_scene.paraworld_gsf(filepath=mirage, models=names9, textures=False)
    col9 = next(c for c in bpy.data.collections if c.gsf_archive.is_archive and
                os.path.abspath(bpy.path.abspath(c.gsf_archive.source_path)) == os.path.abspath(mirage))
    out9 = os.path.join(out_dir, 'legacy_mirage_animals.gsf')
    bpy.ops.export_scene.paraworld_gsf(filepath=out9, archive=col9.name)
    D9, E9 = GsfArchive.load(mirage), GsfArchive.load(out9)
    for n9 in names9.split(','):
        a9, b9 = D9.model(n9), E9.model(n9)
        slots = [(type(c).__name__, getattr(c, 'raw', None)) if isinstance(c, EmptySlot) else c.KIND for c in a9.chunks]
        slots9 = [(type(c).__name__, getattr(c, 'raw', None)) if isinstance(c, EmptySlot) else c.KIND for c in b9.chunks]
        same_hdr = all(a9.v[k] == b9.v[k] for k in ('num_chunks', 'first_link_chunk_index', 'num_link_chunks', 'num_cloth_chunks'))
        issues9, _ = compare.compare_model(a9, b9, None, None)
        check(slots == slots9 and same_hdr and not issues9,
              '%s: empty / zero slots, header counts and animations kept (%s)' % (n9, issues9[:2] or 'identical'))
else:
    print('(no MIRAGE archive: legacy slot test skipped)')
# ------------------------------------------------------------------ 10. copies of models (Copy button)
import shutil  # noqa: E402
src = os.path.join(out_dir, 'all_animals_for_copies.gsf')     # its own archive collection (not the one scenario 8 used)
shutil.copyfile(os.path.join(gsf_dir, 'all_animals.gsf'), src)
bpy.ops.import_scene.paraworld_gsf(filepath=src, textures=False)          # open only (default)
col = next(c for c in bpy.data.collections if c.gsf_archive.is_archive and
           os.path.abspath(bpy.path.abspath(c.gsf_archive.source_path)) == os.path.abspath(src))
g = col.gsf_archive
bpy.context.scene['gsf_active_archive'] = col.name
def pick(name):
    g.entry_index = [e.name for e in g.entries].index(name)
for e in g.entries: e.select = False
# 1. plain copies
pick('allosaurus'); bpy.ops.gsf.entry_copy(name='allo_copy')
pick('brachiosaurus'); bpy.ops.gsf.entry_copy(name='brachio_copy')
# 2. import a copy and edit it (remove an animation)
pick('brachio_copy'); bpy.ops.gsf.import_entries()
e_bc = next(e for e in g.entries if e.name == 'brachio_copy')
root_bc = e_bc.root
check(e_bc.state == 'SCENE' and root_bc is not None and root_bc.gsf_model.name == 'brachio_copy' and
      next(e for e in g.entries if e.name == 'brachiosaurus').state == 'FILE', 'imported copy is its own model; the original stays Keep')
check(all(o.name.startswith('brachio_copy') for o in root_bc.children_recursive if o.type == 'MESH'), 'copy objects named after the copy')
bpy.context.view_layer.objects.active = root_bc
root_bc.gsf_model.anim_index = 0
removed = root_bc.gsf_model.anims[0].name
bpy.ops.gsf.anim_remove()
# 3. copy of an edited model: import stegosaurus, move its first mesh, copy it
pick('stegosaurus'); bpy.ops.gsf.import_entries()
steg = next(e for e in g.entries if e.name == 'stegosaurus').root
me = next(o for o in steg.children_recursive if o.type == 'MESH').data
for v in me.vertices: v.co.z += 0.5
bpy.context.view_layer.objects.active = None
pick('stegosaurus'); bpy.ops.gsf.entry_copy(name='steg_copy')
# 4. copy, then remove the original
pick('kentrosaurus'); bpy.ops.gsf.entry_copy(name='kentro_renamed')
pick('kentrosaurus'); bpy.ops.gsf.entry_state(state='REMOVE')
out = os.path.join(out_dir, 'copies_all_animals.gsf')
r = bpy.ops.export_scene.paraworld_gsf(filepath=out, archive=col.name)
A, B = GsfArchive.load(src), GsfArchive.load(out)
names = B.names()
check(r == {'FINISHED'} and {'allo_copy', 'brachio_copy', 'steg_copy', 'kentro_renamed'} <= set(names) and 'kentrosaurus' not in names,
      'saved: 4 copies, kentrosaurus removed (%d -> %d models)' % (len(A.models), len(B.models)))
def same(a, b):
    iss, _ = compare.compare_model(a, b, None, None)
    return [i for i in iss if 'name' not in i]
check(not same(A.model('allosaurus'), B.model('allo_copy')), 'allo_copy identical to allosaurus')
check(not same(A.model('allosaurus'), B.model('allosaurus')), 'allosaurus itself unchanged')
check(not same(A.model('kentrosaurus'), B.model('kentro_renamed')), 'copy of a removed model kept')
bc = B.model('brachio_copy')
check([x.name for x in bc.anim_names] == [x.name for x in A.model('brachiosaurus').anim_names if x.name != removed] and
      not same(A.model('brachiosaurus'), B.model('brachiosaurus')), 'edited copy lost "%s"; brachiosaurus unchanged' % removed)
st_e, st_c, st_o = B.model('stegosaurus'), B.model('steg_copy'), A.model('stegosaurus')
check(not same(st_e, st_c) and same(st_o, st_c), 'copy of the edited stegosaurus has the edit')
dt_a = [d for d in A.dusttrails if d.model.name == 'allosaurus']
dt_c = [d for d in B.dusttrails if d.model.name == 'allo_copy']
check(len(dt_a) == len(dt_c) and len(dt_a) > 0 and [d.anim.name if d.anim else None for d in dt_c] == [d.anim.name if d.anim else None for d in dt_a],
      'dust trails of allosaurus copied (%d)' % len(dt_c))
print('FAILURES:', fails or 'none')
