# HD models (proof of concept)

`pwexport/hd` makes HD versions of the game's models on your own computer, from your installation - nothing of the
game is in the toolkit. For now it is tried on three models of the shooter: the SEAS gun tower's turret
(`seas_turret`), the Gunner (`seas_gunner_s4`) and the Executioner MKII (`seas_lumberjack_minigun`).

Two versions of each, to compare:

| Version | Mesh | Textures |
|---|---|---|
| **HD** - the same look, more detail | curved PN triangles (`tessellate.py`): every triangle becomes 9 on a curved patch through its corners; the original vertices stay put, smooth areas round off, hard edges (two normals at one place) stay straight | 4x larger with Real-ESRGAN (`esrgan.py`); a normal map from the texture's relief (`textures.py`) |
| **HD remodelled** - rebuilt | finer curved patches (64 triangles each for a small model, 16 for a big one), then in Blender (`remodel_blender.py`): seams welded, the texture's relief carved into the surface as geometry (Displace, 0.6 % of the part's size), new normals (edges over 55° sharp) | the same as HD |

Nodes, skins, animations and the extras the remake reads (links, flags, sounds) are not touched, so an HD model
moves and works exactly like the original. Blood decals, muzzle flashes and particles keep their geometry and
pictures.

## Making them

```
python -m pwexport.hd "<toolkit data>/remake/<id>" seas_turret seas_gunner_s4 seas_lumberjack_minigun
```

* The source is the remake's prepared game data (the launcher's "Prepare the game data"): `<data>/assets/models/` and
  `<data>/assets/tex/`. The shooter shows the path of its data on its start screen's log line; it is
  `<toolkit data>/remake/<8 hex digits>`.
* The result goes to `<toolkit data>/hd/<model>/hd.glb`, `remodel.glb` and `info.json` (`--out` for another folder).
  The viewer and the shooter also look in a folder `hd` next to the toolkit.
* Needs numpy and Pillow (the toolkit's requirements). Real-ESRGAN runs in numpy without PyTorch: its weights
  (`RealESRGAN_x4plus.pth`, 64 MB, BSD-3-Clause) are downloaded once into the toolkit's cache; a 512 x 512 texture takes
  a few minutes on a normal processor. Without a connection the textures are enlarged with Lanczos instead.
* "HD remodelled" needs Blender 4.0 or newer (found like the exporter finds it, or `--blender <path>`).
* `--only hd` or `--only remodel` makes one version; `--level 2` makes the HD version lighter.

## Looking at them

* **Model viewer** (exporter): a model with HD versions - or one whose add-ons have some, as the gun tower with its
  turret `seas_turret` - gets a row "Version" in its Model section: Original / HD / HD remodelled; every part shown
  that has the chosen version shows it (`/api/model` "hd", served from `/hd/<model>/<variant>.glb`).
* **Shooter**: Settings "Models": Original / HD / HD remodelled (shown when HD versions exist; the mission starts
  again with them). The server lists them at `/api/hd` and serves `/data/hd/<model>/<variant>.glb`.
