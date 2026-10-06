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
| `diagnose_render_multi_angle.py` | not degenerate | **Also not meaningful.** Foreground area is ≈ 0.999 of every frame because the cloud fills it. The orbit renders themselves (read back) show a closed 3D head, not a billboard. |

The silhouette gates assume one isolated object on a plain backdrop. A frame that is mostly
particle cloud is outside what they measure, so their passes are not claimed. Divine Eye's round 2
pass rests only on its soft signals, and by 0.0005, so treat it as "at target", not "comfortably
past it".

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

## AI-vision review (agent, against the local comparison sheet)

Global semantic score: **0.74** (round 1: 0.72), a stylized match.

| Feature | Score | Notes |
| --- | --- | --- |
| Composition and framing | 0.80 | Head centred and the same size; crown about 8% from the top, chin at about 80%. |
| Pin-art voxel surface | 0.72 | Regular cube lattice with continuous depth and random recesses reads as in the photo. The photo's speckle (random dark gaps) is denser. |
| Facial features | 0.70 | Eye sockets, brow, nose and nose shadow read well. Round 2: the mouth is closed and neutral (it read as a grin before). The photo's mouth region is still darker overall. |
| Silhouette dissolve and cloud | 0.68 | The rim crumbles first and the face front holds, as in the photo. The photo's halo is denser and whiter right at the head, and its far background is cleaner and darker. |
| Palette and lighting | 0.75 | Slate backdrop, white cubes and blue-grey shadow match. Lighting comes from above. |

## What still differs

- The cloud halo is less dense close to the head; the far field is greyer.
- The elder preset's mouth keeps a faint upturn.
- Cube speckle is more regular than in the photo.
- The back of the head is inferred: a single front view cannot show it.
- This is a stylized design recreation, not a likeness of a particular person.
