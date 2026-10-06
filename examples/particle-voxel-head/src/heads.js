// Procedural head generator for the particle voxel head.
//
// A head is a signed distance field built from smooth-unioned ellipsoids and capsules.
// It is sampled into "pin-art" cubes: rays are cast along five axes (+z, -z, +x, -x, +y)
// on a regular grid, and each hit is kept only by the axis that surface faces most.
// That keeps every cube axis-aligned on a regular lattice while its depth stays
// continuous, which is the look of the reference: a grid of cubes pushed out to the
// face, not a terraced voxel volume.
//
// Pure JS with no Three.js dependency, so it runs in Node for checks and in the page.

export const N = 224;            // particle texture side: N*N cells, one cube each
export const CELLS = N * N;
export const SPACING = 0.025;    // lattice pitch in world units (~66 cubes across the face)
export const KEY_DIR = norm([0.12, 0.62, 0.78]); // key light, above and in front

// ---------------------------------------------------------------- tiny vec3 helpers
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function len3(x, y, z) { return Math.sqrt(x * x + y * y + z * z); }

// mulberry32: deterministic seeds for every procedural decision.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- SDF primitives
function sdEllipsoid(px, py, pz, rx, ry, rz) {
  const k0 = len3(px / rx, py / ry, pz / rz);
  const k1 = len3(px / (rx * rx), py / (ry * ry), pz / (rz * rz));
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}
function sdCapsule(px, py, pz, ax, ay, az, bx, by, bz, ra, rb) {
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return len3(pax - bax * h, pay - bay * h, paz - baz * h) - (ra + (rb - ra) * h);
}
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a, b, k) { return -smin(-a, -b, k); }

// 3D value noise for low-frequency surface irregularity.
function hash3(i, j, k) {
  const h = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  let fx = x - i, fy = y - j, fz = z - k;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(i, j, k), hash3(i + 1, j, k), fx), l(hash3(i, j + 1, k), hash3(i + 1, j + 1, k), fx), fy),
    l(l(hash3(i, j, k + 1), hash3(i + 1, j, k + 1), fx), l(hash3(i, j + 1, k + 1), hash3(i + 1, j + 1, k + 1), fx), fy),
    fz);
}

// ---------------------------------------------------------------- head parameters
// World units: crown at y≈1.15, chin at y≈-1.15, face front at z≈0.8, +z toward camera.
// The reference proportions (eyes ~40% down from the crown, nose base ~63%, mouth ~77%)
// were measured off the supplied image.
export const BASE = {
  seed: 7,
  width: 1.0,          // global x scale
  height: 1.0,         // global y scale
  cranium: [0.80, 0.84, 0.90], craniumY: 0.34, craniumZ: -0.10,
  face: [0.64, 0.92, 0.66], faceY: -0.34, faceZ: 0.08,
  jawW: 0.43, chinY: -1.07, chinZ: 0.22, chinR: 0.28,
  cheek: 0.24, cheekX: 0.42, cheekY: -0.08, cheekZ: 0.42,
  browY: 0.33, browZ: 0.60, brow: 0.13,
  eyeX: 0.28, eyeY: 0.20, socket: 0.17, lid: 1.0,
  noseTopY: 0.18, noseTipY: -0.30, noseTipZ: 0.93, noseW: 0.105,
  mouthY: -0.68, mouthW: 0.22, lip: 0.06,
  ear: 0.24, earY: 0.06,
  neckR: 0.47, neckZ: -0.14,
  // Anatomy that keeps a head from reading as a smooth CG primitive.
  fold: 1.0,     // nasolabial fold depth
  temple: 1.0,   // temporal hollow depth
  asym: 1.0,     // left/right asymmetry (eyes, brows, mouth corners, nose tip)
  organic: 1.0,  // low-frequency surface irregularity
};

