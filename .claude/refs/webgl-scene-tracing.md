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
