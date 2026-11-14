"""Tests of the remake's asset choice (remake/pipeline/build_assets.py): the clips kept of the big character
animation packs and the beheading heads.

    python tools/test_build_assets.py [<ParaWorld or Data folder>]

Without a folder: the rules on made-up data. With one: also its all_characters.gsf - the clips and heads the remake
needs are in it (the death to the front hit_fw, the hit reactions of the four sides, the snare trap's clips, 163
"<class>_head" static meshes), and the asset choice keeps them.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, 'remake', 'pipeline'))
import build_assets as BA          # noqa: E402

FAILS = []
CLIPS = ['hit_fw', 'hit_reaction', 'hit_reaction_fa', 'hit_reaction_la', 'hit_reaction_ra', 'hit_reaction_ba',
         'hit_reaction_fb', 'hit_reaction_lb', 'hit_reaction_rb', 'hit_reaction_bb', 'all_snar_trap_catching',
         'all_snar_trap_hanging', 'all_snar_trap_end', 'snare_trap_dying', 'chop_1']


def check(what, ok):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok:
        FAILS.append(what)


def rules():
    keep = set(BA.KEEP_ANIMS)
    for c in CLIPS:
        check('kept clip ' + c, c in keep)
    index = {'hu_worker_head': ('all_characters', ''), 'miyagi_s0_head': ('all_characters', ''),
             'brachiosaurus_head': ('all_animals', ''), 'hu_worker': ('all_characters', '')}
    cg = {'hu_worker_head': 'hu_worker_head', 'miyagi_s0_head': 'miyagi_s0_head\n\t\t}\n\t\tobjectattribs {',
          'aje_worker_head': 'aje_worker_head', 'hu_worker': 'hu_worker'}
    h = BA.head_models(cg, index)
    check('a head class with its model', 'hu_worker_head' in h)
    check('a broken class gfx entry: the class name', 'miyagi_s0_head' in h)
    check('a head class without a model: none', 'aje_worker_head' not in h)
    check('no other classes', 'hu_worker' not in h)


def archive(folder):
    from pwexport import gsf as pg
    from pwexport.install import Install
    g = Install(folder)
    path = g.archives().get('all_characters')
    if not path:
        check('all_characters.gsf in ' + folder, False)
        return
    r = pg.R(open(path, 'rb').read())
    infos = pg.parse_model_infos(r, pg.parse_header2(r))
    toc = pg.parse_header1(r)
    heads = [m for m in infos if m['name'].lower().endswith('_head')]
    check('163 head models (%d)' % len(heads), len(heads) == 163)
    check('the heads are static meshes', all(not m['anims'] for m in heads))
    empty = sorted(m['name'] for m in heads if not m['chunks'])
    check('one empty head model, aje_rammer_head (%s)' % ', '.join(empty), empty == ['aje_rammer_head'])
    count = {c: 0 for c in CLIPS}
    for hm in toc:
        m = infos[hm['index']]
        for a, ai in hm['anims']:
            if a.lower() in count and any(ch for ch, _ in m['anims'][ai]):
                count[a.lower()] += 1
    print('     models with the clip:', ', '.join('%s %d' % kv for kv in count.items()))
    check('hit_fw on the characters', count['hit_fw'] > 200)
    check('the side hit reactions on 84 models', all(count['hit_reaction_' + s] == 84 for s in
                                                    ('fa', 'la', 'ra', 'ba', 'fb', 'lb', 'rb', 'bb')))
    check('the snare clips on the characters', all(count[c] > 200 for c in ('all_snar_trap_catching', 'all_snar_trap_hanging',
                                                                             'all_snar_trap_end', 'snare_trap_dying')))
    names = {m['name'].lower(): ('all_characters', '') for m in infos}
    cg = {n: n for n in names if n.endswith('_head')}
    check('every head model is chosen by its class', BA.head_models(cg, names) == set(cg))


if __name__ == '__main__':
    rules()
    if len(sys.argv) > 1:
        archive(sys.argv[1])
    print('%d failed' % len(FAILS) if FAILS else 'all passed')
    sys.exit(1 if FAILS else 0)