export const PRESETS = {
  reference: { label: 'Reference head' },
  broad: { label: 'Broad head', width: 1.12, height: 0.95, jawW: 0.55, chinR: 0.33, cheek: 0.28, brow: 0.17,
    noseW: 0.14, noseTipZ: 0.90, lip: 0.085, neckR: 0.58, socket: 0.19 },
  slender: { label: 'Slender head', width: 0.88, height: 1.06, jawW: 0.36, chinY: -1.14, chinR: 0.22, cheek: 0.2,
    noseTipY: -0.3, noseTipZ: 0.98, noseW: 0.1, mouthW: 0.2, lip: 0.065, neckR: 0.40 },
  elder: { label: 'Elder head', cranium: [0.82, 0.82, 0.92], brow: 0.18, socket: 0.22, cheek: 0.19, cheekZ: 0.36,
    noseTipY: -0.34, noseTipZ: 0.96, noseW: 0.12, lip: 0.05, mouthY: -0.72, chinR: 0.25, ear: 0.30,
    fold: 1.8, temple: 1.5, asym: 1.4, organic: 1.4 },
  child: { label: 'Child head', width: 1.04, height: 0.92, cranium: [0.86, 0.92, 0.94], craniumY: 0.42,
    face: [0.6, 0.76, 0.62], faceY: -0.28, jawW: 0.36, chinY: -0.90, chinR: 0.24, eyeY: 0.12, browY: 0.24,
    brow: 0.08, socket: 0.13, noseTopY: 0.08, noseTipY: -0.26, noseTipZ: 0.84, noseW: 0.095, mouthY: -0.56,
    mouthW: 0.18, lip: 0.08, cheek: 0.27, cheekZ: 0.40, neckR: 0.38, fold: 0.3, temple: 0.35, organic: 0.5 },
};

export function resolveParams(name, overrides) {
  const p = { ...BASE, ...(PRESETS[name] || {}), ...(overrides || {}) };
  delete p.label;
  return p;
}

// Random but anatomically bounded face: each field is jittered around BASE.
export function randomParams(seed) {
  const r = rng(seed * 7919 + 17);
  const j = (v, amt) => v * (1 + (r() * 2 - 1) * amt);
  return {
    seed,
    width: j(1, 0.10), height: j(1, 0.07),
    jawW: j(BASE.jawW, 0.22), chinY: j(BASE.chinY, 0.07), chinR: j(BASE.chinR, 0.2),
    cheek: j(BASE.cheek, 0.22), cheekZ: j(BASE.cheekZ, 0.1),
    brow: j(BASE.brow, 0.4), browY: j(BASE.browY, 0.08), socket: j(BASE.socket, 0.25),
    eyeX: j(BASE.eyeX, 0.08), eyeY: j(BASE.eyeY, 0.2),
    noseTipY: j(BASE.noseTipY, 0.15), noseTipZ: j(BASE.noseTipZ, 0.06), noseW: j(BASE.noseW, 0.25),
    mouthY: j(BASE.mouthY, 0.06), mouthW: j(BASE.mouthW, 0.15), lip: j(BASE.lip, 0.3),
    ear: j(BASE.ear, 0.2), neckR: j(BASE.neckR, 0.15),
    fold: j(1, 0.5), temple: j(1, 0.4), asym: j(1, 0.5),
  };
}

