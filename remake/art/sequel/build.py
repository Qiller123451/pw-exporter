"""Build the sequel's models in Blender (art/sequel/kit.py; docs/SEQUEL.md "Models"):
    python3 -m remake.art.sequel.build [--out <folder>] [name ... | roads | cards]
writes <folder>/models/<name>.glb, <folder>/tex/<name>.jpg and the manifest entries in <folder>/manifest.json. The
default folder, art/sequel/built, is the copy in the repository that the pipeline step "sequel" puts into the game
data (pipeline/sequel_assets.py): building needs Blender's Python module and the materials (fetch.py), the game
does not."""
import os, sys, json, time
from . import kit, town, vehicles, works, roads

# name -> (builder, kind, texture size, scale: ParaWorld's larger-than-life proportions)
CATALOGUE = {}
for c in town.SIDING:
    CATALOGUE[f'sq_house_ranch_{c}'] = (lambda c=c: town.ranch(c), 'prop', 1024, 1.3)
for c in vehicles.CAR_PAINT:
    CATALOGUE[f'sq_car_sedan_{c}'] = (lambda c=c: vehicles.sedan(c), 'prop', 512, 1.3)
    CATALOGUE[f'sq_car_wagon_{c}'] = (lambda c=c: vehicles.wagon(c), 'prop', 512, 1.3)
    CATALOGUE[f'sq_car_pickup_{c}'] = (lambda c=c: vehicles.pickup(c), 'prop', 512, 1.3)
for c in town.SIDING:
    CATALOGUE[f'sq_house_two_{c}'] = (lambda c=c: town.two_storey(c), 'prop', 1024, 1.3)
CATALOGUE.update({
    'sq_diner': (town.diner, 'prop', 1024, 1.3),
    'sq_gas_station': (town.gas_station, 'prop', 1024, 1.3),
    'sq_barn': (town.barn, 'prop', 1024, 1.3),
    'sq_silo': (town.silo, 'prop', 512, 1.3),
    'sq_water_tower': (town.water_tower, 'prop', 1024, 1.3),
    'sq_telephone_pole': (town.telephone_pole, 'prop', 256, 1.0),
    'sq_street_lamp': (town.street_lamp, 'prop', 256, 1.0),
    'sq_picket_fence': (town.picket_fence, 'prop', 256, 1.0),
    'sq_chain_fence': (town.chain_fence, 'prop', 256, 1.0),
    'sq_billboard': (town.billboard, 'prop', 512, 1.0),
    'sq_mailbox': (town.mailbox, 'prop', 128, 1.3),
    'sq_bus': (vehicles.bus, 'prop', 1024, 1.3),
    'sq_army_truck': (vehicles.army_truck, 'prop', 1024, 1.3),
    'sq_fuel_tanker': (vehicles.fuel_tanker, 'prop', 1024, 1.3),
    # the camp, power and water, the launch site, the rift
    'sq_quonset': (works.quonset, 'prop', 1024, 1.3),
    'sq_tent': (works.tent, 'prop', 512, 1.3),
    'sq_sandbags': (works.sandbags, 'prop', 256, 1.0),
    'sq_barricade': (works.barricade, 'prop', 256, 1.0),
    'sq_watchtower': (works.watchtower, 'prop', 512, 1.0),
    'sq_checkpoint': (works.checkpoint, 'prop', 512, 1.0),
    'sq_drums': (works.drums, 'prop', 256, 1.0),
    'sq_crates': (works.crates, 'prop', 256, 1.0),
    'sq_pen': (works.pen, 'prop', 1024, 1.0),
    'sq_power_station': (works.power_station, 'prop', 1024, 1.0),
    'sq_power_station_b': (works.power_station, 'building', 1024, 1.0),
    'sq_pylon': (works.pylon, 'prop', 512, 1.0),
    'sq_dam': (works.dam_section, 'prop', 1024, 1.0),
    'sq_rocket_body': (works.rocket_body, 'prop', 512, 1.0),
    'sq_launch_pad': (works.launch_pad, 'building', 1024, 1.0),
    'sq_rocket': (works.rocket_on_pad, 'prop', 1024, 1.0),
    'sq_rift': (works.rift, 'prop', 1024, 1.0),
    'sq_rift_b': (works.rift, 'building', 1024, 1.0),
    # SEAS machines and structures (the owner's colour)
    'sq_jeep': (vehicles.jeep, 'unit', 512, 1.3),
    'sq_capture_truck': (vehicles.capture_truck, 'unit', 1024, 1.3),
    'sq_aa_halftrack': (vehicles.aa_halftrack, 'unit', 1024, 1.3),
    'sq_stabilizer': (works.stabilizer, 'building', 512, 1.0),
    'sq_searchlight': (works.searchlight, 'building', 512, 1.0),
    'sq_flak': (works.flak, 'building', 512, 1.0),
    'sq_radar': (works.radar, 'building', 512, 1.0),
    'sq_field_hq': (works.field_hq, 'building', 1024, 1.0),
    'sq_electric_net': (works.electric_net, 'building', 512, 1.0),
    'sq_gate_machine': (works.gate_machine, 'building', 1024, 1.0),
    # electricity (game/sequel/power.js)
    'sq_power_pole': (works.power_pole, 'building', 256, 1.0),
    'sq_generator': (works.generator, 'building', 512, 1.0),
    'sq_windmill': (works.windmill, 'building', 512, 1.0),
    'sq_windmill_rotor': (works.windmill_rotor, 'prop', 256, 1.0),
    'sq_searchlamp': (works.searchlamp, 'prop', 256, 1.0),
    'sq_watermill': (works.watermill, 'building', 512, 1.0),
    'sq_waterwheel': (works.waterwheel, 'prop', 256, 1.0),
    'sq_tesla_coil': (works.tesla_coil, 'building', 512, 1.0),
    'sq_arc_halftrack': (vehicles.arc_halftrack, 'unit', 1024, 1.3),
})



