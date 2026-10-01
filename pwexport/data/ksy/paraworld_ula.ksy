meta:
  id: paraworld_ula
  title: ParaWorld map file (.ula), container
  application: ParaWorld (Spellbound / Sunflowers, 2006)
  file-extension: ula
  license: Unlicense
  endian: le
  imports:
    - paraworld_surf
doc: |
  A ParaWorld map (multiplayer maps, campaign levels and maps made with the map editor) is a "SURF" chunk tree
  (see paraworld_surf.ksy) cut into blocks of 256 KiB that are deflated one by one (zlib).

  Inflate every entry of `packed` and concatenate the results in order: that is the SURF data (`len_unpacked`
  bytes), described by paraworld_surf.ksy. Kaitai Struct cannot concatenate substreams, so this description only
  parses the SURF tree directly when the map has a single block (small maps); for bigger maps unpack the file first,
  e.g. with the ParaWorld Toolkit (Map viewer -> Export -> "Unpacked SURF data") or
  `python -m pwexport.ula unpack map.ula map.surf`, and open the .surf file with paraworld_surf.ksy.

  Reverse engineered for the ParaWorld Toolkit from the 66 maps shipped with the game and community maps.
doc-ref: https://para-welt.com/main/usldoc/boosterpack/
seq:
  - id: version
    type: u4
    doc: Always 2.
  - id: len_unpacked
    type: u4
    doc: Size of the SURF data, all blocks inflated.
  - id: num_blocks
    type: u4
  - id: header_crc32
    type: u4
    doc: CRC-32 of the first 12 bytes of the file (version, len_unpacked, num_blocks).
  - id: unknown
    type: u4
    doc: Varies from map to map; meaning unknown (not a CRC-32 of the header or block table).
  - id: blocks
    type: block_info
    repeat: expr
    repeat-expr: num_blocks
  - id: packed
    type: packed_block(_index)
    repeat: expr
    repeat-expr: num_blocks
    doc: The zlib streams, back to back in block order.
types:
  block_info:
    seq:
      - id: len_unpacked
        type: u4
        doc: 262144 (256 KiB) for every block but the last.
      - id: len_packed
        type: u4
      - id: one
        type: u4
        doc: Always 1.
      - id: crc32_packed
        type: u4
        doc: CRC-32 of the block's zlib stream (as stored, before inflating).
  packed_block:
    params:
      - id: idx
        type: u4
    seq:
      - id: data
        size: _root.blocks[idx].len_packed
        process: zlib
        type:
          switch-on: _root.num_blocks
          cases:
            1: paraworld_surf
        doc: |
          This block's part of the SURF data. Parsed as a SURF tree when the whole map is a single block,
          otherwise raw bytes (see the description above).