// ---------------------------------------------------------------- the head SDF
export function makeHeadSDF(P) {
  const sx = 1 / P.width, sy = 1 / P.height;
  const [cx, cy, cz] = P.cranium;
  const [fx, fy, fz] = P.face;
  return sdf;

  function sdf(x0, y0, z) {
    const x = x0 * sx, y = y0 * sy;
    const ax = Math.abs(x); // bilateral symmetry

    // Skull and face masses.
    let d = sdEllipsoid(x, y - P.craniumY, z - P.craniumZ, cx, cy, cz);
    d = smin(d, sdEllipsoid(x, y - P.faceY, z - P.faceZ, fx, fy, fz), 0.32);
    d = smin(d, sdEllipsoid(x, y - P.chinY, z - P.chinZ, P.jawW, P.chinR, P.chinR * 1.25), 0.36);
    d = smin(d, sdEllipsoid(ax - P.cheekX, y - P.cheekY, z - P.cheekZ, P.cheek, P.cheek * 0.8, P.cheek * 0.85), 0.2);

    // Bone planes: the cheekbone ridge running back toward the ear, the corners of the
    // jaw, and hollow temples. Without them the skull is an egg.
    d = smin(d, sdEllipsoid(ax - 0.5, y + 0.02, z - 0.34, 0.2, 0.055, 0.12), 0.06);
    d = smin(d, sdEllipsoid(ax - (P.jawW + 0.02), y + 0.82, z + 0.05, 0.1, 0.16, 0.2), 0.12);
    d = smax(d, -sdEllipsoid(ax - 0.8, y - 0.28, z - 0.28, 0.08 * P.temple + 0.001, 0.15, 0.13), 0.12);

    // Facial features only influence the front of the head; skipping them elsewhere
    // halves the cost of the march without changing the field (their reach ends inside
    // this box, smooth-blend radius included).
    if (z > 0.25 && ax < 0.75 && y < 0.65 && y > -1.25) d = face(d, x, ax, y, z);
    if (ax > 0.55) d = smin(d, sdEllipsoid(ax - 0.80, y - P.earY, z + 0.06, 0.07, P.ear, P.ear * 0.55), 0.06);
    d = smin(d, sdCapsule(x, y, z, 0, -0.55, P.neckZ, 0, -2.6, P.neckZ + 0.02, P.neckR, P.neckR * 1.08), 0.3);

    // Low-frequency irregularity, only near the surface where it can matter: about
    // half a cube of relief, enough to break up the perfectly smooth shading.
    if (d < 0.05 && P.organic > 0) {
      d += ((vnoise3(x * 5.5 + P.seed, y * 5.5, z * 5.5) - 0.5) * 0.014
        + (vnoise3(x * 12, y * 12 + P.seed, z * 12) - 0.5) * 0.006) * P.organic;
    }

    // The SDF is evaluated in scaled space; rescale so distances stay near-metric.
    return d * Math.min(P.width, P.height);
  }

  function face(d, x, ax, y, z) {
    // No face is symmetric: one side sits a little higher, seeded per head.
    const side = (x < 0 ? 1 : -1) * (P.seed % 2 ? 1 : -1) * P.asym;
    const eyeY = P.eyeY + side * 0.008;

    // Brows: two ridges meeting at a lower glabella, not one bar.
    d = smin(d, sdEllipsoid(ax - 0.25, y - (P.browY + side * 0.01), z - P.browZ, 0.27, P.brow, 0.18), 0.12);
    d = smin(d, sdEllipsoid(x, y - (P.browY - 0.04), z - (P.browZ + 0.03), 0.08, 0.06, 0.08), 0.06);
    // Closed eyelids inside carved sockets, with a crease above and a hollow below.
    d = smax(d, -sdEllipsoid(ax - P.eyeX, y - eyeY, z - 0.80, 0.19, 0.13, 0.2 * (P.socket / 0.17)), 0.10);
    d = smin(d, sdEllipsoid(ax - P.eyeX, y - (eyeY - 0.005), z - 0.58, 0.14, 0.085, 0.13 * P.lid), 0.06);
    d = smax(d, -sdEllipsoid(ax - P.eyeX, y - (eyeY + 0.075), z - 0.66, 0.13, 0.012, 0.08), 0.02);
    d = smax(d, -sdEllipsoid(ax - P.eyeX * 1.02, y - (eyeY - 0.15), z - 0.73, 0.12, 0.035, 0.07), 0.05);

    // Nose: bridge, tip, alar wings; philtrum groove below it.
    d = smin(d, sdCapsule(x, y, z, 0, P.noseTopY, 0.70, 0, P.noseTipY + 0.06, P.noseTipZ - 0.06,
      P.noseW * 0.55, P.noseW * 0.95), 0.08);
    d = smin(d, sdEllipsoid(x, y - P.noseTipY, z - (P.noseTipZ - 0.1), P.noseW * 1.05, P.noseW * 0.95, P.noseW), 0.05);
    d = smin(d, sdEllipsoid(ax - P.noseW * 0.95, y - (P.noseTipY - 0.02), z - (P.noseTipZ - 0.22), P.noseW * 0.7,
      P.noseW * 0.55, P.noseW * 0.7), 0.08);
    d = smax(d, -sdEllipsoid(x, y - (P.noseTipY - 0.17), z - 0.84, 0.03, 0.07, 0.05), 0.04);
    // Nostrils under the tip.
    d = smax(d, -sdEllipsoid(ax - 0.05, y - (P.noseTipY - 0.07), z - (P.noseTipZ - 0.13), 0.032, 0.02, 0.05), 0.02);

    // Malar pads and the nasolabial folds that separate them from the mouth.
    d = smin(d, sdEllipsoid(ax - 0.25, y + 0.42, z - 0.64, 0.11, 0.12, 0.08), 0.08);
    if (P.fold > 0) {
      d = smax(d, -sdCapsule(ax, y, z, P.noseW * 1.55, P.noseTipY - 0.02, 0.75,
        P.mouthW * 1.05, P.mouthY - 0.03, 0.66, 0.012 * P.fold, 0.016 * P.fold), 0.035);
    }

    // Lips wrap around the dental arch: depth falls off with x², so the corners tuck
    // back into the cheeks instead of the mouth reading as a flat slab (which, lit
    // from above, looked like a grin).
    const u = x / P.mouthW;
    const zl = z + 0.55 * x * x;
    // Upper lip with a cupid's bow dip at the centre, under a shallow philtrum groove.
    // It overhangs the lower lip: at this lattice pitch (lips are 2-3 cubes tall) the
    // mouth reads through that depth step, not through a hairline carve.
    const bow = 0.012 * Math.exp(-u * u * 40);
    d = smin(d, sdEllipsoid(x, y - (P.mouthY + 0.035 - bow), zl - 0.685, P.mouthW * 0.92, P.lip * 0.85, 0.085), 0.09);
    d = smax(d, -sdEllipsoid(x, y - (P.mouthY + 0.11), z - 0.80, 0.022, 0.055, 0.03), 0.03);
    // Lower lip: short and set back, so the shadow under it stays a small pad rather
    // than a long upturned curve (which read as a smile).
    d = smin(d, sdEllipsoid(x, y - (P.mouthY - 0.055), zl - 0.635, P.mouthW * 0.6, P.lip * 0.95, 0.08), 0.1);
    // Mouth line: closed and neutral, half a cube tall so the lattice resolves it,
    // fading out before the corners.
    d = smax(d, -sdEllipsoid(x, y - (P.mouthY + 0.004 * u * u), zl - 0.765, P.mouthW * 0.82, 0.012, 0.06), 0.012);
    // Corners tuck in with a small dimple each side, one a little higher.
    d = smax(d, -sdEllipsoid(ax - P.mouthW * 0.9, y - (P.mouthY + side * 0.006), zl - 0.72, 0.03, 0.025, 0.05), 0.03);
    // Chin pad under a shallow mentolabial groove.
    d = smax(d, -sdEllipsoid(x, y - (P.mouthY - 0.17), zl - 0.7, P.mouthW * 0.55, 0.02, 0.04), 0.05);
    d = smin(d, sdEllipsoid(x, y - (P.chinY + 0.1), z - (P.chinZ + P.chinR * 1.25 - 0.04), 0.13, 0.09, 0.06), 0.06);
    return d;
  }
}

