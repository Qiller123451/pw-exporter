"""Parse ParaWorld sound configuration (Scripts/Server/init/*.txt) into a flat event table.

Syntax handled:
    Root { SoundPath = '05_ui/'  evt { global = '1' sound_1 { wav = 'x.wav' volume = '70' ... }  sound_2 = 'sound_1' { wav = 'y.wav' } } }
`name = 'base' { overrides }` copies the sibling block `base` and applies the overrides.
Later mods (BoosterPack1) override files of the same name from Base.
"""
import re, os, json, sys
try:
    from . import paths
except ImportError:
    import paths
from pwexport import tree as _tree   # noqa: E402

TOK = re.compile(r"'([^']*)'|(\{)|(\})|(=)|(//[^\n]*)|([^\s{}=']+)")
MODS = ['Base', 'BoosterPack1']


def parse(text):
    """settings-file parser (shared with the Model Exporter: pwexport.tree, sibling inheritance + comments)"""
    return _tree.parse(text, inherit=True)


def num(v, d):
    try: return float(v)
    except (TypeError, ValueError): return d


def events_from(tree):
    root = tree.get('Root', tree)
    path = root.get('SoundPath', '') or ''
    out = {}
    for name, ev in root.items():
        if not isinstance(ev, dict): continue
        snds = []
        for k, s in ev.items():
            if k.startswith('sound') and isinstance(s, dict) and s.get('wav'):
                wav = (path + s['wav']).replace('\\', '/')
                snds.append(dict(wav=wav, vol=num(s.get('volume'), 70), minfade=num(s.get('minfadedistance'), 0),
                                 maxfade=num(s.get('maxfadedistance'), 0), maxhear=num(s.get('maxhearingdistance'), 0)))
        out[name] = dict(glob=ev.get('global') == '1', seq=ev.get('sequential') == '1', sounds=snds)
    return out


def init_file(name):
    """path of a Scripts/Server/init file, latest mod wins"""
    found = None
    for m in MODS:
        p = paths.data(os.path.join(m, 'Scripts/Server/init', name))
        if os.path.exists(p): found = p
    return found


def load_all():
    ev = {}
    idx = parse(open(init_file('soundevents.txt'), encoding='latin1').read()).get('Root', {})
    files = []
    # soundevents.txt uses repeated keys (Feedback_selected = ...) which a dict collapses: read them by regex instead
    for m in re.finditer(r"=\s*'([^']+\.txt)'", open(init_file('soundevents.txt'), encoding='latin1').read()):
        files.append(m.group(1))
    acks = parse(open(init_file('UnitAcks.txt'), encoding='latin1').read()).get('Root', {})
    ackmap = {k: v for k, v in acks.items() if isinstance(v, str) and v.endswith('.txt')}
    for f in files + sorted(set(ackmap.values())):
        p = init_file(f)
        if not p: continue
        ev.update(events_from(parse(open(p, encoding='latin1').read())))
    return ev, ackmap


def material_effects():
    t = parse(open(init_file('MaterialEffects.txt'), encoding='latin1').read()).get('Root', {})
    return {w: {tgt: (d.get('SFX') or '', d.get('GFX') or '') for tgt, d in v.items() if isinstance(d, dict)} for w, v in t.items() if isinstance(v, dict)}


if __name__ == '__main__':
    ev, ackmap = load_all()
    print(len(ev), 'events;', len(ackmap), 'ack files')
    print(ev.get('FX_CBuildingReadyFX'))
    print(ev.get('voice_aje_worker_selected'))
    print(material_effects().get('Sword'))
