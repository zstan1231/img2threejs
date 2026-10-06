// Particle voxel head: a procedural head of pin-art cubes that dissolves into a drifting
// cube cloud, driven by the Particle Morph Rig's shaders running in Three.js.
//
// Passes per frame (the rig's four, with the morph split out of the vertex shader):
//   1a morph   N×N MRT: rig morphAt (head A → head B) + dissolve into the cloud
//   1b sim     N×N ping-pong: rig pointer spring displacement
//   2  cubes   instanced boxes, one per cell, into an MSAA scene target with depth
//   3  blur    rig separable blur, half and quarter resolution
//   4  comp    rig chromatic split + glow, plus depth of field and the backdrop

import * as THREE from 'three';
import { N, CELLS, SPACING, KEY_DIR, PRESETS, resolveParams, randomParams, sampleHead, layoutCells } from './heads.js';
import { QUAD_VERT, MORPH_FRAG, SIM_FRAG, CUBE_VERT, CUBE_FRAG, BLUR_FRAG, COC_FRAG, COMP_FRAG } from './shaders.js';

const $ = (id) => document.getElementById(id);
const status = $('status');

// ------------------------------------------------------------------ head worker
// Sampling a head marches ~60k rays through the SDF (~1 s), so it runs off-thread.
// The worker is built from heads.js itself: inline text in the offline build, fetched
// next to this module otherwise.
async function headsSource() {
  const inline = document.getElementById('heads-src');
  if (inline) return inline.textContent;
  return (await fetch(new URL('./heads.js', import.meta.url))).text();
}
const WORKER_GLUE = `
self.onmessage = (e) => {
  const { id, preset, random } = e.data;
  const P = random !== undefined ? { ...resolveParams('reference'), ...randomParams(random) } : resolveParams(preset);
  const head = sampleHead(P);
  const cells = layoutCells(head);
  self.postMessage({ id, ...cells }, [cells.home.buffer, cells.scatter.buffer, cells.attr.buffer]);
};`;
// A page opened from file:// has an opaque origin and Chromium refuses to start a blob
// worker there; heads are then sampled on the main thread (a ~1 s stall per head).
let worker = null;
try {
  worker = new Worker(
    URL.createObjectURL(new Blob([(await headsSource()) + WORKER_GLUE], { type: 'text/javascript' })),
    { type: 'module' },
  );
} catch { worker = null; }
const pending = new Map();
let jobId = 0;
function sampleHere({ id, preset, random }) {
  const P = random !== undefined ? { ...resolveParams('reference'), ...randomParams(random) } : resolveParams(preset);
  return { id, ...layoutCells(sampleHead(P)) };
}
function useMainThread() {
  worker = null;
  for (const [id, job] of pending) setTimeout(() => { job.resolve(sampleHere({ id, ...job.msg })); pending.delete(id); }, 30);
}
if (worker) {
  worker.onmessage = (e) => { pending.get(e.data.id)?.resolve(e.data); pending.delete(e.data.id); };
  worker.onerror = useMainThread;
}
const cache = new Map();
function requestHead(key, msg) {
  if (!cache.has(key)) {
    cache.set(key, new Promise((resolve) => {
      const id = ++jobId;
      pending.set(id, { resolve, msg });
      if (worker) worker.postMessage({ id, ...msg });
      else setTimeout(() => { pending.delete(id); resolve(sampleHere({ id, ...msg })); }, 30);
    }));
  }
  return cache.get(key);
}

// ------------------------------------------------------------------ renderer + targets
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.autoClear = false;
$('stage').appendChild(renderer.domElement);

function dataTex(data) {
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
function cellTarget(count = 1) {
  return new THREE.WebGLRenderTarget(N, N, {
    count, type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false,
  });
}
const morphRT = cellTarget(2);
const dispRT = [cellTarget(), cellTarget()];
let dispCur = 0;

let sceneRT, blurRT = [];
function screenTarget(w, h, depth) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: !!depth, samples: depth ? 4 : 0,
  });
  if (depth) rt.depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
  return rt;
}

