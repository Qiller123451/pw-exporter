# ParaWorld GSF add-on for Blender

Import, edit and export ParaWorld `.gsf` model archives: meshes, cloth, skeletons, attachment points, collision volumes,
materials, bone / mesh / emitter animations, particle emitters, billboard clouds, speed lines, light volumes and
lights. Every value stored in the file can be edited in Blender. Values whose purpose is unknown are shown with an
`unk_` prefix and are editable like the rest.

Blender 4.2 LTS or newer (tested with 5.2).

**[User manual with screenshots](docs/MANUAL.md)**: a walk through the interface and common tasks.

## Install

Build the zip from the repository, then install it:

    python blender/make_zip.py          -> blender/dist/io_scene_paraworld_gsf.zip

Edit > Preferences > Add-ons > (drop-down) Install from Disk… and choose `io_scene_paraworld_gsf.zip`. Enable
**ParaWorld GSF format**.

## Editing an archive directly

1. **Open.** Use *File > Import > ParaWorld GSF*, or *Open / Import* in the 3D view sidebar (N), tab **GSF**.
   - *Only open the archive* (ticked by default) lists the models without importing any. Untick it to import all.
   - Enter names in *Models* (patterns like `seas_*` work) to import only those.
   - The archive becomes a collection named `GSF <name>`. The GSF tab lists every model in it.
   - Each imported model gets its own collection holding the root empty, with the components sorted into
     `<model> Lod0` … `<model> Lod4` collections, each split by kind (`<model> Lod0 Mesh`, `… Link`,
     `… Collision volume` …). A component shown on several LODs goes into the best one: LOD bits 2 and 3 → Lod2.
     Components with no LOD bit go into `<model> No LOD`.
   - These collections only organise the outliner. The LOD bits in each component's properties decide what the game
     shows, and moving an object to another collection does not change them. After editing LOD bits, press the
     collection button beside the model name (GSF Model panel), or beside *New model from selection* for every
     model of the archive, to sort again.
2. **Choose what to edit.** In the GSF tab:
   - Tick models and press **Import** to bring them into the scene. They are now *Edited* and are written from the
     scene when you save.
   - **Remove** leaves the ticked models out of the saved archive.
   - **Keep** writes a model exactly as it is in the source file.
   - **Copy** adds a copy of the active model under a new name: every component, flag, mesh, material, collision
     volume, animation and walk set, and the dust trails of its animations. The copy is saved as it is (a copy of
     the model as it is in the file, or as edited in the scene); tick it and press **Import** to change it.
   - The arrows beside the list move the active model up, down, to the top or to the bottom (with a filter they step
     over the hidden models). Once the list has been rearranged, the archive is saved in its order; models added
     with *New model from selection* go where their entry stands. An archive whose list was not touched keeps the
     file's own order.
   - An edited model replaces the one of the same name in its place: it keeps its single entry and position.
3. **Add models.** Select objects (meshes, an armature, empties for links) and press **New model from selection**.
4. **Animations.** Select any object of a model. In the GSF tab, the *GSF Model* panel lists its animations:
   - ▶ plays one: assigns its actions and sets the frame range.
   - The armature button returns to the rest pose.
   - **+** makes a new animation from the actions the model's objects currently have.
   - **−** removes the selected animation.
   - Walk sets refer to animations by name; they are edited on the model root's Object properties.
