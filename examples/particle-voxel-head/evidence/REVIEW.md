# Review: particle voxel head vs. the reference photo

## Captures

- **Source:** `../capture.mjs` against the offline build, through `__IMG2THREEJS_CAPTURE__`.
- **Renderer:** headless Chromium 1194 with ANGLE on SwiftShader (software GL). No page errors.
- **Frames:** 1200×900, clock frozen at t = 6 s, pointer inactive.
- **Files:** saved as JPEG q90, all read back and visually checked. `captures.json` has the full record.

| View | Camera (az/el) | Dissolve | Purpose |
| --- | --- | --- | --- |
| `hero` | 0° / 0° | 0.40 (default) | fixed reference view |
| `hero-t9` | 0° / 0° | 0.40 | same view 3 s later: ambient cloud motion |
| `attention` | 0° / 0° | 0.40 | head turned 20° yaw, 6° up, toward the viewer's pointer |
| `pulse` | 0° / 0° | 0.40 | thought pulse 0.55 s after leaving the brow |
| `orbit-plus35`, `orbit-minus35` | ±35° / 0°, 5° | 0.40 | orbit views |
| `profile-intact` | 80° / 0° | 0.00 | full 3D form, nothing released |
| `hero-intact`, `hero-scattered` | 0° / 0° | 0.00 / 0.72 | dissolve range |
| `preset-*` | various | 0.40 | broad, slender, elder, child heads |

The reference photo is a user-supplied, watermarked stock image. It is **not committed**. The
side-by-side sheet (`make_comparison_sheet.py`) was produced and inspected locally in `local/`,
which is git-ignored.

## Deterministic gates (hero view)

| Gate | Result | What it actually tells us |
| --- | --- | --- |
| `diagnose_render.py` (round 1) | `passed: true`, IoU 0.9987 | **Not meaningful here.** Both masks report "not clearly isolated from background" and fall back to most of the frame. The silhouette numbers compare two near-full-frame masks. |
| `diagnose_render.py` (round 2) | `passed: true`, IoU 0.9995 | Same caveat: degenerate masks. |
| `divine_eye.py` (round 2) | **pass**, fidelity **0.8505** (target 0.85) | A marginal pass. SSIM 0.728, pHash 0.719, edge overlap 0.733, tonal parity 0.828, objectness 0.892. Hard gates are vacuous for the same mask reason. Round 1 scored 0.8455 (reject). |
| `divine_eye.py` (round 3, current) | **reject → refine-code**, fidelity **0.8488** (target 0.85) | pHash 0.688 (was 0.719), SSIM 0.724, edge overlap 0.738, tonal parity 0.823, objectness 0.893. The anatomy pass in round 3 moved the face away from the photo's smooth, generic head on purpose (user direction: "too three.js"), which costs 0.0017. Not tuned back. |
| `diagnose_render_multi_angle.py` | not degenerate | **Also not meaningful.** Foreground area is ≈ 0.999 of every frame because the cloud fills it. The orbit renders themselves (read back) show a closed 3D head, not a billboard. |

The silhouette gates assume one isolated object on a plain backdrop. A frame that is mostly
particle cloud is outside what they measure, so their passes are not claimed. Divine Eye's round 2
pass rested only on its soft signals, and by 0.0005. Round 3 sits 0.0012 under. Both are "at
target" within noise; neither is a clear pass or a clear fail.

## Correction loop, round 1 (2 of 3 allowed)

| Iteration | Change | Divine Eye fidelity |
| --- | --- | --- |
| initial | first complete build | 0.841 |
| refine-code 1 | stronger random pin recess; smaller, closer, more numerous cloud cubes; softer mouth | **0.846** (kept) |
| refine-code 2 | all cloud cells shown, brighter released cubes, more glow, smaller chin | 0.838, reverted |

The second correction made the frame brighter and busier and lowered tonal parity, so it was
reverted. The score has plateaued about 0.005 under target. Further tuning would be fitting a
64×64 luma metric rather than the design, so the loop stops here, at **request-input**.

