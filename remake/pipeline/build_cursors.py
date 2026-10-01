"""Convert the original Windows cursors (Data/Base/Cursors/*.cur) to PNG + hotspots for CSS cursors.

A .cur is an ICO container whose image is a DIB (BITMAPINFOHEADER, height doubled) followed by a 1-bit AND
mask. The cursors are 24-bit, so the transparency is only in the AND mask (1 = transparent) - converters that
ignore the mask produce black squares around the cursor. 32-bit images (alpha channel) are handled too.

Output: <OUT>/assets/ui/cur/<name>.png + hotspots.json
"""
import os, struct, json, glob, sys
from PIL import Image
try:
    from . import paths
except ImportError:
    import paths


def read_cur(path):
    d = open(path, 'rb').read()
    _, typ, n = struct.unpack_from('<HHH', d, 0)
    w, h, _, _, hx, hy, size, off = struct.unpack_from('<BBBBHHII', d, 6)
    hdr, bw, bh, planes, bpp = struct.unpack_from('<IiiHH', d, off)
    w = w or 256; h = h or 256
    bw, bh = abs(bw), abs(bh) // 2
    p = off + hdr
    ncol = struct.unpack_from('<I', d, off + 32)[0] or (1 << bpp if bpp <= 8 else 0)
    pal = []
    if bpp <= 8:
        for i in range(ncol):
            b, g, r, _ = d[p + 4 * i:p + 4 * i + 4]; pal.append((r, g, b))
        p += 4 * ncol
    stride = ((bw * bpp + 31) // 32) * 4
    img = Image.new('RGBA', (bw, bh))
    px = img.load()
    for y in range(bh):
        row = p + (bh - 1 - y) * stride
        for x in range(bw):
            if bpp == 32: b, g, r, a = d[row + 4 * x:row + 4 * x + 4]
            elif bpp == 24: b, g, r = d[row + 3 * x:row + 3 * x + 3]; a = 255
            elif bpp == 8: r, g, b = pal[d[row + x]]; a = 255
            elif bpp == 4: r, g, b = pal[(d[row + x // 2] >> (4 if x % 2 == 0 else 0)) & 15]; a = 255
            else: r, g, b = pal[(d[row + x // 8] >> (7 - x % 8)) & 1]; a = 255
            px[x, y] = (r, g, b, a)
    mask_p = p + stride * bh
    mstride = ((bw + 31) // 32) * 4
    has_alpha = bpp == 32 and any(px[x, y][3] for y in range(bh) for x in range(bw))
    for y in range(bh):
        row = mask_p + (bh - 1 - y) * mstride
        for x in range(bw):
            transparent = (d[row + x // 8] >> (7 - x % 8)) & 1 if row + x // 8 < len(d) else 0
            if transparent and not has_alpha:
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, 0)
    return img, (hx, hy)


def main(log=print, progress=None):
    SRC = paths.data('Base/Cursors')
    OUT = os.path.join(paths.OUT, 'assets', 'ui', 'cur')
    os.makedirs(OUT, exist_ok=True)
    hot = {}
    for f in sorted(set(glob.glob(os.path.join(SRC, '*.cur')) + glob.glob(os.path.join(SRC, '*.CUR')))):
        name = os.path.splitext(os.path.basename(f))[0].lower()
        img, hs = read_cur(f)
        img.save(os.path.join(OUT, name + '.png'))
        hot[name] = [hs[0], hs[1], img.width, img.height]   # hotspot x, y, width, height
    json.dump(hot, open(os.path.join(OUT, 'hotspots.json'), 'w'), indent=1)
    log(len(hot), 'cursors')


run = main

if __name__ == '__main__':
    paths.configure(sys.argv[1], sys.argv[2])
    main()