def build(out, only=None):
    """build into out/models, out/tex and out/manifest.json (the manifest entries, each with the hash of its files)"""
    man_path = os.path.join(out, 'manifest.json')
    man = json.load(open(man_path)) if os.path.exists(man_path) else {'models': {}}
    done = []
    for name, (fn, kind, size, scale) in CATALOGUE.items():
        if only and name not in only:
            continue
        t0 = time.time()
        kit.reset(); kit._mats.clear()
        fn()
        lo, hi, tris = kit.finish(name, out, kind, size, scale=scale)
        e = {'arch': 'sequel', 'anims': None, 'foliage': False, 'nanims': 0, 'speeds': {}, 'sequel': kind,
             'size': [round(hi[i] - lo[i], 2) for i in range(3)]}
        if kind == 'building':
            e['foot'] = [round((lo[0] + hi[0]) / 2, 2), round((lo[2] + hi[2]) / 2, 2), round((hi[0] - lo[0]) / 2, 2), round((hi[2] - lo[2]) / 2, 2)]
        e['sha'] = files_hash(out, name)
        man['models'][name] = e
        man['models'] = dict(sorted(man['models'].items()))
        json.dump(man, open(man_path, 'w'), indent=0, separators=(',', ':'))
        done.append(name)
        print(f'{name}: {tris} triangles, {time.time() - t0:.0f} s', flush=True)
    return done


def files_hash(out, name):
    """the hash of a model's files (the pipeline step 'sequel' runs again when the built manifest changes)"""
    import hashlib
    h = hashlib.sha1()
    for f in (f'models/{name}.glb', f'tex/{name}.jpg', f'tex/{name}_glow.jpg'):
        p = os.path.join(out, f)
        if os.path.exists(p):
            h.update(open(p, 'rb').read())
    return h.hexdigest()[:12]


if __name__ == '__main__':
    # python3 -m remake.art.sequel.build [--out <folder>] [name ...]   (default: art/sequel/built, the shipped copy)
    args = sys.argv[1:]
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'built')
    if args[:1] == ['--out']:
        out, args = args[1], args[2:]
    for d in ('models', 'tex'):
        os.makedirs(os.path.join(out, d), exist_ok=True)
    only = set(args) or None
    if not only or 'roads' in only:          # the road surfaces (roads.py): textures only
        man_path = os.path.join(out, 'manifest.json')
        man = json.load(open(man_path)) if os.path.exists(man_path) else {'models': {}}
        import hashlib
        man['textures'] = {f'sq_road_{k}.png': hashlib.sha1(open(os.path.join(out, 'tex', f'sq_road_{k}.png'), 'rb').read()).hexdigest()[:12] for k in roads.build(out)}
        json.dump(man, open(man_path, 'w'), indent=0, separators=(',', ':'))
    names = only - {'roads', 'cards'} if only else None
    if names is None or names:
        build(out, names)
    if not only or 'cards' in only:          # the cards (icons.py): rendered from the built models
        from . import icons
        icons.build(out)
