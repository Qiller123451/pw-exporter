"""Textures for the game: pictures (PNG, JPG, TGA ...) to DXT5 .dds with mipmaps, as the game's own textures are
(Data/<folder>/Texture/<path>_(<size>).dds: All_Allosaurus_a_(0256).dds = 256 x 256, DXT5, 9 mip levels), and the
TGA pictures of the HUD.

    write_dds(image, path)          an RGBA picture (sides: powers of two) -> .dds
    texture_file(name, size)        'animals/my_dino_a.tga', 256 -> 'Animals/my_dino_a_(0256).dds'
"""
import io
import os
import struct

from PIL import Image

DDSD_CAPS, DDSD_HEIGHT, DDSD_WIDTH, DDSD_PIXELFORMAT, DDSD_MIPMAPCOUNT, DDSD_LINEARSIZE = 0x1, 0x2, 0x4, 0x1000, 0x20000, 0x80000
DDSCAPS_COMPLEX, DDSCAPS_TEXTURE, DDSCAPS_MIPMAP = 0x8, 0x1000, 0x400000
DDPF_FOURCC = 0x4


def pow2(n, lo=4, hi=2048):
    p = lo
    while p < n and p < hi:
        p *= 2
    return p


def prepare(img, max_size=1024):
    """RGBA, each side a power of two (the nearest one up, at most max_size)"""
    img = img.convert('RGBA')
    w, h = pow2(min(img.width, max_size), hi=max_size), pow2(min(img.height, max_size), hi=max_size)
    if (w, h) != img.size:
        img = img.resize((w, h), Image.LANCZOS)
    return img


def _dxt5(img):
    """the DXT5 blocks of one picture (Pillow's encoder; its own header is cut off)"""
    b = io.BytesIO()
    img.save(b, format='DDS', pixel_format='DXT5')
    d = b.getvalue()
    return d[128:] if d[84:88] != b'DX10' else d[148:]


def _write_bgra(levels, path):
    """uncompressed 32-bit BGRA .dds (Direct3D's A8R8G8B8) - when this Pillow cannot write DXT5 (before 11.0)"""
    w, h = levels[0].size
    flags = DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PIXELFORMAT | 0x8 | (DDSD_MIPMAPCOUNT if len(levels) > 1 else 0)
    caps = DDSCAPS_TEXTURE | ((DDSCAPS_COMPLEX | DDSCAPS_MIPMAP) if len(levels) > 1 else 0)
    head = struct.pack('<4sIIIIIII', b'DDS ', 124, flags, h, w, w * 4, 0, len(levels)) + b'\0' * 44
    head += struct.pack('<II4sIIIII', 32, 0x41, b'\0\0\0\0', 32, 0x00FF0000, 0x0000FF00, 0x000000FF, 0xFF000000)
    head += struct.pack('<IIIII', caps, 0, 0, 0, 0)
    data = b''.join(l.convert('RGBA').tobytes('raw', 'BGRA') for l in levels)
    with open(path, 'wb') as f:
        f.write(head + data)


def write_dds(img, path, mipmaps=True):
    img = prepare(img)
    w, h = img.size
    levels = [img]
    while mipmaps and (levels[-1].width > 1 or levels[-1].height > 1):
        lw, lh = max(1, levels[-1].width // 2), max(1, levels[-1].height // 2)
        levels.append(img.resize((lw, lh), Image.LANCZOS))

    def block(l):                                  # levels under 4 pixels: one block of a 4 x 4 picture
        if l.width < 4 or l.height < 4:
            p = Image.new('RGBA', (max(4, l.width), max(4, l.height)))
            p.paste(l, (0, 0))
            l = p
        return _dxt5(l)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    try:
        data = b''.join(block(l) for l in levels)
    except (OSError, ValueError, KeyError, TypeError):      # Pillow without DXT encoding
        _write_bgra(levels, path)
        return w, h
    flags = DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PIXELFORMAT | DDSD_LINEARSIZE | (DDSD_MIPMAPCOUNT if len(levels) > 1 else 0)
    caps = DDSCAPS_TEXTURE | ((DDSCAPS_COMPLEX | DDSCAPS_MIPMAP) if len(levels) > 1 else 0)
    head = struct.pack('<4sIIIIIII', b'DDS ', 124, flags, h, w, max(1, w // 4) * max(1, h // 4) * 16, 0, len(levels))
    head += b'\0' * 44
    head += struct.pack('<II4sIIIII', 32, DDPF_FOURCC, b'DXT5', 0, 0, 0, 0, 0)
    head += struct.pack('<IIIII', caps, 0, 0, 0, 0)
    assert len(head) == 128
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(head + data)
    return w, h


def texture_file(name, size):
    """the file the game loads for a material's texture name: 'animals/my_dino_a.tga' -> 'animals/my_dino_a_(0256).dds'"""
    base = os.path.splitext(name.replace('\\', '/'))[0]
    return '%s_(%04d).dds' % (base, size)


def write_tga(img, path):
    """an uncompressed 32-bit TGA (the HUD's pictures)"""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    img.convert('RGBA').save(path, format='TGA', rle=False)