// ------------------------------------------------------------------ fullscreen passes
const quadGeo = new THREE.BufferGeometry();
quadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
quadGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
function pass(frag, uniforms) {
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: QUAD_VERT, fragmentShader: frag, uniforms,
    depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(quadGeo, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return { material, uniforms, run(target) { renderer.setRenderTarget(target); renderer.render(scene, quadCam); } };
}

const blank = dataTex(new Float32Array(CELLS * 4));
const morphU = {
  tFromPos: { value: blank }, tToPos: { value: blank },
  tFromScatter: { value: blank }, tToScatter: { value: blank },
  tFromAttr: { value: blank }, tToAttr: { value: blank },
  uProgress: { value: 0 }, uTime: { value: 0 },
  uDispersion: { value: 0.7 }, uChaos: { value: 0.55 }, uMotion: { value: 1 },
  uIdle: { value: 1 }, uIdleDrift: { value: 1 }, uIdleSpeed: { value: 0.6 },
  uDissolve: { value: 0.40 },
};
const morphPass = pass(MORPH_FRAG, morphU);
const simU = {
  tDisp: { value: null }, tMorph: { value: morphRT.textures[0] },
  uPointer: { value: new THREE.Vector2(9, 9) }, uPointerActive: { value: 0 },
  uPointerRadius: { value: 0.34 }, uPointerStrength: { value: 0.55 },
  uPointerSpeed: { value: 0 }, uDt: { value: 0.016 },
};
const simPass = pass(SIM_FRAG, simU);
const blurU = { tInput: { value: null }, uStep: { value: new THREE.Vector2() } };
const blurPass = pass(BLUR_FRAG, blurU);
const lensU = {
  tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 40 }, uFocus: { value: 4.9 },
  uDof: { value: 1 }, uAspect: { value: 1 },
};
const cocPass = pass(COC_FRAG, { ...lensU, tScene: { value: null } });
const compU = {
  ...lensU,
  tScene: { value: null }, tBlurNear: { value: null }, tBlurFar: { value: null },
  uGlow: { value: 0.22 }, uAberration: { value: new THREE.Vector2(0.0022, 0.0022) },
  uBgInner: { value: new THREE.Color(0.155, 0.225, 0.270) },
  uBgOuter: { value: new THREE.Color(0.122, 0.188, 0.232) },
};
const compPass = pass(COMP_FRAG, compU);

// ------------------------------------------------------------------ instanced cubes
const box = new THREE.BoxGeometry(1, 1, 1);
const geo = new THREE.InstancedBufferGeometry();
geo.index = box.index;
geo.setAttribute('position', box.getAttribute('position'));
geo.setAttribute('normal', box.getAttribute('normal'));
const cells = new Float32Array(CELLS * 2);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const k = (y * N + x) * 2;
  cells[k] = (x + 0.5) / N; cells[k + 1] = (y + 0.5) / N;
}
geo.setAttribute('cell', new THREE.InstancedBufferAttribute(cells, 2));
geo.instanceCount = CELLS;

const cubeU = {
  tMorph: { value: morphRT.textures[0] }, tAttr: { value: morphRT.textures[1] }, tDisp: { value: null },
  uVoxel: { value: SPACING }, uTime: { value: 0 }, uMotion: { value: 1 },
  uKeyDir: { value: new THREE.Vector3(...KEY_DIR) },
  uKeyColor: { value: new THREE.Color(0.86, 0.86, 0.84) },
  uSky: { value: new THREE.Color(0.36, 0.46, 0.52) },
  uGround: { value: new THREE.Color(0.07, 0.11, 0.14) },
};
const cubes = new THREE.Mesh(geo, new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3, vertexShader: CUBE_VERT, fragmentShader: CUBE_FRAG, uniforms: cubeU,
}));
cubes.frustumCulled = false;
const scene = new THREE.Scene();
scene.add(cubes);

