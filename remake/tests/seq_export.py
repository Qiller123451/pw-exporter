"""Every cutscene of the installation decodes to its last byte (pwexport.seq) and converts to the remake's timeline
(pwexport.campaign.seq_play): python3 tests/seq_export.py <ParaWorld folder>"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from pwexport import seq as SEQ                 # noqa: E402
from pwexport import campaign as CP             # noqa: E402

root = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('PW_GAME', '/mnt/user-data/uploads/Paraworld')
files = SEQ.find_files(os.path.join(root, 'Data'))
bad = []
n_actors = n_lines = 0
for f in files:
    try:
        d = SEQ.read_seq(f)
        p = CP.seq_play(d)
        n_actors += len(p['actors'])
        n_lines += sum(1 for a in p['actors'] for it in a['items'] if it['k'] == 'say' and not it['music'])
    except Exception as e:                      # noqa: BLE001
        bad.append('%s: %r' % (os.path.relpath(f, root), e))
print(('ok' if files else 'FAIL') + '   cutscene files found (%d)' % len(files))
print(('ok' if not bad else 'FAIL') + '   all decode and convert (%d actors, %d speech items)%s' % (n_actors, n_lines, ('  ' + '; '.join(bad[:5])) if bad else ''))
