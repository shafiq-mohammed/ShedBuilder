# ShedBuilder

A Bridge Builder-style 2D physics game for DIYers learning how common lumber
(2×4 through 2×10, 4×4 and 4×6 posts/headers, LVL beams, plywood sheathing) behaves in shed framing.

Build each face of a shed — walls, roof truss, floor deck — from real lumber
sizes, then hit **Test** and watch every stick color itself green → yellow → red
by stress, and snap when overloaded.

**Play it now:** https://shafiq-mohammed.github.io/ShedBuilder/

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5199
```

## How to play

1. Pick a face along the top: four walls and the roof truss are elevations;
   **Roof plan** and **Floor plan** are top-down layouts (purlins & roof
   bracing across the truss tops; joists and rims on the slab). Plan views
   are tested in 3D — the Test button takes you there.
2. Pick lumber on the left (keys 1–5), then click-drag between grid dots to
   place a stick. Hold **Shift** to chain sticks. Right-click erases.
   Grid cells are 6 inches.
3. `P` = sheathing panel tool (drag a rectangle whose corners land on lumber —
   panels stop walls from racking).
4. Pick joint fastening in the palette: 🔨 toe-nails (cheap, pull out ~450 lb)
   or 🔩 hangers & brackets (~1500 lb, $1.50/joint). Hanging storage and wind
   uplift will find your weak joints. Nailed joints also carry a small moment
   before yielding — an unbraced frame stands and shrugs off a dropped brick,
   but still racks over in a storm. Bracing is for storms, not for standing.
5. 📐 **Size** sets the shed footprint and wall height (8-24' x 6-16', walls
   6-12') — every view, the truss span, and the 3D assembly follow.
6. Hit **▶ Test it** (Space) and pick a load:
   - ⚖️ **Self-weight** — does it hold itself up?
   - ❄️ **Snow** — ramps to 40 psf on the roof line
   - 🚶 **Person** — a 200 lb worker walks across the top
   - 💨 **Wind** — gusts to ~15 psf pushing on a wall
   - 🪝 **Hang storage** — click joints to hang 50–250 lb weights
   - 🧱 **Bricks** — click to drop 100/200/500/1000 lb bricks
7. `S` = slow motion, `R` = reset test, `Esc` = back to building. 2D tests
   are bench tests — one face alone; the assembled building tests in 3D.
8. 🧊 **3D** assembles everything into an orbitable shed (the roof truss is
   raised 5x at 2' on-center; the plan views map straight in) — then hit
   **▶ Test in 3D** to physics-simulate the whole building at once: snow over
   the entire roof, wind on the front wall, bricks dropped anywhere you click.
   Every connection is real: trusses bear on wall top plates, purlins nail to
   the rafters they cross, corners tie together. No walls under the roof and
   it falls; delete the roof bracing and the whole roof plane rotates off its
   bearings — like real framing before sheathing.

## What it teaches

- Long unsupported spans sag and break — shorten the span or size up the joist.
- A 4×4 is a **post**, not a beam: great in compression, mediocre in bending.
- A 2×10 is ~18× stiffer in bending than a 2×4 for only ~3× the price.
- Un-braced rectangular frames rack in the wind — diagonals and sheathing fix it.
- Triangles are your friend (roof trusses work for a reason).

The numbers are "game-real": stiffness/strength ratios come from actual dressed
lumber section properties, loads are displayed in honest pounds, but everything
is globally tuned for clear feedback rather than code compliance. The 3D sim
treats members as bending isotropically at strong-axis stiffness (torsion and
weak-axis orientation are ignored). **Do not use this to engineer an actual
building.**

## Tech

Vite + TypeScript, vanilla DOM, Canvas 2D. Physics is XPBD (position-based
dynamics) on Verlet particles: each stick subdivides into ~1 ft segments with
axial + bend constraints, so sag, buckling, and span sensitivity emerge
naturally. `npm test` runs physics sanity checks (strain ≈ F/EA, stiffness
ratios, breakage thresholds).

Designs autosave to localStorage; ⇩/⇧ export/import JSON files.