// ------------------------------------------------------------------ camera + orbit
const TARGET = new THREE.Vector3(0, -0.06, 0);
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
const view = { az: 0, el: 0, dist: 5.6, azGoal: 0, elGoal: 0 };
function placeCamera() {
  const a = THREE.MathUtils.degToRad(view.az), e = THREE.MathUtils.degToRad(view.el);
  camera.position.set(
    TARGET.x + view.dist * Math.sin(a) * Math.cos(e),
    TARGET.y + view.dist * Math.sin(e),
    TARGET.z + view.dist * Math.cos(a) * Math.cos(e),
  );
  camera.lookAt(TARGET);
  camera.updateMatrixWorld();
}

function resize() {
  const w = innerWidth, h = innerHeight, dpr = renderer.getPixelRatio();
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + 'px';
  renderer.domElement.style.height = h + 'px';
  camera.aspect = w / h;
  // Keep the head the same size on portrait screens by backing the camera off.
  view.dist = 5.6 * Math.max(1, 1.2 / camera.aspect);
  camera.updateProjectionMatrix();
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  sceneRT?.dispose(); blurRT.forEach((t) => t.dispose());
  sceneRT = screenTarget(W, H, true);
  blurRT = [
    screenTarget(W >> 1, H >> 1), screenTarget(W >> 1, H >> 1), screenTarget(W >> 1, H >> 1),
    screenTarget(W >> 2, H >> 2), screenTarget(W >> 2, H >> 2),
  ];
  lensU.uAspect.value = camera.aspect;
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ shape switching
const shapes = { from: null, to: null };
const morph = { active: false, start: 0, duration: 3.4, queued: null };
function bindShape(slot, data) {
  const old = shapes[slot];
  shapes[slot] = { pos: dataTex(data.home), scatter: dataTex(data.scatter), attr: dataTex(data.attr), voxels: data.voxelCount };
  if (old && old !== shapes.from && old !== shapes.to) { old.pos.dispose(); old.scatter.dispose(); old.attr.dispose(); }
  rebind();
}
function rebind() {
  for (const [slot, cap] of [['from', 'From'], ['to', 'To']]) {
    const s = shapes[slot];
    if (!s) continue;
    morphU['t' + cap + 'Pos'].value = s.pos;
    morphU['t' + cap + 'Scatter'].value = s.scatter;
    morphU['t' + cap + 'Attr'].value = s.attr;
  }
}
let currentKey = 'reference';
async function goTo(key, msg) {
  if (morph.active) { morph.queued = [key, msg]; return; }
  status.textContent = 'sculpting ' + (PRESETS[key]?.label || 'random face') + '…';
  const data = await requestHead(key, msg);
  status.textContent = '';
  bindShape('to', data);
  morph.active = true;
  morph.start = clock;
  currentKey = key;
  $('preset').value = PRESETS[key] ? key : 'random';
}
function finishMorph() {
  // Promote B to A by swapping the texture sets; the next morph starts from here.
  [shapes.from, shapes.to] = [shapes.to, shapes.from];
  rebind();
  morphU.uProgress.value = 0;
  morph.active = false;
  if (morph.queued) { const q = morph.queued; morph.queued = null; goTo(...q); }
}

// ------------------------------------------------------------------ UI
const ui = {
  dissolve: $('dissolve'), chaos: $('chaos'), disp: $('disp'), mot: $('mot'), glow: $('glow'), dof: $('dof'),
  breathe: $('breathe'), cycle: $('cycle'),
};
const outIds = { dissolve: 'vDs', chaos: 'vC', disp: 'vD', mot: 'vM', glow: 'vG', dof: 'vF' };
function syncUI() { for (const k in outIds) $(outIds[k]).textContent = (+ui[k].value).toFixed(2); }
for (const k in outIds) ui[k].addEventListener('input', () => { if (k === 'dissolve') ui.breathe.checked = false; syncUI(); });
if (matchMedia('(prefers-reduced-motion: reduce)').matches) { ui.breathe.checked = false; ui.cycle.checked = false; }
syncUI();

const presetSel = $('preset');
for (const [key, p] of Object.entries(PRESETS)) presetSel.add(new Option(p.label, key));
presetSel.add(new Option('Random face', 'random'));
let randomSeed = 1;
function goRandom() {
  randomSeed = (randomSeed * 48271) % 2147483647;
  const seed = randomSeed % 100000;
  goTo('random-' + seed, { random: seed });
}
presetSel.addEventListener('change', () => { ui.cycle.checked = false; presetSel.value === 'random' ? goRandom() : goTo(presetSel.value, { preset: presetSel.value }); });
$('reroll').addEventListener('click', () => { ui.cycle.checked = false; goRandom(); });

// ------------------------------------------------------------------ pointer + orbit drag
const ptr = { x: 9, y: 9, px: 9, py: 9, active: 0, speed: 0 };
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.45);
const hit = new THREE.Vector3();
let drag = null;
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, az: view.azGoal, el: view.elGoal }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointermove', (e) => {
  if (drag) {
    view.azGoal = drag.az - (e.clientX - drag.x) * 0.3;
    view.elGoal = THREE.MathUtils.clamp(drag.el + (e.clientY - drag.y) * 0.2, -35, 35);
    return;
  }
  ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2), camera);
  plane.normal.set(Math.sin(THREE.MathUtils.degToRad(view.az)), 0, Math.cos(THREE.MathUtils.degToRad(view.az)));
  if (ray.ray.intersectPlane(plane, hit)) { ptr.x = hit.x; ptr.y = hit.y; ptr.active = 1; }
});
canvas.addEventListener('pointerleave', () => { ptr.active = 0; drag = null; });
canvas.addEventListener('dblclick', () => { view.azGoal = 0; view.elGoal = 0; });

