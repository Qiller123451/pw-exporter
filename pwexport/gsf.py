#!/usr/bin/env python3
"""
pwexport.gsf - read ParaWorld (2006) .gsf model archives and write glTF 2.0 (.glb)
with meshes, textures, skeletons (rigs), skin weights, attachment points and animations.

This is the single GSF reader used by the Model Exporter app AND by the ParaWorld
remake's asset pipeline, so a fix here reaches both.

Library use
    from pwexport.gsf import Archive
    a = Archive('E:/Paraworld/Data/Base/GSF/all_animals.gsf')
    a.names()                                  # every model in the archive
    a.export('allosaurus', 'out/allosaurus.glb', data_dir='E:/Paraworld/Data')

Command line (batch conversion)
    python -m pwexport.gsf <file.gsf | folder> [more ...] -o <output folder>
                            [--data "E:/Paraworld/Data"] [--fps 30] [--all-lods]
                            [--no-textures] [--only name1,name2] [--all-parts] [--embed-textures]

    --data   the game's Data folder (used to find textures). If omitted it is
             guessed from the .gsf location (.../Data/<Mod>/GSF/x.gsf).

Requires Python 3.8+, numpy and pillow  (pip install numpy pillow)

Format notes (reverse engineered; builds on the GSF research by Zidell and
arceusVen1's Paraworld_gsf_viewer, https://github.com/arceusVen1/Paraworld_gsf_viewer;
full notes in docs/GSF_FORMAT.md):
  * all offsets are self-relative int32, 0x80000000 = null
  * vertices: 8 bytes = 3x13 bit position quantised in the chunk bbox,
    9 bit index into a 511-entry normal table, u8 u, u8 v.
    16 byte vertices append 4 bone indices (255 = unused) + 4 u8 weights.
  * skeleton: bones stored with children contiguous; bone local rest = T(pos)*R(q*)
    (quaternions are D3D/row-vector, i.e. conjugated for column vectors); rest
    scale is not inherited.  Bind matrices (row-major inverse bind) and vertex
    bone indices use depth-first bone order.
  * animation chunks (0x40000005): per-frame "helper" transform of one bone (depth-first index at +24,
    usually the root) + a tree of
    per-bone tracks keyed by depth-first bone index (flag 0x01000000: constant, one key). Track rotations are
    deltas applied on top of the rest rotation (in bone space).
"""
import argparse
import base64
import io
import json
import math
import os
import re
import struct
import sys
import zlib

import numpy as np

try:
    from PIL import Image
except ImportError:  # textures are optional
    Image = None

VERSION = '2026.10.9'     # bump when the output changes (invalidates cached conversions)
NULL = 0x80000000

