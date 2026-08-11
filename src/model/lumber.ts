import { TUNE } from '../physics/tuning';

export interface LumberType {
  id: string;
  label: string;
  key: string;             // keyboard shortcut
  massPerFt: number;       // lb/ft
  eaRel: number;           // axial stiffness relative to 2x4
  eiRel: number;           // strong-axis bending stiffness relative to 2x4
  axialCapRel: number;     // axial strength relative to 2x4
  bendCapRel: number;      // bending strength relative to 2x4
  costPerFt: number;       // $
  depthIn: number;         // in-plane drawn depth (dressed), inches
  thickIn: number;         // out-of-plane thickness (dressed), inches (3D view)
  color: string;
  blurb: string;
}

/**
 * Ratios derived from real dressed section properties (A drives EA, I = b*d^3/12
 * drives EI, section modulus drives bend cap), normalized to 2x4 = 1.0.
 * Magnitudes are game-tuned via TUNE.
 */
export const LUMBER: LumberType[] = [
  { id: '2x4',  label: '2×4',  key: '1', massPerFt: 1.3, eaRel: 1.00, eiRel: 1.0,
    axialCapRel: 1.00, bendCapRel: 1.0, costPerFt: 0.55, depthIn: 3.5, thickIn: 1.5,
    color: '#d9a95e', blurb: 'The all-rounder. Studs, plates, braces.' },
  { id: '2x6',  label: '2×6',  key: '2', massPerFt: 2.0, eaRel: 1.57, eiRel: 3.9,
    axialCapRel: 1.57, bendCapRel: 2.5, costPerFt: 0.85, depthIn: 5.5, thickIn: 1.5,
    color: '#d29d52', blurb: 'Stronger stud, decent rafter.' },
  { id: '2x8',  label: '2×8',  key: '3', massPerFt: 2.6, eaRel: 2.07, eiRel: 8.9,
    axialCapRel: 2.07, bendCapRel: 4.3, costPerFt: 1.25, depthIn: 7.25, thickIn: 1.5,
    color: '#c9924a', blurb: 'Rafters and joists over short spans.' },
  { id: '2x10', label: '2×10', key: '4', massPerFt: 3.4, eaRel: 2.64, eiRel: 18.5,
    axialCapRel: 2.64, bendCapRel: 7.0, costPerFt: 1.75, depthIn: 9.25, thickIn: 1.5,
    color: '#bd8640', blurb: 'The span king. Floor joists, headers.' },
  { id: '4x4',  label: '4×4',  key: '5', massPerFt: 3.0, eaRel: 2.33, eiRel: 2.3,
    axialCapRel: 2.33, bendCapRel: 2.3, costPerFt: 1.30, depthIn: 3.5, thickIn: 3.5,
    color: '#b98d63', blurb: 'A post, not a beam. Great in compression.' },
  { id: '4x6',  label: '4×6',  key: '6', massPerFt: 4.7, eaRel: 3.67, eiRel: 9.1,
    axialCapRel: 3.67, bendCapRel: 5.8, costPerFt: 2.60, depthIn: 5.5, thickIn: 3.5,
    color: '#a87f52', blurb: 'Chunky header over doors and windows.' },
  { id: 'lvl',  label: 'LVL',  key: '7', massPerFt: 4.8, eaRel: 4.4, eiRel: 30.8,
    axialCapRel: 6.6, bendCapRel: 16.0, costPerFt: 4.50, depthIn: 9.25, thickIn: 1.75,
    color: '#e0cf9f', blurb: 'Engineered beam. Absurdly strong, priced like it.' },
];

export const LUMBER_BY_ID: Record<string, LumberType> = Object.fromEntries(
  LUMBER.map((l) => [l.id, l]),
);

export const PANEL_COST_PER_SQFT = 1.6;

export const lumberEA = (t: LumberType) => TUNE.EA_BASE * t.eaRel;
export const lumberEI = (t: LumberType) => TUNE.EI_BASE * t.eiRel;
export const lumberAxialCap = (t: LumberType) =>
  TUNE.AXIAL_CAP_STRAIN * (t.axialCapRel / t.eaRel); // cap strain: force cap / EA
/** Kink angle (rad) per segment at 100% bend stress. kappa_cap ~ Mcap/EI. */
export const lumberKappaCap = (t: LumberType) =>
  TUNE.KAPPA_CAP * (t.bendCapRel / t.eiRel);