// ------------------------------------------------------------------ frame
let clock = 0, last = performance.now(), frozen = null, cycleAt = 11, frameCount = 0;
const CYCLE = ['reference', 'broad', 'slender', 'elder', 'child', 'random'];
const smooth = (x) => x * x * (3 - 2 * x);

function frame(now) {
  const dt = frozen ? 1 / 60 : Math.min((now - last) / 1000, 0.033);
  last = now;
  clock = frozen ? frozen.time : clock + dt;

  if (!frozen) {
    view.az += (view.azGoal - view.az) * Math.min(1, dt * 6);
    view.el += (view.elGoal - view.el) * Math.min(1, dt * 6);
  }
  placeCamera();

  if (ui.breathe.checked && !frozen) {
    ui.dissolve.value = (0.40 + 0.06 * Math.sin(clock * 0.45) + 0.025 * Math.sin(clock * 1.13)).toFixed(3);
    $('vDs').textContent = (+ui.dissolve.value).toFixed(2);
  }
  if (ui.cycle.checked && !morph.active && !frozen && clock > cycleAt) {
    cycleAt = clock + 12;
    const i = (CYCLE.indexOf(PRESETS[currentKey] ? currentKey : 'random') + 1) % CYCLE.length;
    CYCLE[i] === 'random' ? goRandom() : goTo(CYCLE[i], { preset: CYCLE[i] });
  }

  let lift = 0;
  if (morph.active) {
    const p = Math.min(1, (clock - morph.start) / morph.duration);
    morphU.uProgress.value = smooth(p);
    lift = Math.sin(p * Math.PI) * 0.22; // the head opens up mid-morph
    if (p >= 1) finishMorph();
  }

  morphU.uTime.value = clock;
  morphU.uDissolve.value = Math.min(1, +ui.dissolve.value + lift);
  morphU.uChaos.value = +ui.chaos.value;
  morphU.uDispersion.value = +ui.disp.value;
  morphU.uMotion.value = +ui.mot.value;
  cubeU.uTime.value = clock;
  cubeU.uMotion.value = +ui.mot.value;
  compU.uGlow.value = +ui.glow.value;
  lensU.uDof.value = +ui.dof.value;
  lensU.uFocus.value = camera.position.distanceTo(TARGET) - 0.75;

  ptr.speed = Math.hypot(ptr.x - ptr.px, ptr.y - ptr.py) / Math.max(dt, 1e-3);
  ptr.px = ptr.x; ptr.py = ptr.y;

  // 1a morph
  morphPass.run(morphRT);
  // 1b pointer spring
  simU.tDisp.value = dispRT[dispCur].texture;
  simU.uPointer.value.set(ptr.x, ptr.y);
  simU.uPointerActive.value = frozen ? 0 : ptr.active;
  simU.uPointerSpeed.value = Math.min(ptr.speed, 3);
  simU.uDt.value = dt;
  simPass.run(dispRT[1 - dispCur]);
  dispCur = 1 - dispCur;

  // 2 cubes
  cubeU.tDisp.value = dispRT[dispCur].texture;
  renderer.setRenderTarget(sceneRT);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, false);
  renderer.render(scene, camera);

  // 3a CoC-weighted copy at half res, 3b blur: near = half res, far = quarter res
  lensU.tDepth.value = sceneRT.depthTexture;
  cocPass.uniforms.tScene.value = sceneRT.texture;
  cocPass.run(blurRT[2]);
  const W = sceneRT.width, H = sceneRT.height;
  const blur = (src, dst, sx, sy) => { blurU.tInput.value = src.texture; blurU.uStep.value.set(sx, sy); blurPass.run(dst); };
  blur(blurRT[2], blurRT[0], 2 / W, 0);
  blur(blurRT[0], blurRT[1], 0, 2 / H);
  blur(blurRT[1], blurRT[3], 4 / W, 0);
  blur(blurRT[3], blurRT[4], 0, 4 / H);
  blur(blurRT[4], blurRT[3], 9 / W, 0);
  blur(blurRT[3], blurRT[4], 0, 9 / H);

  // 4 composite
  compU.tScene.value = sceneRT.texture;
  compU.tBlurNear.value = blurRT[1].texture;
  compU.tBlurFar.value = blurRT[4].texture;
  compPass.run(null);

  frameCount++;
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ boot
status.textContent = 'sculpting reference head…';
const first = await requestHead('reference', { preset: 'reference' });
bindShape('from', first);
bindShape('to', first);
status.textContent = '';
requestAnimationFrame(frame);
// Warm the other presets in the background so the first cycle does not stall.
if (worker) for (const key of Object.keys(PRESETS)) requestHead(key, { preset: key });