_SPHERE_B64 = "eNoVmGk4lv/TxomKbJXseyVCKDv3NRNKooTs/yJlbbETodLyizYRSgslIdqTovv6DpUoLaK0KIU2rdJeyuN5Ny/nmHPm/JzHbCx9wBSsRtHHJA4rdl1i5Xdus9wCH/xdmMvmVE2kgjwrjNz2P7bNcwStCPPG9BvjWPmiHHaCxaGzxXveZo4uTbe3xx9J2/jNjg/Y9qJw/F4Yz2skqLC9ZWnIP9ejd7HEGzQj7jyhRMc6U5jV1lko92kkvcp/xxsZ+eGyvWKkkdPEZu93xOT1r5mTxBaWoh2AP2c0sIQ94kyUlqPwbSFbsXY7u3I/Eiuag1nKiHGsSWY1ug9KsNPXHl1KPJOOPTfNyOpqMnd3lwXyZVpUnOsIN2UcMOjDBHqzZRw3dZQ71paJ0+6/R6BK3BW5mr/skJoBTLMPQJljPaw8p0DQty4Ue69Us81BqhC0dCV6bMlnle0ZdvM7ElAkfj77xcuA25xkDDhwnQ2deQ6aV93wd3sR87p6GNZkheLk6s3s5ypp/M/HFfOUbNjrik74tGspJkjJsDRpA2xXEGCv5zd+268cWBsfj7aau/mbs6Vx6/+8MXKnEV+PI0F5bzpm7YsQRvS1wR8uEi3jngrcJPXxi6g9LtCy54wTM+FTbBIeKq3nGjQkcCjZF4/kfOLUjAe4kdFpuNJBFb4HNYF5UQTWbXQGC+lJuKEX0K3VBxKcEiCQj8MF/pthxTQR7PVaiFbdRZD/4CzwPkuxXFAHCdLKuPmcFQp3dUD6qBeQtMMFE19nwc11zZyyYyJW1lbD6KnOkChYjrXqr6H0mridX3QIZsr2gdvsXGjo9cUtfz9CUL8kjL8chEEpY/FighAeGnA4NlEe7Zfacab97jhmggKabvQA/+Vz0Uc4HVNy73FrPSwxalW34MqGVGHUs3V41BTByrNGKBmdiqabNkGHhSqrn5mAFTbHwEqtSnh8RyyqfT4OaJ3NJo0Lw5i+VuB7JNnLqeHoMrod7ubdYr5BHljV+hPUZ21kKi+9cVuDFCoueMrfOuOFT5PlsP5ULfu8H3C3jzYmrAlk844hrvttiCXVq/mJQwLcN/q03ZCfNDkr+6D784OC9MUFzO9YAp4t2sfl8VNpSwVgdMZVzn3nY3ZoRhiyiDucr64Om7YmFbP/GoH2fmny2OiB+85YQ9TTfNYSEoNzxOPBNkefLnVYYuX+jeBV9YANVgRixsgKSFgkSW9HzsFL+77C8dgRFGZmhWpFqvTmlyOlyi+DSn1V+vnXjKKONMAhZRVqKp5HH1tjuA5RZcqU1SClOSMx695XtnO0Hbnu+gULbnxl5QELqPHFCUCVL2wgfxFBkhVYNr9nqs+X0oPSTsEHg/dsWasObQrTwnFNZ9nnb6uo/uwANz3/JHOsFFBmuAL6iVSxA1mhFNiRB3teFbCpq31psOo1rFwUzRpvJJPhkwGBVqQ7q7qTSB09jqBZxrG3i2dSh+ZEDJM3ZSMtV1DG+/NQfluMPbYOoMA6UbQXnuQbbdbS2l1HObElAl4dk+lBSSIYa1cLxXfYU2KiHioINl/KWbaCJs+6DuozU8lonTHr/HmOe1qQTLqna3lz16VwSzuOUjeUsnzpmZzCvxgyL97GXga5woy4KNrlqs7Lzq+F5pqVdETHcbjXChh7K4QGzTtY7VFdsFJfSgfH9zP1/P12r7SCaeHNWvblxkHYa7GY1DZP5pNiRHBOXwD9EGQzy+RnMOuoBxmutBy+bSnMD/Gg8xVy1NUkCn2OwzO2FqPtoblwvcmFTI2fstNNT6D74ixaL5PJ932ciPygAz27WsEe3ZFFjVdWtKJNl2w+ZEDFNStaXGFKaUFC7qKdFT2ZupgtETPAfxctyH+lPEUdvQNhmSZ0yPwrs7oqjS826dKNrjrWnG6IFnvkqNdMlLxE9HHiwrX0v1EHBB5HX3GFY1Np9VcTyM1lnIp4Eh3cIOTaN22GiuZYaj67Hprq/CDtQCzZrikd1rCYa62OoGyLZVBXUg3J+mF0v6UJeA9XaDcJJa0vDdyR113QnxVMJp79MGZjHGdm5UuB94+BnH4nBBX4UIn+c9gQXwZuF7yoYJIXHJgujpvveJK2gwSqT5oL+wPc6HjCHi7bQxFPSrtQdoU6Zle4c53P7Ml/+Qc4H/UOMiTsCYdOwK0XcrjkJtBkB3lM2HMcTgUJaOtpDzgu0MVBS2sa3GGAvqnOMHqMPpnX9oODpBKeUdQji2AlHLV+AB7M16Ww+cdh5WoTvLBEktpL38PDOnMUhBmRYZcAK7Yjd+S6DlkXz8Bpp46DdIAy1ZbPwfAMJ8irH0MVfxVxwkwV1FwpSZ9O+mLBOSvuq4oEKa01Rw+XfiiaKkJa6+fhrCuVEOj8mjVPDsKAOgcIv3ePRZyejkOJivjN9R7bPlcep6eZD3vddVbe54pC/3ewO7uRTexegaxTwDkOVTNauwTdzpeBoHQvm1EVjRF5AGKtu9iDTCPsrjHGcIPtrPCQE+pnjEO176msde0iLNvbC/V3ItgesRS0quC421Hz2fG4VYgJh+HUrLFsu1EKSi22gTgrCbZ5sRc2PRiDUY+3817q61DHfyYnJrmVDx/mw5kfbcAPLeAj7Rwwxn4KOoyKu5S/NgntLLfCIa8/AgMVP4wYJYnaqTznvi0dn5m1cUWfmrgLBpG4L+gW7Jo/wL2umonf7+qitfwkKNZJwE7aAG1x7nD4sRdW+4jj33mbYcyERKwJFYG6SzthrPYy/GItBNP7eXBhiQ0eUNXG+jMEgUUumO73AzaWPwSjpSH4THkiiN3ugZK73hjeVgblJ/pg/CZDvN6rMMzEkbivbxT63DfEnHQJTHllg38EXfBYMB53D7qjUchJrsBfGdPfOKDDuY3w5aYaqtYrYZbEaJw1byp6+XZBV6467swxwiSlydj66RJES0/Hon3bwM7GEMU5c7Tsm4EtsqJgFMohc/8Jx+gj3B3ljAuwAtzaR+P9JFecNnEU3rp5AM7dcUWB0hQo5xRwo7wHhpEsjtVSBsNffiiRS5BWXQ/FGkvwv1Mm3MeU71CtvQT7Ff3gek4XZGYsxRsN92D7F1/4nhKCj5tfguQqG641cBVm6GyErS+2wbsXMciNucD5aZVDzUAcznTbC1f23+dur1qD2f9GwyvBJICWdei8qsdubocOt9tWA2eof2JPHk9E+f0m2HynjNllT8G27Bm4mk2i1eFHgRuwwrs5ptTyrYZLmWmDcx88YeEfJVF2iw2G5ErSwJ0noFQHuL7NlOX3T0a/XU7YlaRCzbNcYEmeMw7oKwh/y2jhWgtXrLqdy/wXSCJ9dcMUToQWCorAYp87tv/XwnpGPIQznh7o3TWePhc5cjXMDxPuibJj88XR89NiFJ33mUVoT4Ho/mA8KJ/KPofdgrAjy9BpVC07WpoNsofD8IdNF2s5FGBrO3kVymUc4UvSh/fHKQYV/pUyh7uD3JHcOJSsX8AUetPg++w1WPlxHK88ywuSLqeiZOlk9i+4inNI0+YGLf3o0VkJjFmcw6X4ppPJryFu3r/X3LY/8RTZmA1Hn8hA+WRHmtSpgxE3NKFEJoQMyx5DV7YdiFemkkhjs53d9kjovJpIVupT4OzXLPhhG0lTGouheMRecLmHpLdFCQVdB+CLmg9ZC99AsWYVTBofS01O2lyO3GVwvRlOiXmOkJHSDIbjJ5Hz36mI1g/gOe9LdcbHQW79G5jxRkCyh4bgnuNXuB+4hHKcNnMO9iPR9NtCaiv3hgNXJbBfWZWKPinhzmRZtNSwJ6nZZ6F1iRp+DHQhb1bOJXxQw6x2XRoz/y1UOutiwl47ei26CJ4dMSbPIFtSk93GbxvOyeMzkRb/DmcwWpGexUyiTwlD7PqQNFVxXjQY3chzn8aQ1OSZVDC6gRVM/sGumfvSreRUpqfwjT2sUSfU0qEqh15WUm1Hl5+JkZfqXfb3aTittX7Di++4zv45e9OUl9fYVIdKlnIigp4/WM9Ctx5jDZYzyGfsJPI7kccOmrjRQydxclfPZLd/J1BGwUf+/FAsexkYQqIWjWzVNRs2bjCeFC2S2dNbZszstz29eqlNUnNEWIlTOvHb9vCm/F/+ZH8A5bSJUOH6Yr7/1yrSSbjIuqe+EDqXryFjGzd2HZyFz8pdaNQydRqbso7mZabwRWtKhXsSU2nctot89FJ91ns5hcRFfJnV9g38Ybk4Cq6IZx5hy5hKTwy9Ot3Jp4aXMjvlVXRvzkV25OYr3k8zhHYdyWBN9+tZVn4wTd/XyCbc2saSrgVRiOYjPuXUAIub708nzEXp5Dgdlh/sTv2bM9iDJyOp1tudhu5cZ3pHHrN94ErLI9TINleKDwh1oci/I+nq+RJmWuxM3qWX+QhdDfpki6RxYuKwHs7M2tWGPvlcY6bTxlPJLCsKFUlmkkf1KPWXBfWbjSIzpX72a+40inbRpcIv1Sz2pAZpfa9jvudmkHSAOllMHkGdkWq0on8tZRqd5Zr6Hwq/dqdQyX0VEG/WZtlZyWSsGge7Y3T4cKlkmn1pDFf8Zg37IRpDUYM5sEhnHvt9IZrOXzOFr1EH2OrQFTTleCPIfy7gN05fTim7NLmn7bdYm3owZf4ohb+bzrHCC4F0/eUzkHKIZG5TAkkjYBa84N+yVaq+1NUsgTV1Ql7lmjfN2+HO6XLSdCHFlT5f+gy/TK8wGylXWhZ8GkJ2ixAsciLJvxPQ7UIa67CdTRkf3CG1WJX0ntjR9A+GWLnhLm88ZENJDUu4xz4mVKQ3gyS8f4Nq2SjS7DKhZdLqWJt1g2nomNDD4mrQjJpEOYXyNK/hN6xZqUcmyvrU9NACL97MYBZ6avS+cy72aHXwMx/LU4OtJvr/J0G9DbLkkmaLSZdbWEWlOB028cDN9hnMSu0dq34TjNd+tvJ5W16ylEXq2DlBj/74dTMLGVuMFBlNWefaWOk/T/xs3MQ+y11iOyTCUOxdMjNTKWJL+sxx3Y+JZPx6HxO9EodGB67ys8fns/rVC3BoWLMDjRvZ6ZwQPG7Ns4AvC9n0vHhU0o9kpdZ6zEBsDjZlqNGxI/KsySUNn3TU8OueyDLpN4sxSvkbq9K5y2fpRWOK+Cm26OQ/YXnSGqyJ8GDLhV+F1zkbfL/FlN7P3y588N0TM7+MpclSyoJHBaG4JraHzbMw49xmrcPIY2n8Kv8iLq0jFr3NjrDVjx9z6ndn4wsjbZrVOQ76DFIwwt6aaTRpwbLAZSjp9pQ90nMHlew1OEe7S1h2fwmck3TH96ZjSDt1Ffj1rsQN2YVsvX4yOI22xoKWKdTWXQg0EIPH/2qwR+cPgsKNADQQ6WDdYy6CcW8UHslOuXTrLQ9KXx1QXk6Cojc1QptVMNY77GQ7NZvgxnY9lBzUpU33XsLNwKUo0i3GPmm9g+MJrvjcuIVFKYijiq8pxiwaQYb/jcalwvFoqalNM8QlcLHFAmwau57ddFTE0sb5+G/ONX6+mwrWZVhiwZ06VnlxKu6usMK9yv9jBa26+F1PBdszhxkmpo+vbb/BI06BPH4Z4qalVfDbYCopbrbAEf1m+J9POG992BrNS9TRdF4ZC7/ggDttf8P1lscs5ZYjhlrwYKIwmqhjNm59Ew6RjUpketgJ8zbWcjntWuRW64RZwWp4YJUxCy1fgK6nFDB8YL7Qy3MhOmoNQhHuYHLBfnj/TiqsfD/AHDX9cZerEDwdr7Dfqf640/eQwOjLKKoQDUKJ11/gh91X3mZtCM52+cKdrOtiZt3heOxbDQxaRLLIHZFoXBUDf05VsYqhGGyIPQYhfpv5wvvxqOh6hvv/v8hzkyTMmukNsScsWb1OGpr/MAUNH2uhRnY6Ss5w4G7Fi7OtLQo4ngbY+JX6FKc4EQU/D7PVD82H/UcfR5ZJUdeIkeR/1RxXL1cliZc80++3xPaIGyyVlyeROMDbsQZkcnU5PzhcF33QoZJzi5jY+Zl4+3k0607XoHVHZqNV2Rbep12Hoo2dMOjce1a57CmDXE+UqTzIilu+spf7PLH/6T82ULid8Tu88azBGHrz7TVv5+OPh1QmMC+NEaQvE4yDC8+yR/llTH9JOLpb3GDJtfqspy8Sg3uQpRVeZAH7l+NqhTbh/ZSbrH1aPLosjmM04M7u7U9E9387WVucNh/hvxr1z+/hk1vTWKJfOv6x7edNGo7xlffeCzSvrKOvT0bwThJyXPf+pRT23wdmvOsQt7czlvIHStgMP1F4XreGjgt02Jmy8XBzpgfteihLUvqzwE12GY2Z/oB97w+FyiJrcm7Uo7zwKGiZEE3Fb7ayrt3Z0NYbT44i/Xzf3EK4V+RCn8MlSHzHGSj2DyCD5ib2I7EeFJ8ZkUrCROqobIQ+wxCyWRfPNi7ohKHAMDrxp5yPv/8CXFsE9KtIlFyqB6HRz4WmXKllYcKR+PadBg2dU6SWTaPR2sWT0NKfnUqVw9Z1Cyl99Qr+ipMCBgVPI/Wal6zQSQvnmdlQv3khUy+Ygt4EZHlagYn0NrB2pTYmv8SL5A0ususTx1HaBY4Ut8SzzB8ilLHXixZlxzG/qhrm6BNO3TL+rCthEk0K5yhW/Dq/X62XnZQNobL0c7yESAE7LIynhh5T3sxiGrUYC2iE/jVhmKkie6mXTkm9U6lisIUvuMlR4SYx+sV+8n9X+JPITlEyHdjH1lx2o7Lav+yJ4RdmY2hLy015di16A4u8GkIv+LNsbng9P+dUFPWcDmE2e+ez98YJ5F8yiRWs9uaL/5dGktum0HWBJ6Qa29GteGV62LGAq4b5lHtLhprzz8K8THvKqR1BNZHz4JCSD23ofsG4SwLO6UwIfRvXyrQLTkCohT/lPzzPckKcQERjOW3V3MUS0oO4iJmJ9LNcnGllPOP656WRzJVnzMXxG+zpcaCYKUXMaLYidu1GSkjLYz1v3sKgqC/N2prBOkSOwt7/IulPzgzmgIZ4+7c1GWtMYopPpHB2hidZvhji3/a1w+qOMDpY+5o/Hp0JOyQTqfXeCqGlrRqaZLnSsy1idkunLxeY/FpHzcl5As2uL+AmHUyj9UoEcNoMVH+n0oymAYG6fSWMd4+lkv5fXFXLVDw1kqPP9zVhcrsk3pTyon/BhtCTkwyZRQnEthhCwMMW0OgNo+bUHeDxQwWrXyG9FikEqT0fYGWKN7lHF0FoUxFYaodRw4sOmG00CuXOc5Rlrw0Op4q5FbJpNM7jAHhPVxjOxzG07+4z6JOx4k5+CyUqfA5yd+uh87k7bTTvhadtAVDQEkhPC2VQIqELLv+0IFn5cXjm+U6ISHSi1sBxGNr9jus/6k6ajdPw0cciQfJ7O9JeY4x3T1tD1w4LspAZA60HzvOKR9Noms4WCEp1Yrd7Ykl4Ig/unrwsrHiRQKq/rkKG7h72uieI1tfcH/bdESzKI4yUDg6CRG4Ta5WbQ816ElhnEs6iP7sP6yI7zKVg/reeF+18ORUfzFdhYcV2FJGzSmC0VJqmSfmQ8bX13LlzrQwtI2nv03bu5+B6xnsm0eb//ePqBZNJpNme5kZawu+pI6iiypcC7oXDu781rOlbOE2pyIFQVRUquYPEyZ0Eze1vGLR60iXnbnjbMoYG7K3o/wC+Knr9"
SPHERE = np.frombuffer(zlib.decompress(base64.b64decode(_SPHERE_B64)), '<f4').reshape(-1, 3).astype(np.float64)


# =========================================================================== reader
class R:
    def __init__(self, data):
        self.d = data

    def u32(self, o): return struct.unpack_from('<I', self.d, o)[0]
    def s32(self, o): return struct.unpack_from('<i', self.d, o)[0]
    def u16(self, o): return struct.unpack_from('<H', self.d, o)[0]
    def u8(self, o): return self.d[o]
    def f32(self, o): return struct.unpack_from('<f', self.d, o)[0]
    def fs(self, o, n): return list(struct.unpack_from('<%df' % n, self.d, o))

    def ptr(self, o):
        v = self.u32(o)
        if v == NULL:
            return None
        return o + struct.unpack_from('<i', self.d, o)[0]

    def lstr(self, o):
        n = self.u32(o)
        return self.d[o + 4:o + 4 + n].split(b'\0')[0].decode('latin1'), o + 4 + n

    def name_block(self, o):
        n = self.u32(o + 8)
        return self.d[o + 12:o + 12 + n].split(b'\0')[0].decode('latin1')


