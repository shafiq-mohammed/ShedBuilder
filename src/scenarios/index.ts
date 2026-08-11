import { ScenarioFactory } from './scenario';
import { makeGravity } from './gravity';
import { makeSnow } from './snow';
import { makePerson } from './person';
import { makeWind } from './wind';
import { makeHanging } from './hanging';
import { makeBricks } from './bricks';

export const SCENARIOS: { id: string; make: ScenarioFactory }[] = [
  { id: 'gravity', make: makeGravity },
  { id: 'snow', make: makeSnow },
  { id: 'person', make: makePerson },
  { id: 'wind', make: makeWind },
  { id: 'hanging', make: makeHanging },
  { id: 'bricks', make: makeBricks },
];
