import { CELL, Face, FaceId, GridPt, Project } from './structure';

const cells = (ft: number) => Math.round(ft / CELL);

function bottomRow(widthFt: number): GridPt[] {
  const pts: GridPt[] = [];
  for (let i = 0; i <= cells(widthFt); i++) pts.push({ i, j: 0 });
  return pts;
}

function endSupports(widthFt: number): GridPt[] {
  const n = cells(widthFt);
  return [{ i: 0, j: 0 }, { i: 1, j: 0 }, { i: n - 1, j: 0 }, { i: n, j: 0 }];
}

function wall(id: FaceId, label: string, widthFt: number, origin: [number, number, number],
  xAxis: [number, number, number]): Face {
  return {
    id, label, widthFt, heightFt: 10, groundDrop: 0,
    supportLabel: 'Bolted to the slab along the bottom',
    anchors: bottomRow(widthFt), budget: 260,
    joints: 'nails', members: [], panels: [],
    plane: { origin, xAxis, yAxis: [0, 1, 0] },
  };
}

export function defaultProject(): Project {
  const faces: Face[] = [
    wall('front', 'Front wall', 12, [0, 0, 0], [1, 0, 0]),
    wall('back', 'Back wall', 12, [12, 0, 8], [-1, 0, 0]),
    wall('left', 'Left wall', 8, [0, 0, 8], [0, 0, -1]),
    wall('right', 'Right wall', 8, [12, 0, 0], [0, 0, 1]),
    {
      id: 'roof', label: 'Roof truss', widthFt: 12, heightFt: 6, groundDrop: 8,
      supportLabel: 'Rests on the wall top plates at each end',
      anchors: endSupports(12), budget: 220,
      joints: 'nails', members: [], panels: [],
      plane: { origin: [0, 8, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
    },
    {
      id: 'floor', label: 'Floor deck', widthFt: 12, heightFt: 4, groundDrop: 2.5,
      supportLabel: 'Sits on foundation blocks at each end',
      anchors: endSupports(12), budget: 180,
      joints: 'nails', members: [], panels: [],
      plane: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
    },
  ];
  return { version: 1, faces };
}
