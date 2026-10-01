# Tracing a site plan or 3D scene from imagery (reference)

On-demand: read only when working on `hotel-web-fe/salim-inn/` or any Three.js scene
built from map/aerial captures. Extracted from `.claude/rules/lessons.md` on 2026-08-02
(originally the 2026-07-25 and 2026-07-25b entries) because it applies to one narrow
task and does not belong in always-loaded context.

## Debugging "what is that object in front of the camera"

`scene.traverse` reading `getWorldPosition()` **silently skips every InstancedMesh
instance** — an InstancedMesh reports its group origin, so a tent 8 m from the camera
looks 70 m away. Decompose per-instance matrices (`getMatrixAt(i, m)` +
`setFromMatrixPosition`) or the scan is worthless.

## Scale

Keep plan coordinates and heights on ONE scale. A scene that divided plan coordinates by
a map-pixel factor but left heights in raw metres extruded 3-storey shophouses into
~25-storey towers — invisible while the ground was a flat screenshot.

Measure the scale from the capture's own scale bar rather than estimating: detect the
rule row by scanning for a run of bright pixels (`ffmpeg -vf crop,format=gray -f
rawvideo`, then find the row with the widest bright span). A Google Earth capture gave
320.5 px for 40 m = 0.12481 m/px. `drawgrid=w=200:h=200` over the capture then gives a
readable coordinate frame for reading POI pins directly.

## Orientation

Orient buildings from the frontage normal via `Math.atan2(-nx, -nz)`, never from the raw
rectangle angle — the two point 180° apart.

"Left" and "right" in a user's description of a building are from the **frontage view**,
not from image or world axes. For frontage direction `d` and outward normal
`n = (d.z, -d.x)`, a viewer standing outside facing the building has their right along
`-d`, toward decreasing distance along the polyline. Verify numerically by projecting
both landmarks into camera NDC and comparing x — do not eyeball it from a render.

When a terrace bends, sweep it per-lot along the polyline with `ry = atan2(-dz, dx)` per
lot. One long rotated box cannot express a dog-leg, and the interior fitted inside it has
to inherit the local bearing too.

## Geometry gotchas

`PlaneGeometry` faces +Z, so canvas-texture signage on a facade facing local −Z needs
`rotation.y = Math.PI` or it renders backwards into the wall. After rotating a props
group, local −Z may point at the opposite building from the one intended — check which
world direction it resolves to before placing anything.

## Compositing

Any fixed/sticky UI over a WebGL `<canvas>` or 3D-transformed layer must be GPU-promoted
(`-webkit-transform: translateZ(0)`, `will-change: transform`) or Safari composites the
canvas above it and swallows the clicks regardless of `z-index`. Chromium's
`elementFromPoint` hit-tests correctly and will NOT reveal this.

## Measuring and changing frame cost (Salim Inn film, M5, 2026-10-01)

- **Resizing a WebGL canvas blocks the main thread** until every frame already queued on
  the GPU finishes. A quality step down fires when that queue is deepest: 120–190 ms
  measured, plus ~100 ms reallocating render targets from a 2× pixel ratio. At run time,
  change effects, not the pixel ratio.
- **Switching an effect's resolution or structure mid-film recompiles shaders.** N8AO
  `halfRes` cost 250–300 ms and postprocessing `MipmapBlurPass.levels` 150 ms. Disabling a
  pass costs nothing.
- **This M4 MacBook Air is fanless.** A cool start-up benchmark overstates sustained speed:
  the same film held 60 fps for two minutes, then fell to 30 fps. Other desktop apps also
  share the GPU. Idle before timing runs and record every loop, not the first.

## Flicker on buildings and roads is depth fighting (Salim Inn film, 2026-10-01)

- **A still screenshot hides it.** Two surfaces that share a depth step read as blotchy
  texture in a still and blink only when the camera moves. Even chapter 8's slow idle swing
  was enough for the owner to catch it on production. Look at motion, not stills.
- **Depth precision scales with the near plane.** One depth step is about z² / (near · 2²⁴).
  With near at altitude / 250 (0.15 m at 38 m up), a 1 cm gap 150 m away is a single step;
  from 277 m up, a 4 cm gap 800 m away is too. World.ts now sets near from the clearance
  over the ~20 m skyline, so near is 0.1 × (h − 20), with a 0.15 m floor.
  `perf/near.ts` (workshop folder) renders a depth pass at every 0.002 of the path to prove
  the near plane never cuts anything visible.
- **Layer stacked details at least 2 cm apart.** That means wall, colour panel, window pane
  and frame. Never let a slab or floor run to the same plane as a neighbour's face.
- **Find the pairs, don't guess.** In the workshop folder:
  - `perf/zfight.ts` renders a mesh-ID buffer while nudging the camera and lists the pairs
    whose IDs swap back and forth (A→B→A). Nudge 0.5 mm near street level, or a moving edge
    reads as a swap.
  - `perf/flicker.ts` maps pixels that blink and return on the real render.