# =========================================================================== header 1 (names)
def parse_header1(r):
    """model names + animation names (index -> name) from the table of contents"""
    o = 12
    _, o = r.lstr(o)
    nmodels = r.u32(o); o += 4
    models = []
    for _ in range(nmodels):
        name, o = r.lstr(o)
        idx = r.u32(o); o += 4
        nanim = r.u32(o); o += 4
        anims = []
        snd = {}
        for _ in range(nanim):
            an, o = r.lstr(o)
            ai = r.u32(o); o += 4
            ns = r.u32(o)
            snd[ai] = [r.u32(o + 4 + 4 * k) for k in range(ns)]
            o += 4 + 4 * ns
            o += 4
            anims.append((an, ai))
        nws = r.u32(o); o += 4
        walksets = {}
        for _ in range(nws):
            # walk set: 42 slots, each a 1-based position in the animation list above (0 = none; 1 byte, or 2 bytes
            # big endian with the top bit set when >= 0x80) + a 4 character name ("def", "defn" = the newer SEAS/hero
            # walks, "hump" = injured animals, "sldr"/"cary" = carrying). Slots 0-2 = walk speeds 1-3, 4-12 = stops,
            # 16/17 = turn on the spot, 19/20 = accelerate, 23/24 = brake, 25/26 = walk turning left/right.
            slots = []
            for _ in range(42):
                if r.d[o] & 0x80:
                    v = ((r.d[o] & 0x7F) << 8) | r.d[o + 1]; o += 2
                else:
                    v = r.d[o]; o += 1
                slots.append(anims[v - 1][0] if 0 < v <= len(anims) else None)
            tag = bytes(r.d[o:o + 4]).split(b'\0')[0].decode('latin-1'); o += 4
            walksets[tag] = slots
        models.append(dict(name=name, index=idx, anims=anims, sound_refs=snd, walksets=walksets))
    # sound event table (animation sound triggers): count, then records
    #   [lstr wav][u32 frame][u32 volume][f32 pitch][f32 ?][f32 min fade][f32 max fade][f32 max hearing][lstr group]
    sounds = []
    try:
        n = r.u32(o); o += 4
        for _ in range(n):
            wav, o = r.lstr(o)
            frame = r.u32(o); vol = r.u32(o + 4)
            f = r.fs(o + 8, 5); o += 28
            grp, o = r.lstr(o)
            sounds.append(dict(wav=wav, frame=frame, vol=vol, pitch=f[0], minfade=f[2], maxfade=f[3], maxhear=f[4], group=grp))
    except Exception:
        pass
    for m in models:
        m['sounds'] = sounds
    return models


# =========================================================================== header 2
def parse_header2(r):
    h2 = r.u32(8)
    return dict(model_info=r.ptr(h2 + 16), n_model_info=r.u32(h2 + 20),
                anim_info=r.ptr(h2 + 24), n_anim_info=r.u32(h2 + 28),
                n_materials=r.u32(h2 + 32), materials=r.ptr(h2 + 36))


def parse_materials(r, h):
    mats = []
    if h['materials'] is None:
        return mats
    for i in range(h['n_materials']):
        b = h['materials'] + i * 24
        tex, nm, env = r.ptr(b + 8), r.ptr(b + 12), r.ptr(b + 16)
        mats.append(dict(attr1=r.u32(b), attr2=r.u32(b + 4),
                         tex=r.name_block(tex) if tex else None,
                         nm=r.name_block(nm) if nm else None,
                         env=r.name_block(env) if env else None))
    return mats


def parse_model_infos(r, h):
    out = []
    for i in range(h['n_model_info']):
        b = h['model_info'] + i * 84
        m = dict(offset=b, fourcc=r.d[b:b + 4].decode('latin1', 'replace'))
        no = r.ptr(b + 4)
        m['name'] = r.name_block(no) if no else ''
        ct = r.ptr(b + 8)
        m['chunks'] = [r.ptr(ct + 4 * k) for k in range(r.u32(b + 12))] if ct else []
        fb = r.ptr(b + 16)
        m['used_materials'] = [r.u32(fb + 20 + 4 * k) for k in range(r.u32(fb + 12))] if fb else []
        at = r.ptr(b + 76)
        anims = []
        for k in range(r.u32(b + 80)):
            e = at + k * 12
            t2 = r.ptr(e + 4)
            anims.append([(r.ptr(t2 + 8 * j), r.u32(t2 + 8 * j + 4)) for j in range(r.u32(e + 8))] if t2 else [])
        m['anims'] = anims
        # pathfinder / collision table: 32-byte records [u32 type][3f][3f][u32 attr]
        #   type 1 = box (min corner xyz, size xyz), 0 = sphere (centre xyz, r, r*r, 0), 2 = tube (bottom centre, r, 0,
        #   height), 3 = ellipsoid (centre, radii) -- model space, Z-up; attr = the record's visibility bits (like meshes)
        pf = []
        try:
            pp = r.ptr(b + 44)
            for k in range(r.u32(b + 48) if pp else 0):
                e = pp + 32 * k
                pf.append([r.u32(e)] + [round(v, 4) for v in r.fs(e + 4, 6)] + [r.u32(e + 28)])
        except Exception:
            pf = []
        m['pf'] = pf
        m['bbox'] = [round(v, 4) for v in r.fs(b + 52, 6)]
        out.append(m)
    return out


# =========================================================================== chunks
def parse_skeleton(r, c):
    bp = r.ptr(c + 76)
    nall = r.u32(c + 80)
    offs = [c + 16] + [c + 92 + 60 * k for k in range(nall - 1)]
    bones = []
    for o in offs:
        f = r.fs(o + 8, 10)
        bones.append(dict(guid=r.u32(o), pos=f[0:3], scale=f[3:6], quat=f[6:10],
                          nchild=r.u32(o + 48), child_ptr=r.ptr(o + 52), parent=-1))
    idx_of = {o: i for i, o in enumerate(offs)}
    for i, b in enumerate(bones):
        if b['child_ptr'] is not None and b['nchild']:
            f = idx_of[b['child_ptr']]
            for k in range(b['nchild']):
                bones[f + k]['parent'] = i
    order = []
    kids = {i: [j for j in range(nall) if bones[j]['parent'] == i] for i in range(nall)}

    def walk(i):
        order.append(i)
        for j in kids[i]:
            walk(j)
    for i in range(nall):
        if bones[i]['parent'] < 0:
            walk(i)
    bind = [np.array(r.fs(bp + 64 * k, 16), dtype=np.float64).reshape(4, 4) for k in range(nall)] if bp else None
    return dict(bones=bones, dfs=order, bind=bind, guid=r.u32(c + 8))


