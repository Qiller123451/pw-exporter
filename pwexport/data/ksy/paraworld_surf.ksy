meta:
  id: paraworld_surf
  title: ParaWorld map data (SURF chunk tree, the unpacked contents of a .ula map)
  application: ParaWorld (Spellbound / Sunflowers, 2006)
  file-extension: surf
  license: Unlicense
  endian: le
doc: |
  The inflated contents of a ParaWorld map (.ula, see paraworld_ula.ksy): a tree of chunks with 4-character tags.
  Every node can carry a data block (stored elsewhere in the file, at `ofs_data`) and child nodes, which follow the
  node header directly. Offsets are counted from the start of the tree (this file for the top "SURF" tree; nested
  trees - "UOF2" in Objs, "SURF" in Trgr / Ques, "AIMM" in AI - count from their own first byte).

  Top-level chunks:
    LInf  level info: key/values, player slots, a 200 x 200 BGRA preview picture, the map editor's description
    Terr  terrain: size, setting, water level, heights (2 m grid), ground materials (4 m grid)
    PaFi  pathfinding grid (not described)
    Rgns  named regions, e.g. the areas of the animal nests (not described)
    Frst  forest blocks: u4 width, u4 height (squares of 32 m), then { u4 square index, 32 item bytes } per forest
          square, then u4 0xffffffff (docs/MAP_FORMAT.md; not described here)
    Objs  placed objects: start locations, trees, stones, fruit bushes, nests, animals, buildings, decoration
    GWFl  group: GrWa, Flck (not described)
    IOMG  landscape decoration instances: grass, ferns, flowers (drawn as ground sprites)
    Trgr, Ques, DlgS, AI   triggers, quests, dialogues, scripted AI of campaign maps (nested trees, not described)

  Map coordinates: x east 0..width, y north 0..height, z up, in metres. Rotations are quaternions (x, y, z, w).
  The engine applies the conjugate (D3D row vectors): heading (counter-clockwise from east) = -2 * atan2(z, w), and
  tilted objects (plateaus, rocks on slopes) need the full conjugate quaternion (-x, -y, -z, w).

  Reverse engineered for the ParaWorld Toolkit from the maps shipped with the game and community maps.
seq:
  - id: root
    type: node(_io, "")
