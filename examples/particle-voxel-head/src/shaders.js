// GLSL for the particle voxel head, ported from the Particle Morph Rig.
//
// Verbatim from the rig: hash4, vnoise, curl, the quad vertex shader, the separable
// blur, and the pointer spring integrator. Adapted: morphAt now works on 3D cube
// positions (the curl advection still runs in the screen plane, depth rides along),
// its `depth` peel input is the surface "forwardness" instead of image luminance, and
// a second staged transition (dissolve) sends cubes from the head into the cloud.
// Everything runs as Three.js RawShaderMaterial with glslVersion GLSL3, so the
// `#version 300 es` line the rig carried is supplied by Three.js.

// ------------------------------------------------------------------ rig: shared noise
export const COMMON = /* glsl */ `
#define PI 3.14159265
#define TAU 6.2831853

vec4 hash4(vec2 p) {
  vec4 q = vec4(
    dot(p, vec2(127.1, 311.7)),
    dot(p, vec2(269.5, 183.3)),
    dot(p, vec2(419.2, 371.9)),
    dot(p, vec2(97.3, 233.1))
  );
  return fract(sin(q) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n00 = hash4(i).x;
  float n10 = hash4(i + vec2(1.0, 0.0)).x;
  float n01 = hash4(i + vec2(0.0, 1.0)).x;
  float n11 = hash4(i + vec2(1.0, 1.0)).x;
  return mix(mix(n00, n10, f.x), mix(n01, n11, f.x), f.y);
}

vec2 curl(vec2 p) {
  const float e = 0.08;
  float dy = vnoise(p + vec2(0.0, e)) - vnoise(p - vec2(0.0, e));
  float dx = vnoise(p + vec2(e, 0.0)) - vnoise(p - vec2(e, 0.0));
  return vec2(dy, -dx) / (2.0 * e);
}
`;

// ------------------------------------------------------------------ rig: quad vertex
export const QUAD_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

// ------------------------------------------------------------------ pass 1a: morph
// One fragment per particle cell. Writes the cube centre + dissolve amount, and the
// shading attributes the cube pass needs, so the heavy curl loop runs once per cube
// instead of once per cube vertex.
export const MORPH_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;

uniform sampler2D tFromPos;
uniform sampler2D tToPos;
uniform sampler2D tFromScatter;
uniform sampler2D tToScatter;
uniform sampler2D tFromAttr;
uniform sampler2D tToAttr;
uniform float uProgress;
uniform float uTime;
uniform float uDispersion;
uniform float uChaos;
uniform float uMotion;
uniform float uIdle;
uniform float uIdleDrift;
uniform float uIdleSpeed;
uniform float uDissolve;

layout(location = 0) out vec4 outPos;   // xyz cube centre, w dissolve amount
layout(location = 1) out vec4 outAttr;  // ao, baked key light, cube scale, albedo

${COMMON}

struct MorphSample {
  vec3 pos;
  float t;
  vec2 shift;
};