def decode_vertices(r, off, n, stride, bbox, ext_uv=False):
    raw = np.frombuffer(r.d, dtype=np.uint8, count=n * stride, offset=off).reshape(n, stride)
    q = np.zeros(n, dtype=np.uint64)
    for k in range(8):
        q |= raw[:, k].astype(np.uint64) << np.uint64(8 * k)
    mn = np.array(bbox[:3]); mx = np.array(bbox[3:])
    m13 = np.uint64(0x1FFF)
    p = np.stack([q & m13, (q >> np.uint64(13)) & m13, (q >> np.uint64(26)) & m13], 1).astype(np.float64)
    p = p / 8191.0 * (mx - mn) + mn
    ni = (((q >> np.uint64(39)) & np.uint64(1)) * np.uint64(256) + ((q >> np.uint64(40)) & np.uint64(0xFF))).astype(np.int64)
    nrm = SPHERE[np.clip(ni, 0, len(SPHERE) - 1)]
    # the game stores v bottom-up (OpenGL style); glTF wants it top-down
    if ext_uv and stride == 9:
        # "extended UV (1024)": 10-bit texture coordinates for large smooth surfaces (rivers, lava, basins), where
        # 8 bits show as steps. Byte 8 holds the two high bits (u: bits 0-1, v: bits 2-3); uv = value / 1024.
        hi = raw[:, 8].astype(np.float64)
        u = ((hi % 4) * 256 + raw[:, 6]) / 1024.0
        v = ((hi // 4 % 4) * 256 + raw[:, 7]) / 1024.0
        uv = np.stack([u, 1.0 - v], 1)
    else:
        uv = np.stack([raw[:, 6] / 256.0, 1.0 - raw[:, 7] / 256.0], 1)
    out = dict(pos=p, nrm=nrm, uv=uv)
    if stride >= 16:
        out['bidx'] = raw[:, 8:12].astype(np.int32)
        out['bw'] = raw[:, 12:16].astype(np.float64)
    return out


# chunk type -> (kind, skinned, simple)
MESH_TYPES = {
    0x00000000: ('mesh', False, False),
    0x80000000: ('mesh', True, False),
    0x20000000: ('mesh', True, True),
    0x00000009: ('cloth', False, False),
    0x80000009: ('cloth', True, False),
    0x20000009: ('cloth', True, True),
}


def parse_mesh(r, c):
    t = r.u32(c)
    kind, skinned, simple = MESH_TYPES[t]
    m = dict(kind=kind, skinned=skinned, attr=r.u32(c + 4), guid=r.u32(c + 8),
             matrix=np.array(r.fs(c + 12, 16), dtype=np.float64).reshape(4, 4), skel=0)
    o = c + 80
    if skinned:
        m['skel'] = r.u32(o); o += 4
    if simple:
        m['cbidx'] = list(r.d[o:o + 4]); m['cbw'] = list(r.d[o + 4:o + 8]); o += 8
    # 8 bytes: u32 8, u32 baked-light parameters. Vertices of 9 / 17 bytes carry one more byte: the baked ambient
    # light when those parameters are set, else the high bits of "extended" texture coordinates.
    ext_uv = kind == 'mesh' and r.u32(o + 4) == 0
    o += 8 if kind == 'mesh' else 36
    m['bbox'] = r.fs(o, 6); o += 24
    nsub = r.u32(o); subp = r.ptr(o + 4); matp = r.ptr(o + 12); nmat = r.u32(o + 16)
    mats = [r.u16(matp + 2 * k) for k in range(nmat)] if matp else []
    subs = []
    for k in range(nsub):
        if kind == 'mesh':
            s = subp + 56 * k
            nv, nt, vp, tp, stride = r.u32(s + 24), r.u32(s + 28), r.ptr(s + 32), r.ptr(s + 36), r.u32(s + 44)
        else:
            s = subp + 60 * k
            nv, nt, vp, tp, stride = r.u32(s + 24), r.u32(s + 28), r.ptr(s + 36), r.ptr(s + 40), r.u32(s + 56)
        if not (vp and tp and nv and nt) or stride < 8 or stride > 64:
            continue
        v = decode_vertices(r, vp, nv, stride, m['bbox'], ext_uv)
        tris = np.frombuffer(r.d, dtype='<u2', count=nt * 3, offset=tp).reshape(nt, 3).astype(np.int64)
        tris = tris[(tris < nv).all(1)]
        subs.append(dict(v=v, tris=tris, mat=mats[k] if k < len(mats) else 0))
    m['subs'] = subs
    return m


def parse_billboard(r, c):
    """billboard chunk (1 = static, 0x80000001 = attached to a bone): camera facing sprites, used for tree foliage.
    Every vertex is the centre of one sprite. The sprite image is one cell of the texture atlas: bytes +81..+83 =
    cell index, log2 of the rows, log2 of the columns (the atlas is split into 2^cols x 2^rows equal cells, numbered
    row by row; e.g. 2,2 = a 4x4 grid, 3,3 = 8x8, 4,4 = 16x16, 3,2 = 4 columns x 8 rows). Checked against the alpha
    channel of every atlas: ~96 % of the cells read this way have transparent borders (the rest are building
    effect sprites). +76 (u32) = the material, an index into the model's used materials."""
    t = r.u32(c)
    b = dict(attr=r.u32(c + 4), matrix=np.array(r.fs(c + 12, 16), dtype=np.float64).reshape(4, 4),
             skinned=(t == 0x80000001))
    b['mat'] = r.u32(c + 76)                          # index into the model's used materials (the sprite atlas)
    a = r.d[c + 80:c + 84]
    b['cell'], b['grid'] = a[1], (1 << min(a[3], 6), 1 << min(a[2], 6))     # (columns, rows)
    b['uv'] = sprite_uv(b['cell'], b['grid'])
    b['size'] = r.f32(c + 88)
    o = c + 108 if b['skinned'] else c + 104
    bbox = r.fs(o, 6)
    nv, vp, stride = r.u32(o + 24), r.ptr(o + 28), r.u32(o + 32)
    if not vp or not nv or stride < 5 or stride > 64 or not (0.01 < b['size'] < 1000):
        return None
    raw = np.frombuffer(r.d, dtype=np.uint8, count=nv * stride, offset=vp).reshape(nv, stride)
    q = np.zeros(nv, dtype=np.uint64)
    for k in range(5):
        q |= raw[:, k].astype(np.uint64) << np.uint64(8 * k)
    mn, mx = np.array(bbox[:3]), np.array(bbox[3:])
    m13 = np.uint64(0x1FFF)
    p = np.stack([q & m13, (q >> np.uint64(13)) & m13, (q >> np.uint64(26)) & m13], 1).astype(np.float64)
    b['pos'] = p / 8191.0 * (mx - mn) + mn
    if b['skinned'] and stride >= 6:
        b['bone'] = raw[:, 5].astype(np.int32)        # per sprite: the bone it hangs on (joint index, as mesh vertices)
    return b


# drawn sprite height = stored size / 4 (calibrated on objects of known size: Dragon Clan barrels and paper lanterns,
# flowers, fruit - at the stored size a barrel would be 6.8 m tall). Sprites on the ground (grass and bushes around
# buildings, centre below 0.3) stand on it.
SPRITE_SCALE = 0.25


def sprite_uv(cell, grid):
    """[u0, v0, u1, v1] of atlas cell `cell` in a grid of grid[0] columns x grid[1] rows"""
    nx, ny = grid
    col, row = cell % nx, (cell // nx) % ny
    return [col / nx, row / ny, (col + 1) / nx, (row + 1) / ny]


def billboard_geometry(b, n_axes=2):
    """turn sprite centres into static geometry for formats without camera-facing sprites: per sprite n_axes
    vertical quads crossed around the up axis (Z), each sprite turned by its own (repeatable) angle so the canopy has
    no grid look. Engines that can draw real sprites use extras.foliage instead."""
    M = b['matrix'].T
    centres = b['pos'] @ M[:3, :3].T + M[:3, 3]
    u0, v0, u1, v1 = b['uv'] if 'uv' in b else sprite_uv(b['cell'], b['grid'])
    hh = b['size'] * SPRITE_SCALE * 0.5
    hw = hh * (u1 - u0) / max(v1 - v0, 1e-6)
    rng = np.random.RandomState(len(centres) * 7919 + int(b['size'] * 100))
    P, N, UV, T = [], [], [], []
    for c in centres:
        if c[2] < 0.3:
            c = c + np.array([0, 0, hh * 0.9])
        yaw = rng.uniform(0, math.pi)
        axes = []
        for k in range(n_axes):
            a_ = yaw + k * math.pi / n_axes
            d = np.array([math.cos(a_), math.sin(a_), 0.0])
            axes.append((d, np.array([0, 0, 1.0]), np.array([-d[1], d[0], 0.0])))
        for ax_u, ax_v, nrm in axes:
            base = len(P)
            for du, dv, uu, vv in ((-1, -1, u0, v1), (1, -1, u1, v1), (1, 1, u1, v0), (-1, 1, u0, v0)):
                P.append(c + ax_u * du * hw + ax_v * dv * hh)
                N.append(nrm)
                UV.append((uu, vv))
            T += [(base, base + 1, base + 2), (base, base + 2, base + 3)]
    return np.array(P), np.array(N), np.array(UV), np.array(T, dtype=np.int64)


def parse_link(r, c):
    t = r.u32(c)
    L = dict(attr=r.u32(c + 4), pos=r.fs(c + 12, 3), quat=r.fs(c + 24, 4),
             name=r.d[c + 40:c + 44].split(b'\0')[0].decode('latin1', 'replace'))
    if t == 0x8000000B:
        L['skel'] = r.u32(c + 44)
        L['bidx'] = list(r.d[c + 48:c + 52]); L['bw'] = list(r.d[c + 52:c + 56])
    return L


def fill_invalid(fr, nq):
    """some frames contain NaN / zero quaternions: replace them with the nearest valid frame"""
    fr = fr.copy()
    ok = np.isfinite(fr).all(1) & (np.linalg.norm(np.nan_to_num(fr[:, :nq]), axis=1) > 1e-6) \
        & (np.abs(np.nan_to_num(fr)).max(1) < 1e6)
    if ok.all():
        return fr
    if not ok.any():
        fr[:] = 0
        fr[:, 3] = 1
        return fr
    idx = np.where(ok)[0]
    for k in np.where(~ok)[0]:
        fr[k] = fr[idx[np.argmin(np.abs(idx - k))]]
    return fr


def parse_anim(r, c):
    """skeletal animation chunk 0x40000005"""
    nf = r.u32(c + 40)
    rootkind = r.u8(c + 25)
    gp, sp, ns = r.ptr(c + 28), r.ptr(c + 32), r.u32(c + 36)
    # the "helper" track drives the bone with this depth-first index: 0 (the skeleton root) for creatures, but e.g.
    # the lighthouse lamp of hu_harbour (1) or the fan on top of seas_greenhouse (15)
    a = dict(nframes=nf, root=None, tracks=[], helper_bone=r.u8(c + 24))
    # flags (+12): 0x1 = loop marks at +16 (int16 first and last frame of the loop part: the clip is start + loop +
    # end, "S/L/E"), 0x4 = root height at +20. +48 = the speed of the loop in m/s (walk clips).
    flags = a['flags'] = r.u32(c + 12)
    ls, le = struct.unpack_from('<hh', r.d, c + 16)
    a['loop'] = (ls, le) if flags & 1 and 0 <= ls < le < max(nf, 1) else None
    try:
        spd = r.fs(c + 48, 1)[0]
        a['speed'] = round(float(spd), 4) if 0 < spd < 100 else None
    except Exception:
        a['speed'] = None
    if gp and nf:
        stride = {0: 10, 1: 13, 2: 4}.get(rootkind, 10)
        fr = fill_invalid(np.array(r.fs(gp, stride * nf)).reshape(nf, stride), 4)
        a['root'] = dict(q=fr[:, 0:4], t=fr[:, 4:7] if stride >= 7 else None,
                         s=fr[:, 10:13] if stride == 13 else None)

    def walk(tp, n, depth=0):
        if depth > 64:
            return
        for k in range(n):
            e = tp + 16 * k
            at = r.u32(e)
            typ = (at >> 8) & 0xFF
            dp = r.ptr(e + 4)
            if dp and typ in (2, 3, 4):
                stride = {2: 4, 3: 5, 4: 8}[typ]
                if at & 0x1000000:
                    # constant track: one key only (high flag byte 0x01). Reading nf keys here used to run into
                    # the next tracks' data and bent necks/fingers into impossible poses.
                    fr = np.tile(np.array(r.fs(dp, stride)), (nf, 1))
                else:
                    fr = np.array(r.fs(dp, stride * nf)).reshape(nf, stride)
                fr = fill_invalid(fr, 4)
                tr = dict(bone=at & 0xFF, q=fr[:, 0:4])
                if typ in (3, 4):
                    tr['dx'] = fr[:, 4]
                if typ == 4:
                    tr['s'] = fr[:, 5:8]
                a['tracks'].append(tr)
            np_ = r.ptr(e + 8)
            if np_:
                walk(np_, r.u32(e + 12), depth + 1)
    if sp:
        walk(sp, ns)
    return a


def parse_obj_anim(r, c):
    """object (mesh chunk) animation 0x40000003: absolute per-frame transforms"""
    b = c + 4
    nf_m, fp = r.u32(b + 44), r.ptr(b + 48)
    kp, nk, ip, ni = r.ptr(b + 60), r.u32(b + 64), r.ptr(b + 68), r.u32(b + 72)
    if kp and nk and ip and ni:
        keys = np.array(r.fs(kp, 7 * nk)).reshape(nk, 7)
        idx = np.clip(np.frombuffer(r.d, '<u2', ni, ip).astype(int), 0, nk - 1)
        q = qnorm(qconj(keys[idx, 3:7]))
        t = keys[idx, 0:3]
        s = None
    elif fp and nf_m:
        mats = np.array(r.fs(fp, 16 * nf_m)).reshape(nf_m, 4, 4)
        t, q, s = [], [], []
        for M in mats:
            t_, q_, s_ = decompose(M.T)
            t.append(t_); q.append(q_); s.append(s_)
        t, q, s = np.array(t), np.array(q), np.array(s)
        if np.abs(s - 1).max() < 1e-5:
            s = None
    else:
        return None
    q = np.nan_to_num(np.asarray(q, dtype=np.float64))
    bad = np.linalg.norm(q, axis=1) < 1e-6
    q[bad] = [0, 0, 0, 1]
    q = qnorm(q)
    t = np.nan_to_num(np.asarray(t, dtype=np.float64))
    for k in range(1, len(q)):
        if np.dot(q[k], q[k - 1]) < 0:
            q[k] = -q[k]
    return dict(t=t, q=q, s=s)


def BIT(i):
    """mask of attribute flag number i (numbering used by the community GSF docs)"""
    return 1 << (8 * (i // 8 + 1) - i % 8 - 1)


def default_visible(fourcc, attr, ctx):
    """True if a mesh chunk belongs to the model's default in-game look
    (finished, undamaged, daytime, no shadow/selection helpers, default equipment)"""
    ft = fourcc.strip().lower()
    if ctx.get('relaxed'):
        return not attr & (BIT(20) | BIT(21))
    if ft != 'wall' and attr & BIT(21):         # selection volume
        return False
    if ft in ('bldg', 'fiel', 'deko', 'ship', 'vgtn', 'misc') and attr & BIT(20):  # shadow model / tree billboard
        return False
    if ft in ('bldg', 'deko', 'misc', 'wall', 'fiel', 'ship') and attr & BIT(19):  # night-only lights
        return False
    if ft == 'ship':
        # ships: flag 29 = intact hull, 27/28 = damage stages
        if attr & (BIT(27) | BIT(28) | BIT(30)) and not attr & BIT(29):
            return False
    if ft in ('bldg', 'wall', 'fiel', 'misc', 'deko'):
        dest = attr & (BIT(27) | BIT(28))
        if attr & BIT(29):                       # construction-stage flags in use
            if not attr & BIT(30):               # not part of the finished building
                return False
        elif dest:                               # only shown when damaged
            return False
    if ft == 'bldg' and ctx['ages']:
        ages = [i for i in (10, 11, 12, 13, 14) if attr & BIT(i)]
        if ages and min(ctx['ages']) not in ages:  # show the most advanced age variant
            return False
    if ft == 'ress':
        res = attr & (BIT(0) | BIT(1) | BIT(2) | BIT(13) | BIT(14) | BIT(15))
        if res and not attr & BIT(13):          # full resource stage
            return False
    if ft == 'anim':
        equip = attr & (BIT(0) | BIT(1) | BIT(13) | BIT(14) | BIT(15) | BIT(16) | BIT(17) | BIT(18) | BIT(19) |
                        BIT(28) | BIT(29) | BIT(30) | BIT(31))
        if equip:                                # saddles / armour / standards of tamed animals
            return False
    return True


# =========================================================================== math
def qmul(a, b):
    """Hamilton product, xyzw, vectorised"""
    ax, ay, az, aw = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bx, by, bz, bw = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw,
                     aw * bw - ax * bx - ay * by - az * bz], -1)


def qconj(q):
    q = np.array(q, dtype=np.float64)
    return q * np.array([-1, -1, -1, 1.0])


def qnorm(q):
    n = np.linalg.norm(q, axis=-1, keepdims=True)
    n[n < 1e-12] = 1
    return q / n


def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def mat_to_quat(m):
    m = np.array(m[:3, :3], dtype=np.float64)
    for i in range(3):  # remove scale
        n = np.linalg.norm(m[:, i])
        if n > 1e-12:
            m[:, i] /= n
    tr = m[0, 0] + m[1, 1] + m[2, 2]
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
    return qnorm(np.array(q))


def decompose(M):
    t = M[:3, 3].copy()
    s = np.linalg.norm(M[:3, :3], axis=0)
    if np.linalg.det(M[:3, :3]) < 0:
        s[0] = -s[0]
    R_ = M[:3, :3] / np.where(np.abs(s) < 1e-12, 1, s)
    return t, mat_to_quat(np.pad(R_, ((0, 1), (0, 1)))), s


def reduce_keyframes(v, eps):
    """indices of keys to keep so that linear interpolation stays within eps"""
    n = len(v)
    keep = [0]
    a = 0
    b = 2
    while b < n:
        # try to extend segment a..b; check all interior keys
        t = (np.arange(a + 1, b) - a) / float(b - a)
        interp = v[a][None, :] * (1 - t)[:, None] + v[b][None, :] * t[:, None]
        if np.abs(interp - v[a + 1:b]).max() > eps:
            keep.append(b - 1)
            a = b - 1
        b += 1
    keep.append(n - 1)
    return np.array(sorted(set(keep)))


# =========================================================================== textures
class TextureFinder:
    """maps game texture paths (e.g. 'animals/ice_henodus_a.tga') to files on disk,
    choosing the highest resolution '_(NNNN).dds' variant"""

    def __init__(self, roots):
        self.index = {}
        for root in roots:
            if not os.path.isdir(root):
                continue
            for dp, _, files in os.walk(root):
                for f in files:
                    stem, ext = os.path.splitext(f)
                    ext = ext.lower()
                    if ext not in ('.dds', '.tga', '.png', '.bmp', '.jpg'):
                        continue
                    res = 1 << 20 if ext != '.dds' else 0
                    mm = re.match(r'^(.*)_\((\d+)\)$', stem)
                    if mm:
                        stem, res = mm.group(1), int(mm.group(2))
                    rel = os.path.relpath(os.path.join(dp, stem), root).replace('\\', '/').lower()
                    key = rel
                    prev = self.index.get(key)
                    if prev is None or (prev[0] == root and res > prev[1]):
                        # first root wins (mods first), inside a root prefer biggest
                        if prev is None or prev[0] == root:
                            self.index[key] = (root, res, os.path.join(dp, f))
                    base = key.rsplit('/', 1)[-1]
                    if ('#' + base) not in self.index:
                        self.index['#' + base] = (root, res, os.path.join(dp, f))
        self.cache = {}

    def find(self, name):
        if not name:
            return None
        key = os.path.splitext(name.replace('\\', '/').lower())[0]
        key = re.sub(r'_\(\d+\)$', '', key)
        hit = self.index.get(key) or self.index.get('#' + key.rsplit('/', 1)[-1])
        return hit[2] if hit else None

    def png(self, name, normal_map=False):
        path = self.find(name)
        if path is None or Image is None:
            return None
        ck = (path, normal_map)
        if ck in self.cache:
            return self.cache[ck]
        try:
            im = Image.open(path)
            im.load()
            if im.mode not in ('RGB', 'RGBA'):
                im = im.convert('RGBA')
            if normal_map:
                im = fix_normal_map(im)
            elif im.mode == 'RGBA':
                a = np.asarray(im)[:, :, 3]
                if a.min() >= 250:
                    im = im.convert('RGB')
            has_alpha = im.mode == 'RGBA'
            bio = io.BytesIO()
            if has_alpha or normal_map:
                im.save(bio, 'PNG', optimize=False)
                mime, ext = 'image/png', '.png'
            else:
                im.save(bio, 'JPEG', quality=92)
                mime, ext = 'image/jpeg', '.jpg'
            data = bio.getvalue()
            stem = re.sub(r'_\(\d+\)$', '', os.path.splitext(os.path.basename(path))[0]).lower()
            fname = safe(stem + ('_normal' if normal_map else '')) + ext
        except Exception as e:  # unsupported/corrupt texture
            print('   ! texture %s: %s' % (path, e))
            data = None
        self.cache[ck] = (data, has_alpha, fname, mime) if data else None
        return self.cache[ck]


def fix_normal_map(im):
    """DXT5nm style maps store X in alpha and Y in green; rebuild a standard RGB normal map"""
    a = np.asarray(im.convert('RGBA')).astype(np.float64) / 255.0
    r_, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    if al.std() > 0.02 and r_.std() < 0.02:  # xGxR swizzle
        x, y = al * 2 - 1, g * 2 - 1
    else:
        x, y = r_ * 2 - 1, g * 2 - 1
    y = -y  # DirectX (Y-down) -> glTF/OpenGL (Y-up) convention
    z = np.sqrt(np.clip(1 - x * x - y * y, 0, 1))
    out = np.stack([x, y, z], -1) * 0.5 + 0.5
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGB')


# =========================================================================== glTF writer
class GLTF:
    def __init__(self):
        self.j = dict(asset=dict(version='2.0', generator='paraworld_gsf.py'), scene=0, scenes=[dict(nodes=[])],
                      nodes=[], meshes=[], accessors=[], bufferViews=[], buffers=[])
        self.bin = bytearray()
        self.tex_cache = {}

    def _view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        self.bin += data
        bv = dict(buffer=0, byteOffset=off, byteLength=len(data))
        if target:
            bv['target'] = target
        self.j['bufferViews'].append(bv)
        return len(self.j['bufferViews']) - 1

    def accessor(self, arr, ctype, typ, target=None, minmax=False, normalized=False):
        dt = {5126: '<f4', 5123: '<u2', 5125: '<u4', 5121: 'u1', 5122: '<i2'}[ctype]
        arr = np.ascontiguousarray(arr, dtype=dt)
        bv = self._view(arr.tobytes(), target)
        a = dict(bufferView=bv, componentType=ctype, count=int(arr.shape[0]), type=typ)
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = [float(x) for x in arr.reshape(arr.shape[0], -1).min(0)]
            a['max'] = [float(x) for x in arr.reshape(arr.shape[0], -1).max(0)]
        self.j['accessors'].append(a)
        return len(self.j['accessors']) - 1

    def node(self, **kw):
        self.j['nodes'].append({k: v for k, v in kw.items() if v is not None})
        return len(self.j['nodes']) - 1

    def add_child(self, parent, child):
        self.j['nodes'][parent].setdefault('children', []).append(child)

    def image(self, tex, tex_dir=None):
        data, _, fname, mime = tex
        key = fname
        if key in self.tex_cache:
            return self.tex_cache[key]
        if tex_dir:
            os.makedirs(tex_dir, exist_ok=True)
            fp = os.path.join(tex_dir, fname)
            if not os.path.exists(fp):
                with open(fp, 'wb') as f:
                    f.write(data)
            self.j.setdefault('images', []).append(dict(uri=os.path.basename(tex_dir) + '/' + fname, name=fname))
        else:
            bv = self._view(data)
            self.j.setdefault('images', []).append(dict(bufferView=bv, mimeType=mime, name=fname))
        self.j.setdefault('samplers', [dict(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)])
        self.j.setdefault('textures', []).append(dict(source=len(self.j['images']) - 1, sampler=0))
        idx = len(self.j['textures']) - 1
        self.tex_cache[key] = idx
        return idx

    def save(self, path):
        j = {k: v for k, v in self.j.items() if v != [] or k in ('nodes',)}
        while len(self.bin) % 4:
            self.bin.append(0)
        j['buffers'] = [dict(byteLength=len(self.bin))]
        js = json.dumps(j, separators=(',', ':')).encode()
        while len(js) % 4:
            js += b' '
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(self.bin)))
            f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942)); f.write(self.bin)