function gradient(sdf, x, y, z) {
  const e = 0.004;
  return norm([
    sdf(x + e, y, z) - sdf(x - e, y, z),
    sdf(x, y + e, z) - sdf(x, y - e, z),
    sdf(x, y, z + e) - sdf(x, y, z - e),
  ]);
}

// ---------------------------------------------------------------- sampling
const BOUNDS = { x: [-1.15, 1.15], y: [-2.0, 1.32], z: [-1.25, 1.3] };
const NECK_CUT = -1.95;
const AXES = [
  { i: 2, s: 1 }, { i: 2, s: -1 }, { i: 0, s: 1 }, { i: 0, s: -1 }, { i: 1, s: 1 }, { i: 1, s: -1 },
];

// Which lattice owns a surface point. The front lattice (+z) owns everything that
// faces the camera even slightly, so the face is one uninterrupted grid of columns,
// as in the reference. That matters for undersides too: a nose base or lip edge
// left to the ±y lattice is shadowed from those rays by the lips and chin, and
// would come out as a see-through hole. Other axes cover sides, crown and back.
// The side and top lattices also take any surface their axis clearly dominates,
// overlapping the front lattice there, so orbit views stay dense; from the front
// those extra cubes sit on the same surface and read as part of the grid.
const FRONT = 0.1;
function owns(axis, sign, n) {
  const a = n[axis] * sign;
  if (axis === 2) return sign > 0 ? n[2] >= FRONT : n[2] <= -FRONT;
  const other = axis === 0 ? Math.abs(n[1]) : Math.abs(n[0]);
  return a > 0.55 && a >= other;
}
const AXIS_RANGE = [BOUNDS.x, BOUNDS.y, BOUNDS.z];

