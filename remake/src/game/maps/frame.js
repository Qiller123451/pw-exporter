// The game's map space against three.js. ParaWorld is a Direct3D game: its spaces are LEFT-handed - maps x east,
// y SOUTH, z up (docs/MAP_FORMAT.md), the models in the same handedness. three.js is right-handed (y up, -z north),
// so a map position becomes (x - ox, height, y - oy) (maps/source.js toGame), and the converter mirrors every model
// (pwexport/gsf.py GSF_MIRROR: GSF (x, y, z) -> glTF (-x, z, -y)). Without both the whole world came out mirrored.

// the heading (rotation about y, 0 = facing -z) of an object the map turns by `rot` (the angle about the map's z,
// from x towards y)
export const mapHeading = (rot) => Math.PI - (+rot || 0);

// the orientation [x, y, z, w] of an object the map stores with quaternion q (x, y, z, w; Direct3D style: the engine
// applies its conjugate). Tilted landscape pieces (plateaus, cliffs) need all of it; for a turn about z it gives
// mapHeading. Derivation: world = S R(conj q) Rz(pi)^-1 S with S = swap(y, z): S R S = (qx, qz, qy, qw), times
// Ry(pi) = (0, 1, 0, 0).
export function mapQuat(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const ax = q[0] / n, ay = q[2] / n, az = q[1] / n, aw = q[3] / n;          // (qx, qz, qy, qw)
  // (ax, ay, az, aw) * (0, 1, 0, 0)
  return [-az, aw, ax, -ay];
}