MorphSample morphAt(vec2 cell) {
  vec4 seed = hash4(cell * 1024.0 + 13.7);
  vec4 fromRaw = texture(tFromPos, cell);
  vec4 toRaw = texture(tToPos, cell);

  vec3 a = fromRaw.xyz;
  vec3 b = toRaw.xyz;

  float family = floor(vnoise(a.xy * 2.4 + 17.0) * 3.0);
  vec2 shift = vec2(family * 7.31 + uTime * 0.05, family * 3.17 - uTime * 0.035);

  // Rig: depth was image luminance. Here it is the peel order baked per cube
  // (front of the face = 1), so the face front is the last region to leave.
  float depth = 0.5 * (max(fromRaw.w, 0.0) + max(toRaw.w, 0.0));
  float peel = clamp(depth * 0.8 + (vnoise(a.xy * 2.6 + shift) - 0.5) * 0.3 + seed.x * 0.04, 0.0, 1.0);
  float phase = mix(seed.x, peel, uChaos);
  float stagger = 0.35 * uMotion + 0.7 * uChaos;
  float t = smoothstep(0.0, 1.0, clamp(uProgress * (1.0 + stagger) - phase * stagger, 0.0, 1.0));
  float arc = sin(t * PI);

  vec3 pos = mix(a, b, t);

  if (uChaos > 0.0) {
    float hang = pow(max(arc, 0.0), 0.6);
    float handoff = smoothstep(0.3, 0.7, t);
    vec3 base = mix(a, b, handoff);
    float reach = 0.55 + 0.45 * vnoise(base.xy * 3.1 + shift * 0.5) + 0.04 * seed.w;
    float travel = hang * uChaos * reach * 0.17;

    vec2 pa = a.xy;
    vec2 pb = b.xy;
    vec2 outFlow = vec2(0.0);
    vec2 inFlow = vec2(0.0);
    for (int i = 0; i < 5; i++) {
      vec2 va = curl((pa + shift) * 1.15) + curl((pa - shift * 0.7) * 2.8) * 0.22;
      float awayA = length(pa);
      va += (awayA > 1e-4 ? pa / awayA : vec2(0.0)) * 0.3;
      va = normalize(va + vec2(1e-5, 0.0)) * travel;
      pa += va;
      outFlow += va;

      vec2 vb = curl((pb + shift + 5.0) * 1.15) + curl((pb - shift * 0.7 - 5.0) * 2.8) * 0.22;
      float awayB = length(pb);
      vb += (awayB > 1e-4 ? pb / awayB : vec2(0.0)) * 0.3;
      vb = normalize(vb + vec2(1e-5, 0.0)) * travel;
      pb += vb;
      inFlow += vb;
    }
    pos = base;
    pos.xy += mix(outFlow, inFlow, handoff) * uMotion;
    // Depth swells outward mid-flight so the head opens up instead of flattening.
    pos.z += (seed.z * 2.0 - 1.0) * travel * 2.5 * uMotion;
  }

  vec2 dir = b.xy - a.xy;
  float len = length(dir);
  vec2 perp = len > 1e-5 ? vec2(-dir.y, dir.x) / len : vec2(0.0, 1.0);
  float bow = (seed.y * 2.0 - 1.0) * (0.08 + 0.3 * len) * uDispersion;

  float turn = seed.w > 0.5 ? 1.0 : -1.0;
  float spin = seed.z * TAU + turn * (t * TAU * (0.6 + seed.x * 0.8) + uTime * 0.6);
  vec2 orbit = vec2(cos(spin), sin(spin)) * (0.02 + 0.08 * seed.w) * uDispersion;

  pos.xy += (perp * bow + orbit) * arc * uMotion * (1.0 - 0.85 * uChaos);

  float clockIdle = uTime * uIdleSpeed;
  float loopAngle = clockIdle * (0.5 + seed.y * 0.9) + seed.z * TAU;
  vec2 loop = vec2(cos(loopAngle), sin(loopAngle) * 0.7) * (0.004 + 0.006 * seed.w);
  vec2 sway = vec2(
    sin(clockIdle * 0.55 + pos.y * 1.6 + seed.x * 0.5),
    cos(clockIdle * 0.42 + pos.x * 1.3) * 0.6
  ) * 0.008;
  // Rig drift applies to everything at rest; a pin-art face must hold still, so the
  // drift is handed to the dissolve stage below and only kept here mid-morph.
  pos.xy += (loop + sway) * uIdleDrift * arc * uMotion * uIdle;

  return MorphSample(pos, t, shift);
}