5. **Archive data** (GSF tab > *Archive data*): sound events, dust trails, animation groups and walk transitions each
   have **+ / − / ▲ / ▼** beside their list. Dust trails add or remove key/value parameters below the list.
   - Animations refer to sounds and groups by position (the *Sounds* list of an animation, the bits of *Groups*), and
     walk sets refer to walk transitions by position. When an entry is removed or moved, those references are
     renumbered so they keep pointing at the same entries; references to a removed entry are dropped. Models marked
     *Keep* get the same renumbering when the archive is saved.
   - A list of entries elsewhere (animated components, material lists, walk sets, emitter tiles and parameters, an
     action's tracks, frame meshes and materials) has an **X** on each row and an *Add* button below.
6. **Save.** *Save archive* in the GSF tab (or *File > Export > ParaWorld GSF*) writes the archive. Models marked
   *Keep* are copied from the source file unchanged.

Save to a new file and keep the game's originals. The game reads archives from `Data/<mod>/GSF`.

## Where the data is

| GSF | Blender |
|---|---|
| archive (sounds, dust trails, animation groups, walk transitions, material table size) | collection `GSF <name>`, GSF tab > *Archive data* |
| model info (FourCC, names, bounding box, material list, walk sets, animations) | root empty of the model, Object properties > *ParaWorld GSF* |
| mesh / cloth | mesh object: one material slot per submesh; UVs; normals; vertex groups = bone weights; attributes `gsf_baked_light` (paintable colour), `gsf_tangent` |
| skeleton | armature (bone GUIDs, flags and rest scale on each bone: Bone properties > *ParaWorld GSF*) |
| link, emitter, speed line | empty (location / rotation = position / rotation); parented to a bone when it hangs on one |
| light volume, cloth collider, collision volume | empty: location = centre, scale = radii / half size |
| billboard cloud | mesh made of points (one per sprite), material slot 0 = atlas |
| light | point light |
| material | material, Material properties > *ParaWorld GSF* (flags as toggles, texture names) |
| bone animation | action on the armature (25 fps, frame 0 = first frame); track formats, loop marks and root data in the action's GSF data (GSF tab > *GSF Action*) |
| mesh / billboard animation | action on the object (transform per frame); mesh frames are meshes listed in the action, the animated custom property `gsf_mesh_frame` / `gsf_cloud_frame` picks one |
| particle / speed line path | action on the empty (location per frame) |

Every chunk field that the file does not derive from other data has its own property in *Object properties >
ParaWorld GSF*. The attribute (visibility) bits are named after the model's FourCC.

Coordinates: the game is left-handed. The add-on mirrors the x axis by default (*Handedness*, as the ParaWorld
Toolkit's glTF files do) and mirrors it back on export. Bones point at their children, as in the game (shown as octahedra).
Armatures imported by versions before 1.4 keep their old bone orientation and still export correctly; import the
model again to get the new one.

## Normals

A vertex stores its normal as an index into a fixed table of 511 unit vectors, the lookup sphere. The add-on computes
normals the way SEK's 3ds Max exporter did (`ResourceBuilder.cpp`):

1. The face normal is `(v0 − v1) × (v0 − v2)`, not normalised, so bigger faces weigh more.
2. Each face corner adds up the faces around the vertex that share a smoothing group with it. In Blender, faces
   joined by smooth edges share a group; sharp edges and flat faces split them.
3. The stored index is the closest sphere vector (largest dot product).

On import, edges where the stored normals differ are marked sharp. Recomputing then reproduces the file's indices
for about 94 % of the corners, and the rest land on a neighbouring sphere vector.

The export option *Normals* has three settings:
- **Automatic** (default): meshes not edited since the import keep the file's indices; edited and new meshes are
  computed as above.
- **Like the game**: always compute.
- **Keep custom normals**: Blender's corner normals, mapped to the sphere.

## What gets written back exactly

These match the file bit for bit in game terms (checked on whole archives):
- unchanged meshes: quantised positions, normals, UVs, weights, baked light, tangent words, degenerate triangles
- skeletons and bind poses
- links, emitters, billboards and collision volumes
- animations whose action was not edited, which are reused from the source file (and stay shared between models)

Edited animations are rebuilt from the F-curves:
- Every whole frame from 0 to *Frames − 1* is sampled.
- Each track keeps its stored format. *Simple* tracks can only rotate; *Trans* tracks can also stretch along the
  bone. The exporter warns when a bone's motion does not fit its format.
- Constraints and IK are not evaluated. Bake the action first.

## Legacy edits in modded archives

Some modded archives were edited by hand (hex editor). The add-on keeps those edits as they are:
- **Empty chunk-table slots** (the value 0 or 0x80000000 instead of a chunk) stay in their position with their exact
  value, in models kept from the file and in imported models. The model root shows them as *Empty chunk slots*
  (e.g. `1`, `7=0`, `13=zero`).
- **Blanked-out chunks** (a slot that points to zero bytes, e.g. MIRAGE's dilophosaurud) are written back as zeros.
- **Header counts:** a model with empty slots keeps the file's own counts (number of links, cloth chunks and so
  on), even where they don't match the chunks.
- **Animation tracks of empty slots** are copied unchanged from the source archive.
- **Blanked meshes** (every vertex and triangle byte zero) and **zero rotations** (a quaternion of four zeros)
  are written back as zeros while they are not edited.

Imported models keep the chunk order of the file; new components follow, grouped by kind.

## Known limits

- **Tangent words** (one u16 per vertex on normal-mapped materials) are not decoded. They are kept per corner and
  written back; new geometry gets 0.
- **Cloth extras:** the point lists and cloth triples are kept as custom properties and refer to vertex order.
  Cloth meshes are therefore imported without welding, and their vertex order is kept.
- **Out-of-range tracks:** tracks for bones a model's skeleton does not have (animations shared with bigger
  skeletons) are left out when such an animation is rebuilt.
- **The light chunk** is understood only partly (one model has one); its unknown fields are kept and editable.

## For developers

```
blender/
make_zip.py             builds dist/io_scene_paraworld_gsf.zip
io_scene_paraworld_gsf/
  core/                 the format, no Blender needed
    binio.py            self-relative offsets, writer with deferred / shared data
    schema.py           Field / Struct: declarative layouts (drive reading, writing AND the Blender properties)
    archive.py          header 1 (table of contents), header 2, models, animation infos, editing helpers
    materials.py        materials and material lists
    chunks/             one module per chunk family, registered by type id
    vertex.py           13-bit positions, normal index, UV, bones, extra byte
    normals.py          the lookup sphere and SEK's normal computation
    names.py            names of attribute / material / particle bits, known bone and wall part names
  blender/              props (generated), imp (import), exp (export), anim, materials, lods (LOD collections), ops, ui
tests/
  roundtrip.py          read -> write -> read every archive, compare everything (no Blender)
  compare.py            compare models of two archives in game terms
  blender_ui_smoke.py   operators and panels inside Blender
  blender_edit_test.py  editing scenarios inside Blender (mesh, property, keys, new animated model)
```

The Blender tests run in Blender (`blender -b -P blender/tests/blender_ui_smoke.py -- <file.gsf> <models>`) or with the
`bpy` module from PyPI.

**Adding a chunk type**
1. Write a `Chunk` (or `AnimChunk`) subclass with `TYPE_IDS`, `KIND` and a `STRUCT` of `Field`s. If the struct
   points to further data, add `read_payload` / `payload_pointers`. Decorate it with `@register` and import the
   module in `core/chunks/__init__.py`. The reader, the writer, the Blender properties and the properties panel pick
   it up from there.
2. To turn it into a Blender object, add a converter with `imp.register_converter(kind, fn)` and
   `exp.register_exporter(kind, fn)`. Until then the add-on reports that it cannot convert the chunk.

**Core library without Blender**

```python
from io_scene_paraworld_gsf.core import GsfArchive
a = GsfArchive.load('all_animals.gsf')
m = a.model('allosaurus')
a.remove_animation(m, 'dying')
a.save('all_animals_edited.gsf')
```

`python blender/tests/roundtrip.py <Data folder>` reads and rewrites every archive and compares the results. On ParaWorld +
BoosterPack1 (57 archives, 290 MB) there are no differences.
