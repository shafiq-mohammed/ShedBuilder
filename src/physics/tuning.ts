/**
 * All game-feel physics constants in one place.
 * Units: feet and lbf. Weights are stored in lb for display, but inverse
 * masses are computed in slugs (w = g / lb) so that gravity force = weight in
 * lbf and every applied force / stiffness value is a consistent lbf quantity.
 */
export const TUNE = {
  GRAVITY: 32.174,          // ft/s^2
  SUBSTEPS: 16,             // XPBD small-steps: substeps beat iterations
  ITERS: 3,                 // constraint iterations per substep
  DAMP: 0.9985,             // velocity damping per substep
  SETTLE_TIME: 0.6,         // s of gravity-only settling before a scenario starts
  SETTLE_DAMP: 0.9,         // stronger damping during settle so the frame calms fast

  // Lumber global scale (relative stats in lumber.ts multiply these)
  EA_BASE: 3.0e5,           // lbf, axial stiffness of a 2x4
  EI_BASE: 6.0e3,           // lbf*ft^2, bending stiffness of a 2x4 (game-soft so
                            // beams visibly bow before breaking)
  AXIAL_CAP_STRAIN: 0.0075,  // strain at which a 2x4 reaches 100% axial stress
  KAPPA_CAP: 0.12,          // rad/ft curvature at 100% bend stress for a 2x4
                            // -> a 12 ft 2x4 breaks near a 200 lb midspan load

  // Sheathing panels
  PANEL_EA: 6.0e5,          // lbf along each diagonal
  PANEL_CAP_STRAIN: 0.009,
  PANEL_MASS_PSF: 1.4,      // lb/ft^2 (15/32" ply)

  // Damage / breakage
  DMG_RATE: 5,              // damage/sec per unit of overstress (stress-1)

  // Joint connection pull-out capacity (tension in a member-end, lbf).
  // Compression bears wood-on-wood and never fails.
  CONN_CAP_NAILS: 450,      // 2-3 toe-nails
  CONN_CAP_HARDWARE: 1500,  // joist hanger / rafter tie / bracket
  MIN_PART_MASS: 2.5,       // lb, numerical floor (feather-light nodes take huge
                            // ballistic substeps under point loads -> fake strain)

  SEG_TARGET_FT: 1.0,       // subdivision target length
  MAX_STICK_FT: 16,

  // Collision
  GROUND_FRICTION: 0.5,
  // friction factors are applied per contact PER ITERATION (SUBSTEPS*ITERS
  // times a frame), so they must be small: 0.09 ~ brick stops in ~1 frame
  HEAVY_FRICTION: 0.09,
  PERSON_FRICTION: 0.008,
  CONTACT_ALPHA: 4e-5,      // ft/lbf contact compliance (springy pads) so
                            // heavy contacts push instead of hammering
  FREEZE_BELOW: 40,         // ft below ground -> stop simulating
};