void main() {
  vec2 cell = vUv;
  vec4 seed = hash4(cell * 1024.0 + 13.7);
  MorphSample m = morphAt(cell);

  vec4 fromRaw = texture(tFromPos, cell);
  vec4 toRaw = texture(tToPos, cell);
  vec4 sa = texture(tFromScatter, cell);
  vec4 sb = texture(tToScatter, cell);
  vec4 aa = texture(tFromAttr, cell);
  vec4 ab = texture(tToAttr, cell);

  vec3 scatter = mix(sa.xyz, sb.xyz, m.t);
  float cloud = mix(fromRaw.w < 0.0 ? 1.0 : 0.0, toRaw.w < 0.0 ? 1.0 : 0.0, m.t);
  float peel = mix(max(fromRaw.w, 0.0), max(toRaw.w, 0.0), m.t);

  // Dissolve: the rig's staged phase again, ordered by peel so the rim crumbles first.
  float rim = clamp(peel + (vnoise(m.pos.xy * 3.3 + m.shift * 0.3) - 0.5) * 0.3 + seed.y * 0.06 - 0.03, 0.0, 1.0);
  const float st = 1.6;
  float td = smoothstep(0.0, 1.0, clamp(uDissolve * (1.0 + st) - rim * st, 0.0, 1.0));
  td = max(td, cloud);

  // Leave the surface through the same curl field the rig uses for its chaos flow.
  float hang = pow(max(sin(td * PI), 0.0), 0.6);
  vec2 p = m.pos.xy;
  vec2 flow = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 v = curl((p + m.shift) * 1.15) + curl((p - m.shift * 0.7) * 2.8) * 0.22;
    float away = length(p);
    v += (away > 1e-4 ? p / away : vec2(0.0)) * 0.3;
    v = normalize(v + vec2(1e-5, 0.0)) * hang * 0.05 * (0.4 + uChaos);
    p += v;
    flow += v;
  }
  vec3 pos = mix(m.pos, scatter, td);
  pos.xy += flow * uMotion;

  // The cloud keeps living: slow curl drift plus the rig's idle loop and sway.
  float clockIdle = uTime * uIdleSpeed;
  float loopAngle = clockIdle * (0.5 + seed.y * 0.9) + seed.z * TAU;
  vec2 loop = vec2(cos(loopAngle), sin(loopAngle) * 0.7) * (0.004 + 0.006 * seed.w);
  vec2 drift = curl(scatter.xy * 0.9 + vec2(uTime * 0.035, -uTime * 0.025)) * 0.03 * uDispersion;
  pos.xy += (drift + loop * 3.0) * td * uIdleDrift * uMotion * uIdle;
  pos.z += sin(clockIdle * 0.7 + seed.z * TAU) * 0.04 * td * uIdleDrift * uMotion * uIdle;

  vec4 attr = mix(aa, ab, m.t);
  float restScale = attr.b;
  float driftScale = mix(sa.w, sb.w, m.t);
  outPos = vec4(pos, td);
  outAttr = vec4(mix(attr.r, 1.0, td), mix(attr.g, 0.85, td), mix(restScale, driftScale, td), attr.a);
}
`;

// ------------------------------------------------------------------ pass 1b: pointer spring (rig sim_frag)
// Identical integrator; it reads the morph result instead of re-running morphAt.
export const SIM_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D tDisp;
uniform sampler2D tMorph;
uniform vec2 uPointer;
uniform float uPointerActive;
uniform float uPointerRadius;
uniform float uPointerStrength;
uniform float uPointerSpeed;
uniform float uDt;

in vec2 vUv;
out vec4 outDisp;

${COMMON}

void main() {
  vec4 state = texture(tDisp, vUv);
  vec2 d = state.xy;
  vec2 v = state.zw;

  vec3 mpos = texture(tMorph, vUv).xyz;
  vec4 seed = hash4(vUv * 1024.0 + 13.7);

  vec2 rel = mpos.xy + d - uPointer;
  float dist = length(rel);
  float falloff = 1.0 - smoothstep(0.0, uPointerRadius, dist);
  falloff *= falloff;
  vec2 away = dist > 1e-5 ? rel / dist : vec2(1.0, 0.0);

  v += away * falloff * uPointerStrength * uPointerActive
    * (0.6 + 0.8 * seed.x) * (0.35 + uPointerSpeed) * uDt * 6.0;
  v -= d * 14.0 * uDt;
  v *= exp(-5.0 * uDt);
  d += v * uDt;

  outDisp = vec4(d, v);
}
`;

// ------------------------------------------------------------------ pass 2: cubes
export const CUBE_VERT = /* glsl */ `
precision highp float;

in vec3 position;
in vec3 normal;
in vec2 cell;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform sampler2D tMorph;
uniform sampler2D tAttr;
uniform sampler2D tDisp;
uniform float uVoxel;
uniform float uTime;
uniform float uMotion;

out vec3 vNormal;
out vec3 vLocal;
out vec4 vShade;   // ao, baked key light, albedo, dissolve

${COMMON}

mat3 axisAngle(vec3 axis, float angle) {
  float s = sin(angle), c = cos(angle), oc = 1.0 - c;
  return mat3(
    oc * axis.x * axis.x + c,          oc * axis.x * axis.y + axis.z * s, oc * axis.z * axis.x - axis.y * s,
    oc * axis.x * axis.y - axis.z * s, oc * axis.y * axis.y + c,          oc * axis.y * axis.z + axis.x * s,
    oc * axis.z * axis.x + axis.y * s, oc * axis.y * axis.z - axis.x * s, oc * axis.z * axis.z + c
  );
}

void main() {
  vec4 m = texture(tMorph, cell);
  vec4 attr = texture(tAttr, cell);
  vec4 seed = hash4(cell * 1024.0 + 13.7);
  float td = m.w;

  // Pinned cubes stay axis aligned; released ones tumble.
  vec3 axis = normalize(seed.xyz * 2.0 - 1.0 + vec3(1e-4));
  float angle = td * (seed.w * TAU + uTime * (0.25 + 0.6 * seed.z) * (seed.x > 0.5 ? 1.0 : -1.0) * uMotion);
  mat3 rot = axisAngle(axis, angle);

  vec3 centre = m.xyz + vec3(texture(tDisp, cell).xy, 0.0);
  vec3 local = rot * (position * uVoxel * attr.b);
  vec4 world = modelMatrix * vec4(centre + local, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;

  vNormal = rot * normal;
  vLocal = position;
  vShade = vec4(attr.r, attr.g, attr.a, td);
}
`;

