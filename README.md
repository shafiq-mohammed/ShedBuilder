# ShedBuilder

A Bridge Builder-style 2D physics game for DIYers learning how common lumber
(2×4, 2×6, 2×8, 2×10, 4×4, plywood sheathing) behaves in shed framing.

Build each face of a shed — walls, roof truss, floor deck — from real lumber
sizes, then hit **Test** and watch every stick color itself green → yellow → red
by stress, and snap when overloaded.

## Run it

```bash
npm install
npm run dev        # http://localhost:5199
```

## How to play

1. Pick a face along the top (walls, roof truss, floor deck).
2. Pick lumber on the left (keys 1–5), then click-drag between grid dots to
   place a stick. Hold **Shift** to chain sticks. Right-click erases.
   Grid cells are 6 inches.
3. `P` = sheathing panel tool (drag a rectangle whose corners land on lumber —
   panels stop walls from racking).
4. Hit **▶ Test it** (Space) and pick a load:
   - ⚖️ **Self-weight** — does it hold itself up?
   - ❄️ **Snow** — ramps to 40 psf on the roof line
   - 🚶 **Person** — a 200 lb worker walks across the top
   - 💨 **Wind** — gusts to ~15 psf pushing on a wall
   - 🪝 **Hang storage** — click joints to hang 50–250 lb weights
   - 🧱 **Bricks** — click to drop 100/200/500/1000 lb bricks
5. `S` = slow motion, `R` = reset test, `Esc` = back to building.

## What it teaches

- Long unsupported spans sag and break — shorten the span or size up the joist.
- A 4×4 is a **post**, not a beam: great in compression, mediocre in bending.
- A 2×10 is ~18× stiffer in bending than a 2×4 for only ~3× the price.
- Un-braced rectangular frames rack in the wind — diagonals and sheathing fix it.
- Triangles are your friend (roof trusses work for a reason).

The numbers are "game-real": stiffness/strength ratios come from actual dressed
lumber section properties, loads are displayed in honest pounds, but everything
is globally tuned for clear feedback rather than code compliance. **Do not use
this to engineer an actual building.**

## Tech

Vite + TypeScript, vanilla DOM, Canvas 2D. Physics is XPBD (position-based
dynamics) on Verlet particles: each stick subdivides into ~1 ft segments with
axial + bend constraints, so sag, buckling, and span sensitivity emerge
naturally. `npm test` runs physics sanity checks (strain ≈ F/EA, stiffness
ratios, breakage thresholds).

Designs autosave to localStorage; ⇩/⇧ export/import JSON files.
