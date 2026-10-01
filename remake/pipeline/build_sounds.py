"""Step "sounds": the sound events the remake uses -> <OUT>/assets/sounds.json.

The sounds themselves stay in the game folder: sounds.json names each wav by its path below Data/<mod>/Audio/Sound
and the toolkit's server delivers assets/snd/<that path> straight from the installation (src/engine/audio.js decodes
the game's IMA ADPCM wavs itself, browsers don't). Nothing is converted or copied.
"""
import json, os, re, sys
try:
    from . import paths, sounddb
except ImportError:
    import paths
    import sounddb
from pwexport.install import Install          # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

FX = ['FX_CBuildingReadyFX', 'FX_CLevelUpFX', 'FX_CLevelUpFX_Transport', 'FX_CBuildingInventStartFX', 'FX_CBuildingInventEndFX',
      'FX_CBigBuildingExplosion', 'FX_CBuildingHit_01_01', 'FX_CBloodHit_01_01', 'FX_CBloodHit_01_02', 'FX_CVehicleExplosion',
      'FX_CMedExplo01', 'FX_CMedExplo02', 'FX_CLandScapeHit', 'FX_CBigScapeHit', 'FX_CAje_Tent_Dem_Fx', 'FX_AnimalHelpCryGeneric',
      'FX_CAllosaurusDying', 'FX_CBrachioDying', 'FX_CAnimalSpawnFX', 'FX_CResFX_CharacterSpawnFX', 'FX_CTecFX_CharacterSpawnFX',
      'FX_CNatFX_CharacterSpawnFX', 'FX_CMolotovExplosion', 'FX_CPickupItem', 'Levelup_Char_Fx', 'Placeping_Building_Fx',
      'Confirmping_Build_Character_Fx']


def wanted_events(ev):
    roster = json.load(open(os.path.join(HERE, 'roster.json')))
    classes = [c.lower() for t in list(roster['units'].values()) + list(roster['buildings'].values()) for c in t]
    keep = set(FX)
    for k in ev:
        kl = k.lower()
        if kl.startswith('sfx_'): keep.add(k)
        elif kl.startswith('ui_') and not re.match(r'ui_(hu|ninigi)_', kl): keep.add(k)
        elif kl.startswith('voice_') and (any(kl.startswith('voice_' + c + '_') for c in classes) or
                                          re.match(r'voice_(selected|placed|delivered|nextage|invention|no_housing|click_error|warn_under_attack|enemy_selected|aje_)', kl)):
            keep.add(k)
        elif kl.startswith('fx_hit_') and ('_jng_' in kl or 'creature' in kl or 'object_aje' in kl or re.match(r'fx_hit_object_(blunt|sharp|explo|poison)', kl)):
            keep.add(k)
    return sorted(keep)


def model_wavs():
    man = json.load(open(os.path.join(paths.OUT, 'assets', 'manifest.json')))
    wavs = set()
    for m in man['models'].values():
        for lst in (m.get('sounds') or {}).values():
            for s in lst: wavs.add(s[1])
    return wavs


def main(log=print, progress=None):
    ev, ackmap = sounddb.load_all()
    keep = wanted_events(ev)
    wavs = set(model_wavs())
    for k in keep:
        for snd in ev[k]['sounds']: wavs.add(snd['wav'])
    wavs = sorted(w.replace('\\', '/') for w in wavs)
    game = Install(paths.DATA)
    have = {}
    for w in wavs:
        if game.file('Audio/Sound/' + w):
            have[w.lower()] = w
    events = {}
    for k in keep:
        e = ev[k]
        snds = [dict(x, wav=have[x['wav'].replace('\\', '/').lower()]) for x in e['sounds'] if x['wav'].replace('\\', '/').lower() in have]
        if snds: events[k.lower()] = dict(g=e['glob'], seq=e['seq'], s=[[x['wav'], x['vol'], x['maxhear']] for x in snds])
    mat = sounddb.material_effects()
    os.makedirs(os.path.join(paths.OUT, 'assets'), exist_ok=True)
    json.dump(dict(events=events, material=mat, files=have, source='game'), open(os.path.join(paths.OUT, 'assets', 'sounds.json'), 'w'),
              separators=(',', ':'))
    missing = [w for w in wavs if w.lower() not in have]
    log(len(events), 'events,', len(have), 'sound files; missing', len(missing), missing[:10])


run = main

if __name__ == '__main__':
    paths.configure(sys.argv[1], sys.argv[2])
    main()
