import { Face } from '../model/structure';
import { Sim } from '../physics/solver';

export interface ScenarioCtx {
  sim: Sim;
  face: Face;
}

export interface ScenarioStatus {
  text: string;
  done: boolean;
  passed: boolean;
}

export interface Scenario {
  id: string;
  label: string;
  icon: string;
  desc: string;                       // one-line hint shown in the test bar
  weights?: number[];                 // click-weight choices (lb), if interactive
  defaultWeight?: number;
  /** Faces this scenario makes the most sense on (advisory only). */
  goodFaces?: string[];
  setup(ctx: ScenarioCtx): void;
  /** Called each frame after settling, before sim.step. Add forces here. */
  tick(ctx: ScenarioCtx, dt: number): void;
  onClick?(ctx: ScenarioCtx, x: number, y: number, weight: number): void;
  draw?(g: CanvasRenderingContext2D, toScreen: (x: number, y: number) => [number, number], scale: number, ctx: ScenarioCtx): void;
  status(ctx: ScenarioCtx): ScenarioStatus;
}

export type ScenarioFactory = () => Scenario;
