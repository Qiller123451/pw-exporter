# GSF findings from the remake
## Remake findings (raw attribute bits, 2026-10-01)
The remake reads the chunk attribute as a plain little-endian u32 ("raw bit" n = `1 << n`; the flag numbers above use
the byte-wise MSB numbering, the scripts' VIS flags use raw bits). Checked by rendering every state:

| raw bits | meaning |
|---|---|
| 0–8 | LOD mask (bit 0 = full detail) |
| 9–13 | epoch variants I–V (buildings change with the owner's epoch) |
| 18 | selection / pick volume (all kinds) |
| 19 | shadow model |
| 20 | night lights (buildings); on animals: wound |
| 21–24 | construction level 0–3 |
| 25 | finished · 26 intact · 27 / 28 damage stage 1 / 2 |
| animals (FightingObj.usl VIS_FLAG_*) | 5 party colour, 6 saddle, 7 helmet, 8 armour, 9 standard, 10 armour saddle, 11 misc, 16 "activated" (medic kit), 20–27 wounds by hit point ratio 0.8…0.2 |

* A part without any state flags (attr >> 5 == 0), ≤ 24 vertices and > 8 m is a whole-object hull: skip it.
* Pathfinder table (model info `+44` ptr, `+48` count): 32-byte records `[u32 type][3 f32][3 f32][u32 attr]`,
  type 1 = box (min corner + size, Z up), type 0 = sphere (projectile collision). Used as building footprints.
* Links used by the game: `Bl_0..9` builder spots, `Cr_1..4` cranes, `D_01..16` damage fire/smoke, `Spwn` spawn point,
  `Ex_1` exit, `we` turret / weapon build-up, `Dri1`/`Ride` riders, `Db_1`/`Db_2` collector drawbar + wagon,
  `Proj` projectile start.
* Wall pieces (hu_palisade etc.) are hubs with arms in 8 directions (one part group per arm, positioned about 4 m
  from the centre); the engine's WallMap shows the arms towards connected neighbours. A straight segment = hub +
  east/west arms = 8 m, the wall grid.
* Terrain atlases: see the remake's docs/TERRAIN_NOTES.md (ScapeTexture*.dat is gzip; 70-px tiles, 29 × 29 per 2048 atlas).