types:
  node:
    doc: |
      One chunk. flags: 0x02 = has `version`, 0x08 = has `len_data`, 0x20 = has `ofs_data` (0x2a = a data chunk,
      0x02 = a group, 0x28 = data without version, 0x00 = empty group).
    params:
      - id: tree_io
        type: io
        doc: The stream of the tree this node belongs to (offsets are relative to its start).
      - id: parent_tag
        type: str
    seq:
      - id: tag
        type: strz
        size: 4
        encoding: ASCII
      - id: ofs_end
        type: u4
        doc: Offset of the first byte after this node and all its children.
      - id: flags
        type: u2
      - id: num_children
        type: u2
      - id: version
        type: u4
        if: (flags & 2) != 0
      - id: len_data
        type: u4
        if: (flags & 8) != 0
      - id: ofs_data
        type: u4
        if: (flags & 32) != 0
      - id: children
        type: node(tree_io, tag)
        repeat: expr
        repeat-expr: num_children
    instances:
      data:
        io: tree_io
        pos: ofs_data
        size: len_data
        if: (flags & 40) == 40
        type:
          switch-on: parent_tag + "/" + tag
          cases:
            '"SURF/LInf"': level_info
            '"SURF/Terr"': terrain
            '"SURF/IOMG"': landscape_instances
            '"SURF/Objs"': nested_tree
            '"SURF/Trgr"': nested_tree
            '"SURF/Ques"': nested_tree
            '"SURF/AI"': nested_tree
            '"obj/clss"': len_str
            '"obj/base"': object_base
            '"gfx/name"': len_str
            '"gobj/attr"': key_values

  nested_tree:
    seq:
      - id: len_tree
        type: u4
      - id: tree
        size: len_tree
        type: tree_root
  tree_root:
    seq:
      - id: root
        type: node(_io, "")

  # ------------------------------------------------------------ strings
  len_str:
    doc: |
      Length (including the closing 0) and characters. Older maps use Windows code page 1252 (read as
      ISO-8859-1 here, which accepts every byte); texts typed into newer versions of the map editor are UTF-8.
    seq:
      - id: len
        type: u4
      - id: value
        type: strz
        size: len
        encoding: ISO-8859-1
  key_value:
    seq:
      - id: key
        type: len_str
      - id: value
        type: len_str
  key_values:
    seq:
      - id: num_items
        type: u4
      - id: items
        type: key_value
        repeat: expr
        repeat-expr: num_items

  # ------------------------------------------------------------ LInf
  level_info:
    seq:
      - id: info
        type: key_values
        doc: MapSourceType, Version, Name, MapName, MapWidth, MapHeight, GameType, Setting, GTime, LevelFileName ...
      - id: player_slot_ids
        type: s4
        repeat: expr
        repeat-expr: 8
      - id: players
        type: key_values
        repeat: expr
        repeat-expr: 8
        doc: type, ready, tribe, team, color, hp_value, headquater, name.
      - id: unknown1
        type: u1
      - id: preview
        type: picture
      - id: unknown2
        size: 16
      - id: description
        type: description_node
        if: not _io.eof
        doc: |
          The editor's description tree: Root / Base / {Version, LevelName, Author, Recommended_Players,
          Edit_Version, Description, MaxPlayers, DefaultCamera ...} and per language variants.
  picture:
    seq:
      - id: width
        type: u4
      - id: height
        type: u4
      - id: num_pixels
        type: u4
      - id: len_pixels
        type: u4
      - id: bytes_per_pixel
        type: u4
      - id: pixels
        size: len_pixels
        doc: B G R A, rows from the top. 200 x 200 in every map seen.
  description_node:
    seq:
      - id: num_children
        type: u4
      - id: name
        type: len_str
      - id: value
        type: len_str
      - id: children
        type: description_node
        repeat: expr
        repeat-expr: num_children

  # ------------------------------------------------------------ Terr
  terrain:
    seq:
      - id: unknown1
        type: u4
        doc: Always 1.
      - id: width
        type: u4
        doc: Metres.
      - id: height
        type: u4
        doc: Metres.
      - id: num_blocks_x
        type: u4
      - id: num_blocks_y
        type: u4
      - id: setting
        type: u4
        enum: setting
        doc: The level info's "Setting" value names it too (and wins when both are present).
      - id: water_level
        type: f4
        doc: Metres; 16 on most maps.
      - id: unknown2
        type: u4
      - id: unknown3
        type: u1
      - id: num_heights
        type: u4
        doc: num_blocks_x * num_blocks_y * 256.
      - id: heights
        size: num_heights * 2
        doc: |
          u2 per sample, 1/128 m per unit, 2 m apart. Stored in blocks of 16 x 16 samples: blocks row by row
          (block row 0 = south edge), samples row by row inside a block.
      - id: num_materials
        type: u4
        doc: num_blocks_x * num_blocks_y * 64.
      - id: materials
        size: num_materials
        doc: |
          u1 per 4 m cell, the index (0..7) of one of the setting's 8 ground materials (the columns of
          Texture/Scape/<setting>/ScapeTexture<Q>.dat). Stored in blocks of 8 x 8 cells, like the heights.

  # ------------------------------------------------------------ IOMG
  landscape_instances:
    seq:
      - id: unknown1
        type: u4
      - id: num_blocks_x
        type: u4
      - id: num_blocks_y
        type: u4
      - id: num_classes
        type: u4
      - id: classes
        type: len_str
        repeat: expr
        repeat-expr: num_classes
        doc: Class names, e.g. Jungle_Wildrice_01.
      - id: num_blocks
        type: u4
      - id: blocks
        type: instance_block
        repeat: expr
        repeat-expr: num_blocks
  instance_block:
    seq:
      - id: num_instances
        type: u4
      - id: instances
        type: instance
        repeat: expr
        repeat-expr: num_instances
  instance:
    seq:
      - id: x
        type: f4
      - id: y
        type: f4
      - id: z
        type: f4
      - id: rotation
        type: f4
        repeat: expr
        repeat-expr: 4
        doc: Quaternion x, y, z, w.
      - id: class_index
        type: u4

  # ------------------------------------------------------------ Objs (UOF2 tree: OBJS / obj / base)
  object_base:
    doc: |
      The "base" record of a placed object (UOF2 / OBJS / obj / base). The object's class is its sibling
      "clss", its model "data / gobj / gfx / name", its attributes "data / gobj / attr" (hitpoints = the amount of
      a resource; spawn_type, spawn_max, spawn_rate, advance_time of a nest ...).
    seq:
      - id: type
        type: strz
        size: 4
        encoding: ASCII
        doc: |
          SLOC start location, TREE tree, FRUI fruit bush / fish shoal, STON stone, NEST animal nest, ANML animal,
          DCCO / DECO / VGTN decoration, BLDG building, CHTR character, VHCL vehicle, SHIP ship, ITEM / ITSP items,
          WOOD wood pile, TRRT, MNIO, DOFL, PROD, QMRK, CFXE (effects), COLL, GROU, FNTN, DMGL, FOOD.
      - id: unknown1
        size: 4
      - id: owner
        type: u1
        doc: Player number, 255 = nobody (world objects).
      - id: x
        type: f4
      - id: y
        type: f4
      - id: z
        type: f4
      - id: rotation
        type: f4
        repeat: expr
        repeat-expr: 4
        doc: Quaternion x, y, z, w.
      - id: name
        type: len_str
        doc: Unique object name, usually <class>_<number>.
      - id: guid
        size: 16
      - id: rest
        size-eos: true
enums:
  setting:
    0: northland
    1: savanna
    2: jungle
    3: icewaste
    4: ashvalley
    5: test_set
    6: cave1
    7: cave2
    8: cave3