// ------------------------------------------------------------------ capture contract
// scripts/capture_threejs_playwright.py drives these: a fixed clock, no pointer, and
// a camera given as azimuth/elevation in degrees around the head.
const waitFrames = (n) => new Promise((resolve) => {
  const start = frameCount;
  const tick = () => (frameCount - start >= n ? resolve() : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
});
window.__IMG2THREEJS_CAPTURE__ = {
  async setState({ time = 6, dissolve, preset, chaos, dof } = {}) {
    ui.breathe.checked = false; ui.cycle.checked = false;
    document.body.classList.add('capture'); // review frames show the render only
    frozen = { time };
    if (dissolve !== undefined) ui.dissolve.value = dissolve;
    if (chaos !== undefined) ui.chaos.value = chaos;
    if (dof !== undefined) ui.dof.value = dof;
    syncUI();
    if (preset && preset !== currentKey) {
      const data = await requestHead(preset, { preset });
      bindShape('from', data); bindShape('to', data); currentKey = preset;
    }
    await waitFrames(3);
    return { ok: true, preset: currentKey, voxels: shapes.from.voxels };
  },
  async setCamera(spec = {}) {
    if (!frozen) await this.setState({});
    view.az = view.azGoal = +(spec.azimuthDegrees ?? 0);
    view.el = view.elGoal = +(spec.elevationDegrees ?? 0);
    await waitFrames(3);
    return { ok: true };
  },
  stats: () => ({ cells: CELLS, voxels: shapes.from?.voxels ?? 0, preset: currentKey, frozen: !!frozen }),
};
window.__IMG2THREEJS_READY__ = true;
