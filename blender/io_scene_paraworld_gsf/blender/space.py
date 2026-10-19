"""Conversion between GSF space and Blender space.

GSF data is Direct3D style: row vectors (matrices are stored row by row with the translation in the 4th row) and
quaternions that rotate the other way round (use the conjugate with column vectors). The game's space is LEFT-handed
(x east, y south, z up). Blender is right-handed, so the add-on mirrors one axis on import and back on export
(default: x, as the ParaWorld Toolkit's glTF files do). Without the mirror a model looks mirrored (right hand links
on the left side).

    Blender matrix = S @ G @ S        G = the GSF transform as a column-vector matrix, S = the mirror
    Blender point  = S @ p

Bones additionally get an axis change (GSF bones run along x, Blender bones along y) and, for bones that the game
mirrors (rest scale -1 -1 -1), a point reflection, so that every Blender bone has a proper rotation matrix.
"""
from mathutils import Matrix, Quaternion, Vector

MIRRORS = [('X', 'Mirror X', 'Mirror the x axis (like the ParaWorld Toolkit\'s glTF files)'),
           ('Y', 'Mirror Y', 'Mirror the y axis (north up on maps)'),
           ('NONE', 'None', 'Keep the game\'s left-handed coordinates (the model looks mirrored)')]


def mirror_matrix(axis):
    d = {'X': (-1, 1, 1, 1), 'Y': (1, -1, 1, 1)}.get(axis, (1, 1, 1, 1))
    return Matrix.Diagonal(d)


class Space:
    """conversion helper for one archive (mirror axis)"""

    def __init__(self, axis='X'):
        self.axis = axis
        self.S = mirror_matrix(axis)
        self.s3 = Vector((self.S[0][0], self.S[1][1], self.S[2][2]))
        self.flip = axis in ('X', 'Y')       # one axis mirrored -> triangle winding flips

    # ------------------------------------------------------------------ GSF -> Blender
    def matrix(self, m16):
        """GSF row-major matrix (16 floats) -> Blender matrix"""
        G = Matrix([m16[0:4], m16[4:8], m16[8:12], m16[12:16]]).transposed()
        return self.S @ G @ self.S

    def point(self, p):
        return Vector((p[0] * self.s3[0], p[1] * self.s3[1], p[2] * self.s3[2]))

    def rot_matrix(self, q):
        """GSF quaternion (x y z w, Direct3D) -> Blender 3x3 rotation"""
        R = gsf_quat(q).to_matrix()
        S3 = self.S.to_3x3()
        return S3 @ R @ S3

    def quat(self, q):
        return self.rot_matrix(q).to_quaternion()

    def loc_rot(self, pos, q):
        """position + GSF quaternion -> Blender matrix"""
        return Matrix.Translation(self.point(pos)) @ self.rot_matrix(q).to_4x4()

    # ------------------------------------------------------------------ Blender -> GSF
    def matrix_back(self, M):
        G = self.S @ M @ self.S
        return [G[c][r] for r in range(4) for c in range(4)]     # row-major of the transposed = D3D layout

    def point_back(self, v):
        return (v[0] * self.s3[0], v[1] * self.s3[1], v[2] * self.s3[2])

    def quat_back(self, M3):
        """Blender 3x3 rotation (or quaternion) -> GSF quaternion (x y z w)"""
        if isinstance(M3, Quaternion):
            M3 = M3.to_matrix()
        S3 = self.S.to_3x3()
        R = (S3 @ M3 @ S3).to_quaternion()
        return gsf_quat_back(R)


def gsf_quat(q):
    """GSF quaternion (x y z w) -> mathutils rotation for column vectors (the conjugate)"""
    return Quaternion((q[3], -q[0], -q[1], -q[2]))


def gsf_quat_back(R):
    """mathutils rotation quaternion -> GSF quaternion (x y z w)"""
    R = R.normalized()
    return (-R.x, -R.y, -R.z, R.w)


def decompose_ortho(M):
    """matrix -> (translation, rotation quaternion, scale) robust for mirrored matrices (negative determinant):
    the reflection goes into the scale"""
    loc, rot, sca = M.decompose()
    if M.to_3x3().determinant() < 0:
        sca = -sca
        rot = (M.to_3x3() @ Matrix.Diagonal(Vector((1 / sca[0], 1 / sca[1], 1 / sca[2])))).to_quaternion()
    return loc, rot, sca
