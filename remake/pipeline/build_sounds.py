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


def music(game):
    """the music manager's tables (engine/music.js): Audio/MusicMgr.txt (the switches, misc values) and
    Audio/MusicTracks.txt (the playlists per level / setting, the tracks' files and start times); MusicMgr.usl reads
    them from Data/Base"""
    def read(rel):
        p = game.file('Audio/' + rel, mods=['Base'])
        return sounddb.parse(open(p, encoding='latin-1').read()).get('Root', {}) if p else {}
    def tracks(node):
        out, i = [], 1
        while node.get('music_track_id_%d' % i):
            out.append(node['music_track_id_%d' % i].lower()); i += 1
        return out
    mgr, mt = read('MusicMgr.txt'), read('MusicTracks.txt')
    if not mgr or not mt:
        return None
    sw = {}
    for name, node in mgr.items():
        if name == 'misc' or not isinstance(node, dict): continue
        e = {k: int(sounddb.num(v, 0)) for k, v in node.items() if not isinstance(v, dict) and not k.startswith('music_track_id_')}
        subs = {k: tracks(v) for k, v in node.items() if isinstance(v, dict)}
        if subs: e['tracks'] = subs                     # per tribe (Hometown) or won / lost (GameEnd)
        elif tracks(node): e['tracks'] = tracks(node)
        sw[name] = e
    lists = {name.lower(): {k: tracks(v) for k, v in node.items() if isinstance(v, dict)} for name, node in mt.get('playlists', {}).items()}
    trk = {}
    for tid, node in mt.get('tracks', {}).items():
        starts, i = [], 1
        while node.get('start_ms_%d' % i): starts.append(int(sounddb.num(node['start_ms_%d' % i], 0))); i += 1
        trk[tid.lower()] = dict(file=node.get('file', '').replace('\\', '/').lower(), **({'start': starts} if starts else {}))
    misc = {k: int(sounddb.num(v, 0)) for k, v in mgr.get('misc', {}).items()}
    return dict(misc=misc, switches=sw, playlists=lists, tracks=trk)


def atmo(game):
    """the ambience templates (engine/atmo.js): Audio/AtmoTemplates/<name>.txt, named by a level's material_atmos.
    Per template 36 states mat<M>:<H>:<D> - M the ground material of the 32 m square (0 mud, lava, swamp; 1 water;
    2 grass, moss; 3 soil, snow; 4 rock; 5 road; 6 sand; 7 ice; 8 forest), H the camera above 12 m, D day - each
    {w: wav files below Audio/Sound, p: bed playlist [[kind, a, b]] (W<n> the bed wav n; L<a>-<b> loops; P<a>-<b> a
    pause of a .. b ms), e: event playlist [[wav, repeats a, b, delay a, b s, pan a, b (+100), volume a, b]], v: bed
    volume, r: pitch} at index M + 9 * (H + 2 * D) (PWClient.exe CAtmoSoundMgr, docs/ARCHITECTURE.md "Ambience")"""
    folder = game.dir('Audio/AtmoTemplates')
    if not folder:
        return {}
    out = {}
    for f in sorted(os.listdir(folder)):
        if not f.lower().endswith('.txt') or f.startswith('._'):
            continue
        root = sounddb.parse(open(os.path.join(folder, f), encoding='latin-1').read()).get('Root', {})
        states = [None] * 36
        for key, node in root.items():
            m = re.match(r'mat(\d):(\d):(\d)$', key)
            if not m or not isinstance(node, dict):
                continue
            mat, high, day = (int(x) for x in m.groups())
            if mat > 8 or high > 1 or day > 1:
                continue
            wavs, i = [], 1
            while ('wav%d' % i) in node: wavs.append(node['wav%d' % i].replace('\\', '/')); i += 1
            def plist(text, need):
                rows = []
                for tok in re.split(r'[ ,]+', (text or '').strip()):
                    if not tok: continue
                    f_ = [int(sounddb.num(x, 0)) for x in tok[1:].split('-')]
                    kind = tok[0].upper()
                    if kind not in need: continue
                    rows.append([kind] + (f_ + [0] * 9)[:9] if kind == 'E' else [kind] + (f_ + f_[:1])[:2])
                return rows
            states[mat + 9 * (high + 2 * day)] = dict(w=wavs, p=plist(node.get('playlist'), 'WLP'), e=[r[1:] for r in plist(node.get('eventplaylist'), 'E')],
                                                      v=int(sounddb.num(node.get('volume'), 100)), r=sounddb.num(node.get('pitch'), 1))
        out[os.path.splitext(f)[0].lower()] = states
    return out


def main(log=print, progress=None):
    ev, ackmap = sounddb.load_all()
    keep = wanted_events(ev)
    wavs = set(model_wavs())
    for k in keep:
        for snd in ev[k]['sounds']: wavs.add(snd['wav'])
    wavs = sorted(w.replace('\\', '/') for w in wavs)
    game = paths.game()
    have = {}
    for w in wavs:
        if game.audio_file('Audio/Sound/' + w):          # (speech may be only in a language pack)
            have[w.lower()] = w
    events = {}
    for k in keep:
        e = ev[k]
        snds = [dict(x, wav=have[x['wav'].replace('\\', '/').lower()]) for x in e['sounds'] if x['wav'].replace('\\', '/').lower() in have]
        if snds: events[k.lower()] = dict(g=e['glob'], seq=e['seq'], s=[[x['wav'], x['vol'], x['maxhear']] for x in snds])
    mat = sounddb.material_effects()
    os.makedirs(os.path.join(paths.OUT, 'assets'), exist_ok=True)
    mus = music(game)
    amb = atmo(game)
    json.dump(dict(events=events, material=mat, files=have, music=mus, atmo=amb, source='game'), open(os.path.join(paths.OUT, 'assets', 'sounds.json'), 'w'),
              separators=(',', ':'))
    missing = [w for w in wavs if w.lower() not in have]
    log(len(events), 'events,', len(have), 'sound files; missing', len(missing), missing[:10])
    if mus: log('music:', len(mus['playlists']), 'playlists,', len(mus['tracks']), 'tracks')
    if amb: log('ambience:', len(amb), 'templates')


run = main

if __name__ == '__main__':
    paths.configure(sys.argv[1], sys.argv[2])
    main()
