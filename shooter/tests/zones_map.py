"""Draws the zone map from the output of tests/zones.js:  python zones_map.py result.json out.png"""
import colorsys
import json
import sys
from PIL import Image, ImageDraw

d = json.load(open(sys.argv[1]))
d = d.get('result', d)
n, S = d['n'], 3
img = Image.new('RGB', (n * S, n * S), (20, 20, 28))
dr = ImageDraw.Draw(img)
cols = [tuple(int(255 * c) for c in colorsys.hsv_to_rgb((k * 0.137 + 0.05) % 1, 0.7, 0.95)) for k in range(32)]
for c in range(n * n):
    z, w = d['zone'][c], d['walk'][c]
    if z == 255:
        col = (70, 70, 70) if w else (30, 30, 36)
    else:
        b = cols[z]
        col = b if w else tuple(v // 4 for v in b)
    if d['cut'][c] and w:
        col = (255, 255, 255)
    i, j = c % n, c // n
    dr.rectangle([i * S, j * S, i * S + S - 1, j * S + S - 1], fill=col)
P = lambda x, z: ((x + d['half']) / d['cell'] * S, (z + d['half']) / d['cell'] * S)
for g in d['gates']:
    p = P(g['x'], g['z'])
    dr.ellipse([p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5], outline=(0, 0, 0), width=2)
    dr.text((p[0] + 6, p[1] - 5), '%d|%d r%d' % (g['a'], g['b'], g['rubble']), fill=(255, 255, 255))
for v in range(-400, 401, 50):
    dr.text((P(v, 0)[0] + 2, 2), str(v), fill=(255, 255, 0))
    dr.text((2, P(0, v)[1] + 2), str(v), fill=(255, 255, 0))
box = [int(v) for v in (sys.argv[3:7] or [0, 0, n * S, n * S])]
img.crop(box).save(sys.argv[2])
print(img.size)
