const EPS = 1e-9;

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

function pointInTri3D(p, tri) {
  const [a, b, c] = tri;
  const v0 = sub(c, a), v1 = sub(b, a), v2 = sub(p, a);
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1);
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < EPS) return false;
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1 - v - w;
  return u >= -EPS && v >= -EPS && w >= -EPS;
}

export function triangleTriangleIntersect(triA, triB) {
  return triA.some((p) => pointInTri3D(p, triB)) || triB.some((p) => pointInTri3D(p, triA));
}
