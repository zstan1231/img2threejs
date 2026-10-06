# Particle voxel head

A code-only Three.js recreation of a "dissolving voxel head" design: a human head built from
pin-art cubes. The silhouette crumbles into a drifting cloud of cubes under depth of field. The
motion runs on the shaders of the **Particle Morph Rig**: its noise, curl advection, staged
`morphAt` transition, pointer spring, blur and composite, ported to Three.js
`RawShaderMaterial`.

No meshes, textures or art packs are loaded. Every head is a signed distance field written in
`src/heads.js` and sampled into cubes at runtime.

## Run

```bash
# development (Three.js 0.185.1 from jsDelivr through the import map)
python3 -m http.server 8000   # from this folder, then open http://127.0.0.1:8000/

# one self-contained offline file (Three.js embedded, opens from disk)
npm i --prefix /tmp/three-dl three@0.185.1
node build_offline.mjs --three /tmp/three-dl/node_modules/three --out particle-voxel-head.offline.html
```

Served over HTTP, heads are sampled in a Web Worker. Opened from `file://`, Chromium refuses
blob workers on the opaque origin, so the page samples on the main thread instead: about a 1 s
pause the first time each head is shown.

Checks:

```bash
node check_heads.mjs                      # generator: determinism, counts, finite cell data
npm i --prefix /tmp/pw playwright-core    # then, with the page served locally:
node capture.mjs --modules /tmp/pw --url http://127.0.0.1:8000/particle-voxel-head.offline.html \
  --out-dir evidence --chromium /path/to/chromium
```

Controls:
- Drag to orbit; double-click to reset the view.
- Move the pointer to push cubes; they spring back.
- The panel picks a head (five presets, or a seeded random face).
- Sliders set the dissolve amount, the ambient life of the free cloud (`uAmbient`), the rig uniforms (`uChaos`, `uDispersion`, `uMotion`, `uGlow`) and depth of field.
- With "cycle heads" on, the page morphs through the heads every 12 s, passing through the curl field.

## How it is built

| Stage | File | What it does |
| --- | --- | --- |
| Head SDF | `src/heads.js` | Smooth-unioned ellipsoids and capsules: cranium, face, jaw, cheekbones, brow, carved sockets with closed lids, nose bridge, tip and alae, lips wrapped around the dental arch (cupid's bow, philtrum, an upper lip overhanging a set-back lower lip so the closed mouth reads at 2–3 cubes tall), ears, neck. All presets and random faces are parameter sets over one field. |
| Pin-art sampling | `src/heads.js` | Rays on a regular lattice along ±x, ±y, ±z. The front lattice owns every front-visible surface, so the face is one uninterrupted grid of columns with continuous depth, plus random recesses. AO and a soft-shadowed surface diffuse term are baked per cube. Runs in a Web Worker (~1 s per head), or on the main thread from `file://`. |
| Cell layout | `src/heads.js` | Cubes are Morton-ordered so a morph maps forehead to forehead. They are spread over the 224×224 particle cells; the free cells become the cloud. Each cube gets a scatter target outward and sideways from its surface. |
| 1a morph | `MORPH_FRAG` | The rig's `morphAt` (head A → head B, curl advection, bow, orbit, idle drift), extended to 3D, followed by a second staged transition: dissolve into the cloud. Free cubes then stream out along their own lanes, rising and fading at the far end, on a slow two-octave curl current (`uAmbient`), while pinned cubes hold still. |
| 1b spring | `SIM_FRAG` | The rig's pointer spring integrator, unchanged apart from reading the morph result. |
| 2 cubes | `CUBE_VERT/FRAG` | One instanced box per cell. Pinned cubes stay axis-aligned; released ones tumble. Hemisphere ambient × AO + baked key, with a bevel darkening at the edges. |
| 3 lens | `COC_FRAG`, `BLUR_FRAG` | A CoC-weighted copy of the frame, blurred with the rig's 5-tap separable blur at half and quarter resolution. |
| 4 composite | `COMP_FRAG` | The rig's chromatic split and glow, plus the depth-of-field mix and the slate backdrop. |

### What changed relative to the rig shaders

- **Verbatim:** `hash4`, `vnoise`, `curl`, the quad vertex shader, the blur, and the spring integrator.
- **`morphAt`:** works on `vec3` cube positions. Curl advection stays in the screen plane; depth rides along and swells mid-flight. The `depth` peel input is the baked surface "forwardness" rather than image luminance. Idle drift applies mid-morph only, so a resting face holds still.
- **New:** the dissolve stage, the ambient stream and current, the CoC pre-pass, the depth-of-field composite, and the cube shaders.

## Review evidence and its limits

`capture.mjs` drives the page through the repo's `__IMG2THREEJS_CAPTURE__` contract with a
frozen clock (`setState`, `setCamera`). `evidence/` holds:
- the fixed reference view and orbit views;
- intact and scattered states;
- the four other presets;
- a side-by-side sheet against the reference, plus the `diagnose_render.py` and `divine_eye.py` outputs.

This is a **stylized design recreation, not a likeness**: the reference photo shows an anonymous
rendered head, and the procedural head matches its layout and proportions, not a specific face.
The single reference only shows the front, so the back of the head is inferred. The
deterministic silhouette gates assume one foreground object on a plain background; a frame that
is mostly particle cloud is outside what they measure, which `evidence/REVIEW.md` reports
rather than hides.
