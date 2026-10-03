"""The per-mission table of tests/campaign_smoke_all.sh: python3 tests/campaign_smoke_table.py <log dir>"""
import glob, json, os, sys
d = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
print('| # | mission | game min | triggers fired / all | firings | actions | warnings | errors | unknown types | models missing | quests shown | ended | units / buildings | full tribes | AI behaviours | JS heap MB | ms per game s | ok / fail |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for f in sorted(glob.glob(os.path.join(d, 'smoke_*.log'))):
    t = open(f, errors='replace').read()
    ok, fail = sum(1 for l in t.splitlines() if l.startswith('ok')), sum(1 for l in t.splitlines() if 'FAIL' in l or 'PAGEERROR' in l)
    s = next((l[8:] for l in t.splitlines() if l.startswith('SUMMARY ')), None)
    n = os.path.basename(f)[6:8]
    if not s:
        print(f'| {int(n)} | (no summary: see {os.path.basename(f)}) | | | | | | | | | | | | | | | | {ok} / {fail} |')
        continue
    j = json.loads(s)
    print(f"| {j['mission']} | {j['title']} | {j['minutes']} | {j['fired']} / {j['triggers']} | {j['firings']} | {j['actions']} | {j['warnings']} | {j['errors']} | {' '.join(j['unknown']) or '-'} | {j['missingModels']} | {' '.join(j['quests']) or '-'} | {j['ended'] or '-'} | {j['units']} / {j['buildings']} | {' '.join(j['fullTribes'])} | {' '.join(j['behaviours']) or '-'} | {j['heapMB']} | {j['msPerGameSecond']} | {ok} / {fail} |")