// Cheap conservative bound (one ellipsoid + neck capsule) to cross empty space fast.
function bound(x, y, z) {
  return Math.min(
    sdEllipsoid(x, y - 0.08, z - 0.06, 1.05, 1.35, 1.2),
    sdCapsule(x, y, z, 0, -0.6, -0.12, 0, -2.6, -0.12, 0.72, 0.72),
  ) * 0.8;
}

function march(sdf, o, dir, maxT) {
  let t = 0;
  for (let k = 0; k < 64 && t < maxT; k++) {
    const b = bound(o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t);
    if (b < 0.04) break;
    t += b;
  }
  if (t >= maxT) return -1;
  for (let k = 0; k < 220 && t < maxT; k++) {
    const x = o[0] + dir[0] * t, y = o[1] + dir[1] * t, z = o[2] + dir[2] * t;
    const d = sdf(x, y, z);
    if (d < 1.5e-3) return t;
    t += Math.max(d * 0.95, 2.5e-3);
  }
  return -1;
}

function ambientOcclusion(sdf, p, n) {
  let occ = 0, sca = 1;
  for (let i = 0; i < 6; i++) {
    const h = 0.02 + 0.16 * i / 5;
    const d = sdf(p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h);
    occ += (h - d) * sca;
    sca *= 0.8;
  }
  return Math.min(1, Math.max(0, 1 - 2.2 * occ));
}

function softShadow(sdf, p, n) {
  const L = KEY_DIR;
  let res = 1, t = 0.03;
  const ox = p[0] + n[0] * 0.02, oy = p[1] + n[1] * 0.02, oz = p[2] + n[2] * 0.02;
  for (let i = 0; i < 48 && t < 2.2; i++) {
    const d = sdf(ox + L[0] * t, oy + L[1] * t, oz + L[2] * t);
    res = Math.min(res, 4 * d / t);
    if (res < 0.02) return 0.02;
    t += Math.min(Math.max(d, 0.01), 0.2);
  }
  return Math.max(0.02, Math.min(1, res));
}

// Morton code on 10 bits per axis: keeps neighbouring cubes on neighbouring cells, so a
// morph between two heads maps forehead to forehead instead of scrambling.
function part1by2(v) {
  v &= 0x3ff;
  v = (v | (v << 16)) & 0x030000ff;
  v = (v | (v << 8)) & 0x0300f00f;
  v = (v | (v << 4)) & 0x030c30c3;
  v = (v | (v << 2)) & 0x09249249;
  return v >>> 0;
}
function morton(p) {
  const q = (v, r) => Math.max(0, Math.min(1023, Math.floor((v - r[0]) / (r[1] - r[0]) * 1023)));
  return (part1by2(q(p[0], BOUNDS.x)) | (part1by2(q(p[1], BOUNDS.y)) << 1) | (part1by2(q(p[2], BOUNDS.z)) << 2)) >>> 0;
}