export const CUBE_FRAG = /* glsl */ `
precision highp float;

in vec3 vNormal;
in vec3 vLocal;
in vec4 vShade;

uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec3 uSky;
uniform vec3 uGround;

out vec4 fragColor;

void main() {
  vec3 n = normalize(vNormal);
  float ao = vShade.x;
  float vis = vShade.y;

  vec3 ambient = mix(uGround, uSky, n.y * 0.5 + 0.5) * (0.35 + 0.65 * ao);
  // vis is the baked surface diffuse; the cube's own face orientation only darkens
  // its underside and sides so the lattice gaps read.
  vec3 key = uKeyColor * vis * (0.3 + 0.9 * max(dot(n, uKeyDir), 0.0));

  // Soft bevel: darken toward the cube edges using the two non-face coordinates.
  vec3 q = abs(vLocal) * 2.0;
  float hi = max(q.x, max(q.y, q.z));
  float lo = min(q.x, min(q.y, q.z));
  float edge = q.x + q.y + q.z - hi - lo;
  float bevel = 1.0 - 0.38 * smoothstep(0.62, 1.0, edge);

  // Released cubes catch more light, like the bright drifting cubes in the photo.
  vec3 col = vShade.z * (ambient + key) * bevel * (1.0 + 0.3 * vShade.w);
  fragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------ pass 3: rig blur (verbatim)
export const BLUR_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D tInput;
uniform vec2 uStep;
out vec4 fragColor;
void main() {
  vec4 sum = texture(tInput, vUv) * 0.2270270270;
  sum += texture(tInput, vUv + uStep * 1.3846153846) * 0.3162162162;
  sum += texture(tInput, vUv - uStep * 1.3846153846) * 0.3162162162;
  sum += texture(tInput, vUv + uStep * 3.2307692308) * 0.0702702703;
  sum += texture(tInput, vUv - uStep * 3.2307692308) * 0.0702702703;
  fragColor = sum;
}
`;

// ------------------------------------------------------------------ pass 3a/4: lens
// Circle of confusion from the scene depth. The rig blurred the whole frame for glow;
// here the blur input is pre-weighted by CoC, so a sharp head does not smear into a
// halo while out-of-focus cubes still spread into soft bokeh.
const LENS = /* glsl */ `
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uDof;
uniform float uAspect;

float viewDepth(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}

float cocAt(vec2 uv) {
  float depth = texture(tDepth, uv).x;
  if (depth >= 1.0) return 1.0;
  float coc = clamp(abs(viewDepth(depth) - uFocus) * 0.9 - 0.08, 0.0, 1.0);
  // Lens falloff: the frame edges go soft even near the focal plane, as in the photo.
  vec2 dir = uv - 0.5;
  coc += smoothstep(0.35, 0.95, length(dir * vec2(uAspect, 1.0)) * 1.25) * 0.55;
  return clamp(coc, 0.0, 1.0) * uDof;
}
`;

export const COC_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D tScene;
out vec4 fragColor;
${LENS}
void main() {
  fragColor = texture(tScene, vUv) * cocAt(vUv);
}
`;

// Rig composite (chromatic split + glow under the scene alpha), with the lens mix and
// the backdrop added.
export const COMP_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;

uniform sampler2D tScene;
uniform sampler2D tBlurNear;
uniform sampler2D tBlurFar;
uniform float uGlow;
uniform vec2 uAberration;
uniform vec3 uBgInner;
uniform vec3 uBgOuter;

out vec4 fragColor;
${LENS}

void main() {
  vec2 dir = vUv - 0.5;
  vec2 shift = dir * uAberration;
  vec4 r = texture(tScene, vUv + shift);
  vec4 g = texture(tScene, vUv);
  vec4 b = texture(tScene, vUv - shift);
  vec4 scene = vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a));

  float coc = cocAt(vUv);
  vec4 nearW = texture(tBlurNear, vUv);
  vec4 farW = texture(tBlurFar, vUv);
  vec4 lens = scene * (1.0 - coc) + mix(nearW, farW, smoothstep(0.2, 0.9, coc));
  lens.a = min(lens.a, 1.0);

  float vig = smoothstep(1.05, 0.15, length(dir * vec2(uAspect * 0.8, 1.0)));
  vec3 bg = mix(uBgOuter, uBgInner, vig);
  vec4 glow = farW * uGlow * (1.0 - lens.a);
  vec3 col = bg * (1.0 - lens.a) + lens.rgb + glow.rgb;
  fragColor = vec4(col, 1.0);
}
`;