# =========================================================================== export
ZUP_TO_YUP = [-math.sqrt(0.5), 0.0, 0.0, math.sqrt(0.5)]  # -90 deg about X


def safe(s):
    return re.sub(r'[^A-Za-z0-9_.\-]+', '_', s).strip('_') or 'unnamed'


def export_model(r, h, model, mats, names, texfinder, out_path, fps=25.0, all_lods=False, log=print, reduce_keys=False, skip_anims=None,
                 all_parts=False, billboards=True, quantize=True, tex_dir=None, sounds=None, walksets=None):
    g = GLTF()
    root = g.node(name=model['name'], rotation=ZUP_TO_YUP)
    g.j['scenes'][0]['nodes'].append(root)

    chunks = [(i, c, r.u32(c)) for i, c in enumerate(model['chunks']) if c is not None]
    skels = []
    skel_chunk = []
    for ci, c, t in chunks:
        if t == 5:
            try:
                skels.append(parse_skeleton(r, c))
                skel_chunk.append(ci)
            except Exception as e:
                log('   ! skeleton: %s' % e)

    # ---------------------------------------------------------------- armatures
    rigs = []
    for si, sk in enumerate(skels):
        bones = sk['bones']
        dfs = sk['dfs']
        suffix = '' if len(skels) == 1 else '_%d' % si
        node_of = {}
        world = {}
        for bi in dfs:
            b = bones[bi]
            q = qnorm(qconj(b['quat']))
            n = g.node(name='bone_%08x' % b['guid'] if b['guid'] != 0x16F4F95B else 'root' + suffix,
                       translation=[float(x) for x in b['pos']], rotation=[float(x) for x in q])
            node_of[bi] = n
            L = np.eye(4); L[:3, :3] = qmat(q); L[:3, 3] = b['pos']
            world[bi] = L if b['parent'] < 0 else world[b['parent']] @ L
            g.add_child(root if b['parent'] < 0 else node_of[b['parent']], n)
        joints = [node_of[bi] for bi in dfs]
        if sk['bind'] is not None and len(sk['bind']) == len(dfs):
            ibm = [B.T for B in sk['bind']]
        else:
            ibm = [np.linalg.inv(world[bi]) for bi in dfs]
        ibm_acc = g.accessor(np.array([m.T.reshape(-1) for m in ibm]), 5126, 'MAT4')
        g.j.setdefault('skins', []).append(dict(joints=joints, inverseBindMatrices=ibm_acc, skeleton=node_of[dfs[0]],
                                                 name='skeleton' + suffix))
        rigs.append(dict(skin=len(g.j['skins']) - 1, node_of=node_of, sk=sk, chunk=skel_chunk[si],
                         world_bind=[np.linalg.inv(m) for m in ibm]))

    # ---------------------------------------------------------------- materials
    mat_cache = {}

    def material(gi):
        if gi in mat_cache:
            return mat_cache[gi]
        md = mats[gi] if 0 <= gi < len(mats) else dict(tex=None, nm=None, attr1=0)
        pbr = dict(metallicFactor=0.0, roughnessFactor=0.9)
        m = dict(name=safe(os.path.splitext(os.path.basename(md['tex'] or 'material_%d' % gi))[0]),
                 pbrMetallicRoughness=pbr)
        alpha = md['attr1'] & 0xF
        tx = texfinder.png(md['tex']) if texfinder else None
        if tx:
            pbr['baseColorTexture'] = dict(index=g.image(tx, tex_dir))
            if tx[1] and alpha in (1, 3, 5, 0xB, 0xD, 0xF):
                m['alphaMode'] = 'MASK'; m['alphaCutoff'] = 0.5; m['doubleSided'] = True
            elif tx[1] and alpha in (2, 6, 7, 0xA, 0xE):
                m['alphaMode'] = 'BLEND'; m['doubleSided'] = True
        elif md['tex']:
            m['extras'] = dict(missing_texture=md['tex'])
        if texfinder and md.get('nm'):
            nt = texfinder.png(md['nm'], normal_map=True)
            if nt:
                m['normalTexture'] = dict(index=g.image(nt, tex_dir))
        m.setdefault('extras', {}).update(gsf_texture=md['tex'] or '', gsf_flags='%08x/%08x' % (md['attr1'], md.get('attr2', 0)))
        g.j.setdefault('materials', []).append(m)
        mat_cache[gi] = len(g.j['materials']) - 1
        return mat_cache[gi]

    # ---------------------------------------------------------------- meshes
    model_ctx = dict(ages=set())
    for _, c, t in chunks:
        if t in MESH_TYPES:
            a = r.u32(c + 4)
            model_ctx['ages'] |= {i for i in (10, 11, 12, 13, 14) if a & BIT(i)}
    if not all_parts:
        # models such as '*_dest' wrecks consist only of damage-state parts: then keep all of them
        lod0 = [r.u32(c + 4) for _, c, t in chunks if t in MESH_TYPES and (not r.u32(c + 4) & 0x1F or r.u32(c + 4) & 1)]
        if lod0 and not any(default_visible(model['fourcc'], a, model_ctx) for a in lod0):
            model_ctx['relaxed'] = True
    nmesh = 0
    obj_nodes = {}
    kit = []
    for ci, c, t in chunks:
        if t not in MESH_TYPES:
            continue
        try:
            me = parse_mesh(r, c)
        except Exception as e:
            log('   ! mesh chunk %d: %s' % (ci, e))
            continue
        lodmask = me['attr'] & 0x1F
        if not all_lods and lodmask and not (lodmask & 1):
            continue
        if not all_parts and not default_visible(model['fourcc'], me['attr'], model_ctx):
            continue
        rig = rigs[me['skel']] if me['skinned'] and me['skel'] < len(rigs) else None
        M = me['matrix'].T  # row-major D3D -> column
        prims = []
        for s in me['subs']:
            v = s['v']
            pos, nrm = v['pos'], v['nrm']
            if not np.allclose(M, np.eye(4), atol=1e-6):
                if rig is not None:  # bake the chunk transform, skinning happens in model space
                    pos = pos @ M[:3, :3].T + M[:3, 3]
                    nrm = nrm @ np.linalg.inv(M[:3, :3])
            nrm = nrm / np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
            attrs = dict(POSITION=g.accessor(pos, 5126, 'VEC3', 34962, minmax=True),
                         NORMAL=g.accessor(nrm, 5126, 'VEC3', 34962),
                         TEXCOORD_0=g.accessor(v['uv'], 5126, 'VEC2', 34962))
            if rig is not None:
                nb = len(rig['sk']['dfs'])
                if 'bidx' in v and not me.get('cbidx'):
                    bi, bw = v['bidx'].copy(), v['bw'].copy()
                else:
                    bi = np.tile(np.array(me.get('cbidx', [0, 255, 255, 255])), (len(pos), 1))
                    bw = np.tile(np.array(me.get('cbw', [255, 0, 0, 0]), dtype=np.float64), (len(pos), 1))
                bad = (bi == 255) | (bi >= nb)
                bw[bad] = 0
                bi = np.where(bad, 0, bi)
                sw = bw.sum(1, keepdims=True)
                bw = np.where(sw > 0, bw / np.maximum(sw, 1e-9), np.array([1.0, 0, 0, 0]))
                bi = np.where(sw > 0, bi, np.array([0, 0, 0, 0]))
                attrs['JOINTS_0'] = g.accessor(bi, 5123, 'VEC4', 34962)
                attrs['WEIGHTS_0'] = g.accessor(bw, 5126, 'VEC4', 34962)
            gi = model['used_materials'][s['mat']] if s['mat'] < len(model['used_materials']) else s['mat']
            prim = dict(attributes=attrs, indices=g.accessor(s['tris'].reshape(-1), 5123 if len(pos) < 65536 else 5125, 'SCALAR', 34963),
                        material=material(gi))
            prims.append(prim)
        if not prims:
            continue
        name = '%s_%s%d_lod%x_f%x' % (model['name'], me['kind'], ci, lodmask, me['attr'] >> 5)
        g.j['meshes'].append(dict(name=name, primitives=prims))
        mi = len(g.j['meshes']) - 1
        if rig is not None:
            n = g.node(name=name, mesh=mi, skin=rig['skin'])
        else:
            t_, q_, s_ = decompose(M)
            n = g.node(name=name, mesh=mi,
                       translation=[float(x) for x in t_] if np.abs(t_).max() > 1e-9 else None,
                       rotation=[float(x) for x in q_] if abs(q_[3]) < 1 - 1e-9 else None,
                       scale=[float(x) for x in s_] if np.abs(s_ - 1).max() > 1e-6 else None)
            obj_nodes[ci] = (n, t_, q_, s_)
            kit.append((n, t_, float(np.hypot(me['bbox'][3] - me['bbox'][0], me['bbox'][4] - me['bbox'][1]))))
        g.j['nodes'][n]['extras'] = dict(attr=int(me['attr']), kind=me['kind'])
        g.add_child(root, n)
        nmesh += 1

    # wall models are construction kits (straight pieces, corners, ends, different heights) that the game
    # picks from; lay the pieces out side by side instead of stacking them all at the origin
    if (model['fourcc'].strip().lower() == 'wall' and len(kit) > 6 and not all_parts and not rigs
            and not any(any(c for c, _ in e) for e in model['anims']) and 'gate' not in model['name'].lower()):
        step = max(k[2] for k in kit) + 2.0
        cols = int(math.ceil(math.sqrt(len(kit))))
        for i, (n, t_, _) in enumerate(kit):
            off = np.array([(i % cols) * step, (i // cols) * step, 0.0])
            g.j['nodes'][n]['translation'] = [float(x) for x in (t_ + off)]
        g.j['nodes'][root].setdefault('extras', {})['note'] = 'wall construction kit: pieces laid out in a grid'

    # ---------------------------------------------------------------- billboards (foliage sprites)
    mesh_mats = set()
    for _, c, t in chunks:
        if t in MESH_TYPES:
            try:
                mesh_mats |= {sb['mat'] for sb in parse_mesh(r, c)['subs']}
            except Exception:
                pass
    bb_mat = None
    cand = [k for k in range(len(model['used_materials'])) if k not in mesh_mats] or list(range(len(model['used_materials'])))
    for k in cand:
        gi = model['used_materials'][k]
        if 0 <= gi < len(mats) and mats[gi]['attr1'] & 0xF in (1, 2, 3, 5, 6, 7, 0xB, 0xD, 0xE, 0xF):
            bb_mat = gi
            break
    if bb_mat is None and cand:
        bb_mat = model['used_materials'][cand[0]]
    for ci, c, t in chunks:
        if t not in (1, 0x80000001) or not billboards:
            continue
        if not all_parts and model['fourcc'].strip().lower() not in ('vgtn', 'ress', 'deko', 'misc'):
            continue  # buildings use sprites for effects (smoke, sparks); only foliage is converted by default
        try:
            b = parse_billboard(r, c)
        except Exception as e:
            log('   ! billboard chunk %d: %s' % (ci, e))
            continue
        if b is None:
            continue
        lodmask = b['attr'] & 0x1F
        if not all_lods and lodmask and not (lodmask & 1):
            continue
        if not all_parts and not default_visible(model['fourcc'], b['attr'], model_ctx):
            continue
        P, N, UV, T = billboard_geometry(b)
        if not len(T):
            continue
        attrs = dict(POSITION=g.accessor(P, 5126, 'VEC3', 34962, minmax=True),
                     NORMAL=g.accessor(N, 5126, 'VEC3', 34962),
                     TEXCOORD_0=g.accessor(UV, 5126, 'VEC2', 34962))
        rig = rigs[0] if (b['skinned'] and rigs) else None
        if rig is not None:
            nb = len(rig['sk']['dfs'])
            per = len(P) // max(1, len(b['pos']))
            if 'bone' in b and len(b['bone']) and b['bone'].max() < nb:
                jj = np.repeat(b['bone'], per)                 # every sprite on its own bone
            else:   # attach rigidly to the bone closest to the sprite cloud centre
                centre = b['matrix'].T[:3, 3]
                wb = rig['world_bind']
                jj = np.full(len(P), int(np.argmin([np.linalg.norm(w[:3, 3] - centre) for w in wb])))
            J4 = np.zeros((len(P), 4), dtype=np.int64); J4[:, 0] = jj
            attrs['JOINTS_0'] = g.accessor(J4, 5123, 'VEC4', 34962)
            attrs['WEIGHTS_0'] = g.accessor(np.tile([1.0, 0, 0, 0], (len(P), 1)), 5126, 'VEC4', 34962)
        um_ = model['used_materials']
        gi_ = um_[b['mat']] if b.get('mat', 99999) < len(um_) else bb_mat     # the chunk's own material (fallback: guess)
        mi_ = material(gi_ if gi_ is not None else -1)
        mat_j = g.j['materials'][mi_]
        mat_j['doubleSided'] = True
        if 'alphaMode' not in mat_j and 'baseColorTexture' in mat_j['pbrMetallicRoughness']:
            mat_j['alphaMode'] = 'MASK'; mat_j['alphaCutoff'] = 0.5
        name = '%s_foliage%d_lod%x' % (model['name'], ci, lodmask)
        # raw sprite data for engines that draw real camera-facing sprites (stored in the root node's extras)
        try:
            M_ = b['matrix'].T
            cen = b['pos'] @ M_[:3, :3].T + M_[:3, 3]
            uvr = [round(x, 6) for x in b['uv']]
            pbr_ = mat_j.get('pbrMetallicRoughness', {})
            uri_ = None
            if 'baseColorTexture' in pbr_:
                src_ = g.j['textures'][pbr_['baseColorTexture']['index']]['source']
                uri_ = g.j['images'][src_].get('uri')
            ex = g.j['nodes'][root].setdefault('extras', {})
            fe = dict(mesh=name, tex=uri_, size=round(float(b['size']), 4), uv=uvr,
                                                     skinned=bool(b['skinned']), attr=int(b['attr']),
                                                     pts=[round(float(v), 3) for v in cen.reshape(-1)])
            if rig is not None and 'bone' in b and len(b['bone']) and b['bone'].max() < len(rig['sk']['dfs']):
                fe['bones'] = [int(x) for x in b['bone']]       # joint index of every sprite (skin joints order)
            ex.setdefault('foliage', []).append(fe)
        except Exception as e:
            log('   ! foliage extras: %s' % e)
        g.j['meshes'].append(dict(name=name, primitives=[dict(
            attributes=attrs, material=mi_,
            indices=g.accessor(T.reshape(-1), 5123 if len(P) < 65536 else 5125, 'SCALAR', 34963))]))
        n = g.node(name=name, mesh=len(g.j['meshes']) - 1, skin=rig['skin'] if rig is not None else None)
        g.j['nodes'][n]['extras'] = dict(attr=int(b['attr']), kind='foliage')   # (was the last mesh's flags)
        g.add_child(root, n)
        nmesh += 1

    # ---------------------------------------------------------------- attachment points
    for _, c, t in chunks:
        if t not in (0xB, 0x8000000B):
            continue
        try:
            L = parse_link(r, c)
        except Exception:
            continue
        q = qnorm(qconj(L['quat']))
        Mw = np.eye(4); Mw[:3, :3] = qmat(q); Mw[:3, 3] = L['pos']
        parent = root
        if t == 0x8000000B and L['skel'] < len(rigs):
            rig = rigs[L['skel']]
            k = int(np.argmax(L['bw']))
            bi = L['bidx'][k]
            if bi != 255 and bi < len(rig['sk']['dfs']):
                parent = rig['node_of'][rig['sk']['dfs'][bi]]
                Mw = np.linalg.inv(rig['world_bind'][bi]) @ Mw
        t_, q_, _ = decompose(Mw)
        n = g.node(name='link_' + safe(L['name']), translation=[float(x) for x in t_], rotation=[float(x) for x in q_])
        g.add_child(parent, n)

    # ---------------------------------------------------------------- animations
    nanim = 0
    if skip_anims:
        g.j['nodes'][root].setdefault('extras', {})['animations_in'] = skip_anims
    for ak, entries in enumerate(model['anims'] if not skip_anims else []):
        aname = names.get(ak, 'anim_%d' % ak)
        channels, samplers = [], []
        marks = {}                  # frames / loop part / speed of the clip (from its first skeletal chunk)

        const_times = {}
        g_times_cache = {}

        def chan(node, path, times, values, typ):
            values = np.asarray(values, dtype=np.float64)
            if len(values) > 2 and np.abs(values - values[0]).max() < 1e-5:
                # constant channel -> 2 keys spanning the same duration
                tmax = g.j['accessors'][times]['max'][0]
                if tmax not in const_times:
                    const_times[tmax] = g.accessor(np.array([0.0, tmax]), 5126, 'SCALAR', minmax=True)
                times, values = const_times[tmax], values[:2]
            elif len(values) > 2 and reduce_keys:
                keep = reduce_keyframes(values, 4e-4 if path == 'rotation' else 2e-4)
                if len(keep) < len(values) * 0.8:
                    tv = np.array(g_times_cache[times])[keep]
                    times, values = g.accessor(tv, 5126, 'SCALAR', minmax=True), values[keep]
            if path == 'rotation' and quantize:
                # normalized int16 quaternions (core glTF 2.0; Blender and three.js decode them)
                qv = np.round(np.clip(qnorm(values), -1, 1) * 32767).astype(np.int16)
                out = g.accessor(qv, 5122, typ, normalized=True)
            else:
                out = g.accessor(values, 5126, typ)
            samplers.append(dict(input=times, output=out, interpolation='LINEAR'))
            channels.append(dict(sampler=len(samplers) - 1, target=dict(node=node, path=path)))

        rig_of_chunk = {x['chunk']: x for x in rigs}
        for ej, (ac, nf) in enumerate(entries):
            if ac is None:
                continue
            at = r.u32(ac)
            if at == 0x40000003 and ej in obj_nodes:
                try:
                    o = parse_obj_anim(r, ac)
                except Exception as e:
                    log('   ! object anim %s: %s' % (aname, e))
                    continue
                if o is None:
                    continue
                n, t0, q0, s0 = obj_nodes[ej]
                tt = np.arange(max(len(o['t']), 2), dtype=np.float64) / fps
                times = g.accessor(tt, 5126, 'SCALAR', minmax=True)
                g_times_cache[times] = tt
                pad2 = (lambda x: np.concatenate([x, x[-1:]], 0) if len(x) == 1 else x)
                chan(n, 'translation', times, pad2(o['t']), 'VEC3')
                chan(n, 'rotation', times, pad2(o['q']), 'VEC4')
                if o.get('s') is not None:
                    chan(n, 'scale', times, pad2(o['s']), 'VEC3')
                continue
            if at != 0x40000005:
                continue
            rig = rig_of_chunk.get(ej) or (rigs[0] if len(rigs) == 1 else None)
            if rig is None:
                continue
            try:
                a = parse_anim(r, ac)
            except Exception as e:
                log('   ! anim %s: %s' % (aname, e))
                continue
            nf = a['nframes']
            if nf == 0:
                continue
            if not marks:
                marks['frames'] = int(nf)
                if a.get('loop'):
                    marks['loop'] = [int(a['loop'][0]), int(a['loop'][1])]
                if a.get('speed'):
                    marks['speed'] = a['speed']
            bones, dfs = rig['sk']['bones'], rig['sk']['dfs']
            tt = np.arange(max(nf, 2), dtype=np.float64) / fps
            times = g.accessor(tt, 5126, 'SCALAR', minmax=True)
            g_times_cache[times] = tt

            def pad(x):
                return np.concatenate([x, x[-1:]], 0) if nf == 1 else x
            done = set()
            if a['root'] is not None:
                # root 'helper' track = delta on the skeleton root bone (rotation in bone space,
                # translation offset in model space)
                hb = a.get('helper_bone', 0)
                hb = hb if hb < len(dfs) else 0
                b0 = dfs[hb]
                rest = qnorm(qconj(bones[b0]['quat']))
                q = qnorm(qmul(np.broadcast_to(rest, a['root']['q'].shape), qconj(a['root']['q'])))
                for k in range(1, len(q)):
                    if np.dot(q[k], q[k - 1]) < 0:
                        q[k] = -q[k]
                chan(rig['node_of'][b0], 'rotation', times, pad(q), 'VEC4')
                if a['root']['t'] is not None:
                    chan(rig['node_of'][b0], 'translation', times, pad(a['root']['t'] + np.array(bones[b0]['pos'])), 'VEC3')
                if a['root']['s'] is not None and np.abs(a['root']['s']).min() > 1e-6:
                    chan(rig['node_of'][b0], 'scale', times, pad(a['root']['s']), 'VEC3')
                done.add(hb)
            for tr in a['tracks']:
                if tr['bone'] >= len(dfs) or tr['bone'] in done:
                    continue
                done.add(tr['bone'])
                bi = dfs[tr['bone']]
                b = bones[bi]
                rest = qnorm(qconj(b['quat']))
                q = qnorm(qmul(np.broadcast_to(rest, tr['q'].shape), qconj(tr['q'])))
                # keep quaternion signs continuous
                for k in range(1, len(q)):
                    if np.dot(q[k], q[k - 1]) < 0:
                        q[k] = -q[k]
                node = rig['node_of'][bi]
                chan(node, 'rotation', times, pad(q), 'VEC4')
                if 'dx' in tr:
                    tp = np.tile(np.array(b['pos']), (nf, 1))
                    tp[:, 0] += tr['dx']
                    chan(node, 'translation', times, pad(tp), 'VEC3')
                if 's' in tr and np.abs(tr['s']).min() > 1e-6:
                    chan(node, 'scale', times, pad(tr['s']), 'VEC3')
            # hold rest pose on bones without a track, so actions don't leak into each other
            for k, bi in enumerate(dfs):
                if k in done:
                    continue
                b = bones[bi]
                rest = qnorm(qconj(b['quat']))
                chan(rig['node_of'][bi], 'rotation', times, np.array([rest, rest, rest]), 'VEC4')
        if channels:
            g.j.setdefault('animations', []).append(dict(name=aname, channels=channels, samplers=samplers))
            if marks:
                # extras: frames, loop = [first, last] frame of the loop part (start = 0..first, end = last..), speed
                g.j['animations'][-1]['extras'] = dict(marks, fps=fps)
            nanim += 1

    if sounds and not skip_anims:
        out = {}
        for ai, lst in sounds.items():
            an = names.get(ai)
            if not an:
                continue
            ev = [[round(x['frame'] / fps, 4), x['wav'], x['vol'], round(x['maxhear'], 1), x['group']] for x in lst if x['wav'] or x['group']]
            if ev:
                out[an] = ev
        if out:
            g.j['nodes'][root].setdefault('extras', {})['sounds'] = out
    if walksets:
        # compact: {set: {slot: anim}} (only filled slots)
        g.j['nodes'][root].setdefault('extras', {})['walksets'] = {k: {str(i): a for i, a in enumerate(v) if a}
                                                                  for k, v in walksets.items()}
    if all_parts:
        g.j['nodes'][root].setdefault('extras', {})['all_parts'] = True
    if model.get('pf'):
        g.j['nodes'][root].setdefault('extras', {})['pf'] = model['pf']
    g.j['nodes'][root].setdefault('extras', {})['fourcc'] = model['fourcc'].strip()
    if nmesh == 0 and not rigs:
        return None
    g.save(out_path)
    return dict(meshes=nmesh, skeletons=len(rigs), bones=sum(len(x['sk']['dfs']) for x in rigs), anims=nanim)


# =========================================================================== driver
def guess_data_dir(gsf_path):
    p = os.path.abspath(gsf_path)
    parts = p.replace('\\', '/').split('/')
    for i in range(len(parts) - 1, 0, -1):
        if parts[i].lower() == 'data':
            return '/'.join(parts[:i + 1]), (parts[i + 1] if i + 1 < len(parts) else None)
    return None, None


def texture_roots(data_dir, mod):
    roots = []
    if not data_dir or not os.path.isdir(data_dir):
        return roots
    subs = {d.lower(): d for d in os.listdir(data_dir)}
    order = []
    if mod:
        order.append(mod)
    order += ['Base', 'BoosterPack1', 'BoosterPack3', 'MIRAGE', 'Wintermod', 'ReColor']
    for mname in order:
        d = subs.get(mname.lower())
        if d:
            t = os.path.join(data_dir, d, 'Texture')
            if os.path.isdir(t) and t not in roots:
                roots.append(t)
    return roots


class Archive:
    """One .gsf archive, parsed once (the table of contents is cheap; model data is decoded on export).

        a = Archive(path)
        a.names()                -> ['allosaurus', 'allosaurus_dest', ...]
        a.info(name)             -> {'name', 'fourcc', 'anims': [...], 'bbox', ...}
        a.anim_names(name)       -> ['walk_1', 'standanim', ...]
        a.export(name, out_glb, data_dir=None, **options) -> {'meshes', 'bones', 'anims', ...} or None
    """

    def __init__(self, path):
        self.path = path
        with open(path, 'rb') as f:
            data = f.read()
        if data[:4] != b'GSF\0':
            raise ValueError('not a GSF archive: %s' % path)
        self.r = R(data)
        self.h = parse_header2(self.r)
        self.mats = parse_materials(self.r, self.h)
        self.infos = parse_model_infos(self.r, self.h)
        try:
            h1 = parse_header1(self.r)
        except Exception:
            h1 = []
        self._anim_names, self._sounds, self._walksets = {}, {}, {}
        for m in h1:
            if m.get('walksets'):
                self._walksets[m['index']] = m['walksets']
            d = {}
            for an, ai in m['anims']:
                d.setdefault(ai, an)
            self._anim_names[m['index']] = d
            table = m.get('sounds') or []
            self._sounds[m['index']] = {ai: [table[k] for k in refs if k < len(table)]
                                        for ai, refs in m.get('sound_refs', {}).items() if refs}
        self._by_name = {}
        for i, m in enumerate(self.infos):
            self._by_name.setdefault(m['name'].lower(), i)
        self.data_dir, self.mod = guess_data_dir(path)

    @property
    def base(self):
        return os.path.splitext(os.path.basename(self.path))[0]

    def names(self):
        return [m['name'] for m in self.infos]

    def index(self, name):
        return self._by_name.get(name.lower())

    def info(self, name):
        i = self.index(name)
        return None if i is None else self.infos[i]

    def anim_names(self, name):
        """names of the animations stored with a model, in archive order"""
        i = self.index(name)
        if i is None:
            return []
        names = self._anim_names.get(i, {})
        return [names.get(k, 'anim_%d' % k) for k, e in enumerate(self.infos[i]['anims']) if any(c for c, _ in e)]

    def anim_names_index(self, i):
        names = self._anim_names.get(i, {})
        return [names.get(k, 'anim_%d' % k) for k, e in enumerate(self.infos[i]['anims']) if any(c for c, _ in e)]

    def anim_signature(self, i):
        """(animation chunks, bone guids) - models with equal signatures have identical animations"""
        m = self.infos[i]
        sig = tuple(tuple(c for c, _ in e) for e in m['anims'])
        try:
            bones = tuple(tuple(b['guid'] for b in parse_skeleton(self.r, c)['bones'])
                          for c in m['chunks'] if c is not None and self.r.u32(c) == 5)
        except Exception:
            bones = None
        return sig, bones

    def export(self, name, out_path, data_dir=None, textures=True, finders={}, fps=25.0, all_lods=False,
               all_parts=False, embed_textures=False, tex_dir=None, reduce_keys=False, skip_anims=None, log=print):
        """write one model as .glb. Textures go into `tex_dir` (default: <out folder>/textures) unless
        embed_textures. all_parts keeps every LOD0 part (saddles, damage stages, ...) with its flags in the
        node extras ("attr") - the Model Exporter uses that to toggle them."""
        i = self.index(name)
        if i is None:
            raise KeyError('%s has no model %r' % (self.path, name))
        return self.export_index(i, out_path, data_dir, textures, finders, fps, all_lods, all_parts, embed_textures,
                                 tex_dir, reduce_keys, skip_anims, log)

    def export_index(self, i, out_path, data_dir=None, textures=True, finders={}, fps=25.0, all_lods=False,
                     all_parts=False, embed_textures=False, tex_dir=None, reduce_keys=False, skip_anims=None, log=print):
        """like export(), by position in the archive (archives may hold two models with the same name)"""
        finder = None
        if textures and Image is not None:
            dd = data_dir or self.data_dir
            key = (dd, self.mod)
            if key not in finders:
                finders[key] = TextureFinder(texture_roots(dd, self.mod))
            finder = finders[key]
        if not embed_textures and tex_dir is None:
            tex_dir = os.path.join(os.path.dirname(os.path.abspath(out_path)), 'textures')
        return export_model(self.r, self.h, self.infos[i], self.mats, self._anim_names.get(i, {}), finder, out_path,
                            fps=fps, all_lods=all_lods, sounds=self._sounds.get(i, {}), reduce_keys=reduce_keys,
                            skip_anims=skip_anims, all_parts=all_parts, tex_dir=None if embed_textures else tex_dir, log=log,
                            walksets=self._walksets.get(i))

    def walksets(self, name):
        """{'def': [42 slot animation names or None], 'defn': [...], ...}"""
        i = self.index(name)
        return self._walksets.get(i, {}) if i is not None else {}


def convert_file(path, outdir, data_dir=None, fps=25.0, all_lods=False, textures=True, only=None, finders={},
                 share_anims=True, reduce_keys=False, all_parts=False, embed_textures=False, log=print):
    """convert every model of an archive (or the `only` ones) into <outdir>/<archive>/<model>.glb"""
    try:
        a = Archive(path)
    except ValueError:
        log('skip (not a GSF): %s' % path)
        return []
    od = os.path.join(outdir, a.base)
    os.makedirs(od, exist_ok=True)
    results = []
    used = set()
    anim_owner = {}
    for i, m in enumerate(a.infos):
        if only and m['name'].lower() not in only:
            continue
        fn = safe(m['name'])
        while fn.lower() in used:
            fn += '_'
        used.add(fn.lower())
        outp = os.path.join(od, fn + '.glb')
        sig = a.anim_signature(i)
        skip = None
        if share_anims and any(any(x) for x in sig[0]):
            if sig in anim_owner:
                skip = anim_owner[sig]
            else:
                anim_owner[sig] = fn + '.glb'
        try:
            res = a.export_index(i, outp, data_dir=data_dir, textures=textures, finders=finders, fps=fps, all_lods=all_lods,
                                 all_parts=all_parts, embed_textures=embed_textures, tex_dir=os.path.join(od, 'textures'),
                                 reduce_keys=reduce_keys, skip_anims=skip)
        except Exception as e:
            log('  ! %s/%s failed: %s' % (a.base, m['name'], e))
            continue
        if res:
            res['anims_in'] = skip
            log('  %-40s %-5s meshes=%d bones=%d anims=%d%s' % (m['name'], m['fourcc'], res['meshes'], res['bones'], res['anims'],
                                                                 '  (same animations as %s)' % skip if skip else ''))
            results.append((a.base, m['name'], m['fourcc'], res))
    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('inputs', nargs='+')
    ap.add_argument('-o', '--out', default='paraworld_gltf')
    ap.add_argument('--data', default=None, help='game Data folder (for textures)')
    ap.add_argument('--fps', type=float, default=30.0, help='playback rate of the game animations (default 30, 3ds Max default)')
    ap.add_argument('--all-lods', action='store_true', help='also export the lower detail LOD meshes')
    ap.add_argument('--no-textures', action='store_true')
    ap.add_argument('--embed-textures', action='store_true',
                    help='store textures inside every .glb (self-contained files, but much bigger) instead of '
                         'one shared "textures" folder per archive')
    ap.add_argument('--all-parts', action='store_true',
                    help='keep every LOD0 part: construction/damage stages, night lights, saddles/armour of tamed '
                         'animals, resource stages, shadow & selection helpers (objects are named with their flags)')
    ap.add_argument('--only', default=None, help='comma separated model names')
    ap.add_argument('--all-anims', action='store_true',
                    help='write animations into every model (by default variants that share the exact same '
                         'animation set only get the rig, and point to the first model that has them)')
    ap.add_argument('--reduce-keys', action='store_true', help='drop redundant animation keys (smaller, slower)')
    a = ap.parse_args()
    only = set(x.strip().lower() for x in a.only.split(',')) if a.only else None
    files = []
    for p in a.inputs:
        if os.path.isdir(p):
            for dp, _, fs in os.walk(p):
                files += [os.path.join(dp, f) for f in sorted(fs) if f.lower().endswith('.gsf')]
        else:
            files.append(p)
    total = []
    for f in files:
        print(f)
        total += convert_file(f, a.out, a.data, a.fps, a.all_lods, not a.no_textures, only,
                              share_anims=not a.all_anims, reduce_keys=a.reduce_keys, all_parts=a.all_parts,
                              embed_textures=a.embed_textures)
    print('done: %d models written to %s' % (len(total), a.out))


if __name__ == '__main__':
    main()