/** Sample a head into pin-art cubes. Returns plain arrays, no textures. */
export function sampleHead(P, spacing = SPACING) {
  const sdf = makeHeadSDF(P);
  const R = rng(P.seed * 101 + 3);
  const voxels = [];
  for (const ax of AXES) {
    const u = (ax.i + 1) % 3, v = (ax.i + 2) % 3;
    const ru = AXIS_RANGE[u], rv = AXIS_RANGE[v], ra = AXIS_RANGE[ax.i];
    const dir = [0, 0, 0]; dir[ax.i] = -ax.s;
    const maxT = ra[1] - ra[0];
    // Half-cell offset per axis so the lattices of different axes do not coincide.
    for (let a = ru[0] + spacing * 0.5; a <= ru[1]; a += spacing) {
      for (let b = rv[0] + spacing * 0.5; b <= rv[1]; b += spacing) {
        const o = [0, 0, 0];
        o[u] = a; o[v] = b; o[ax.i] = ax.s > 0 ? ra[1] : ra[0];
        const t = march(sdf, o, dir, maxT);
        if (t < 0) continue;
        const p = [o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t];
        if (p[1] < NECK_CUT) continue;
        const n = gradient(sdf, p[0], p[1], p[2]);
        if (!owns(ax.i, ax.s, n)) continue;
        // Pin-art depth jitter: most cubes sit flush, some are pushed in so their
        // side faces show (the dark speckle across the reference face).
        const r0 = R();
        const recess = r0 < 0.18 ? 0.7 + R() * 1.1 : R() * 0.7;
        p[ax.i] -= ax.s * recess * spacing;
        voxels.push({ p, n, axis: ax.i, sign: ax.s, front: ax.i === 2 && ax.s > 0, size: 0.76 + R() * 0.16 });
      }
    }
  }
  for (const vx of voxels) {
    vx.ao = ambientOcclusion(sdf, vx.p, vx.n);
    // Pin-art front faces all point down +z, so on their own they shade identically
    // and the face loses its relief. Bake the underlying surface's diffuse term
    // (with a soft, partial shadow) per cube instead; the cube shader modulates it.
    const ndl = Math.max(0, vx.n[0] * KEY_DIR[0] + vx.n[1] * KEY_DIR[1] + vx.n[2] * KEY_DIR[2]);
    vx.shadow = (0.12 + 0.88 * ndl) * (0.4 + 0.6 * softShadow(sdf, vx.p, vx.n));
    vx.key = morton(vx.p);
  }
  voxels.sort((a, b) => a.key - b.key);
  return { params: P, sdf, voxels };
}

// ---------------------------------------------------------------- particle layout
function gauss(R) {
  return Math.sqrt(-2 * Math.log(Math.max(R(), 1e-9))) * Math.cos(6.2831853 * R());
}

/**
 * Lay a sampled head onto the CELLS particle slots.
 *   home    xyz = cube rest position, w = peel (1 = face front, last to dissolve; -1 = cloud)
 *   scatter xyz = where the cube drifts when dissolved, w = drifting cube scale
 *   attr    r = ambient occlusion, g = baked surface key light, b = rest scale, a = albedo
 * Cells that hold no cube in this head are cloud particles: home = scatter.
 */