## Round 2 (user feedback: mouths, more ambient life)

- **Mouths:** lips now wrap the dental arch (depth falls off with x²), with a cupid's bow,
  a philtrum groove, and an upper lip overhanging a shorter, set-back lower lip. The mouth line
  is half a cube tall so the lattice resolves it, and the corners dimple in. A crop comparison
  across all five heads showed the flat slab and grin gone. The elder head keeps a faint
  upturn from its deeper nasolabial folds.
- **Ambient life (`uAmbient`, default 0.7):** free cubes stream out along per-cube lanes,
  rising and fading at the far end, on a two-octave curl current; pinned cubes hold still.
  Between `hero` (t = 6 s) and `hero-t9` (t = 9 s), the mean absolute pixel difference is 19.1
  over the cloud at the frame sides against 12.7 over the face centre (that region also holds
  released rim cubes). The difference heatmap is dark over the head and bright over the cloud.

## Round 3 (user feedback: faces "too three.js"; add attention and thought pulses)

- **Anatomy:**
  - Bone planes: cheekbone ridges, jaw corners, hollow temples.
  - Brows split over a lower glabella.
  - Eyes: eyelid creases and under-eye hollows.
  - Nostrils; malar pads and nasolabial folds; a chin pad under a mentolabial groove.
  - Seeded left/right asymmetry (eyes, brows, mouth corners).
  - Low-frequency SDF noise near the surface, about half a cube of relief.
  - Per-cube tone speckle: 7% of cubes noticeably darker.

  New preset parameters: `fold`, `temple`, `asym`, `organic` (elder is deeper, child shallower).
  Before/after crops show the egg-like skull and mannequin smoothness gone. Sampling now takes
  about 1.9 s per head (was 1 s), in the worker.
- **Attention:** the head turns about the neck toward the pointer (critically damped spring,
  ω = 1.7, at most 24° yaw and 12° pitch). It holds for 2.5 s after the pointer stops, then
  settles back. The free cloud follows 35% of the turn. The first movement after 4 s of quiet
  fires a pulse from between the eyes. A live run (real mouse moves in headless Chromium)
  showed the head turned up-right toward the pointer, with no page errors.
- **Thought pulses:** a ring of light (0.8 units/s, about 3 s life) rolls over the pinned cubes
  from the brow, a temple, the crown or the eyes, every 5 to 9 s. It lifts cubes 0.024 units
  and brightens them up to 1.9×. Off under `prefers-reduced-motion`.

## AI-vision review (agent, against the local comparison sheet)

Global semantic score: **0.75** (round 1: 0.72, round 2: 0.74), a stylized match.

| Feature | Score | Notes |
| --- | --- | --- |
| Composition and framing | 0.80 | Head centred and the same size; crown about 8% from the top, chin at about 80%. |
| Pin-art voxel surface | 0.72 | Regular cube lattice with continuous depth and random recesses reads as in the photo. The photo's speckle (random dark gaps) is denser. |
| Facial features | 0.74 | Eye sockets, brow, nose and nose shadow read well. Round 2 made the mouth closed and neutral; round 3 added folds, temples, eye hollows and asymmetry, so the head reads less like a smooth primitive. The photo's mouth region is still darker overall. |
| Silhouette dissolve and cloud | 0.68 | The rim crumbles first and the face front holds, as in the photo. The photo's halo is denser and whiter right at the head, and its far background is cleaner and darker. |
| Palette and lighting | 0.75 | Slate backdrop, white cubes and blue-grey shadow match. Lighting comes from above. |

## What still differs

- The cloud halo is less dense close to the head; the far field is greyer.
- The elder preset's mouth keeps a faint upturn.
- Cube speckle is more regular than in the photo.
- The back of the head is inferred: a single front view cannot show it.
- This is a stylized design recreation, not a likeness of a particular person.