export function layoutCells(head, cells = CELLS) {
  const { voxels, sdf, params } = head;
  const R = rng(params.seed * 31 + 11);
  const home = new Float32Array(cells * 4);
  const scatter = new Float32Array(cells * 4);
  const attr = new Float32Array(cells * 4);
  const V = Math.min(voxels.length, Math.floor(cells * 0.8));
  // Spread the voxels evenly over the cell range; the cells in between become cloud
  // particles anchored to the voxel with the nearest index.
  const voxelAt = new Int32Array(cells).fill(-1);
  for (let j = 0; j < V; j++) voxelAt[Math.min(cells - 1, Math.floor((j + 0.5) * cells / V))] = Math.floor(j * voxels.length / V);

  for (let c = 0; c < cells; c++) {
    const own = voxelAt[c];
    const anchor = voxels[own >= 0 ? own : Math.min(voxels.length - 1, Math.floor(c * voxels.length / cells))];
    const [px, py, pz] = anchor.p;
    const n = anchor.n;

    // Scatter: outward from the surface, biased sideways (the reference cloud streams
    // left and right far more than up or toward the camera), exponential distance.
    const side = Math.abs(px) > 0.08 ? Math.sign(px) : (R() < 0.5 ? -1 : 1);
    let dx = n[0] * 1.1 + side * 1.1 + gauss(R) * 0.4;
    let dy = (n[1] * 0.7 + gauss(R) * 0.35) * 0.4;
    let dz = (n[2] * 0.6 + gauss(R) * 0.55) * 0.8;
    if (Math.abs(px) < 0.45 && dz > 0.2) dz = 0.2 * (1 + R()); // keep the face itself unveiled
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const E = -Math.log(Math.max(R(), 1e-6));
    let dist = own >= 0 ? 0.03 + 0.24 * Math.pow(E, 1.15) : 0.03 + 0.24 * Math.pow(E, 1.5);
    let sx = px + dx * dist, sy = py + dy * dist, sz = pz + dz * dist;
    for (let k = 0; k < 6 && sdf(sx, sy, sz) < SPACING; k++) { dist += 0.12; sx = px + dx * dist; sy = py + dy * dist; sz = pz + dz * dist; }
    // Nothing drifts in front of the face: inside the face outline, drifting cubes pass
    // behind the surface they left, so the features stay readable from the front.
    if (Math.abs(sx) < 0.62 && sy > -1.25 && sy < 0.95 && sz > 0.2) sz = Math.min(sz, pz - 0.15);
    const big = R();
    // Only part of the free cloud is shown: the photo's cloud is a band hugging the
    // head, with clean background in the corners. Hidden cells (scale 0) stay
    // available as cubes for heads with more surface.
    const shown = own >= 0 || R() < 0.8;
    const driftScale = !shown ? 0 : own >= 0 ? 0.45 + 0.4 * R() : (big < 0.05 ? 1.0 + 0.5 * R() : 0.3 + 0.4 * R());

    scatter.set([sx, sy, sz, driftScale], c * 4);
    if (own >= 0) {
      // Peel order: back and sides go first, the front of the face and the crown last,
      // the neck fades out toward the frame bottom.
      // Back and sides go first, then the silhouette as seen from the front (an
      // elliptical radius around the face), the centre of the face and the crown last.
      // Cubes on the front lattice are what the camera sees: only the outline peels them.
      let peel = anchor.front ? 0.9 + 0.1 * n[2] : 0.5 + 0.5 * Math.max(n[2], 0.92 * n[1]);
      const r = Math.hypot(px / (0.78 * params.width), (py + 0.1) / ((py > 0 ? 1.9 : 1.5) * params.height));
      peel *= 1 - 0.7 * Math.min(1, Math.max(0, (r - 0.5) / 0.55));
      peel *= 0.25 + 0.75 * Math.min(1, Math.max(0, (py + 1.75) / 0.75));
      home.set([px, py, pz, Math.min(1, Math.max(0, peel))], c * 4);
      // Tone speckle: most cubes near white, a few noticeably darker, as in the photo.
      const tone = R() < 0.07 ? 0.66 + 0.14 * R() : 0.84 + 0.16 * R();
      attr.set([anchor.ao, anchor.shadow, anchor.size, tone], c * 4);
    } else {
      home.set([sx, sy, sz, -1], c * 4); // -1: always a cloud particle in this head
      attr.set([1, 1, driftScale, 0.85 + 0.15 * R()], c * 4);
    }
  }
  return { home, scatter, attr, voxelCount: V, totalVoxels: voxels.length };
}
