import { Face } from '../model/structure';
import { clamp } from '../util/vec2';

export class Camera {
  cx = 6;         // world center, ft
  cy = 4;
  scale = 60;     // px per ft

  fitFace(face: Face, viewW: number, viewH: number) {
    const padX = 3, padTop = 2.5, padBottom = face.groundDrop > 0 ? Math.min(face.groundDrop, 3) + 1.5 : 2;
    const wFt = face.widthFt + padX * 2;
    const hFt = face.heightFt + padTop + padBottom;
    this.scale = clamp(Math.min(viewW / wFt, viewH / hFt), 20, 140);
    this.cx = face.widthFt / 2;
    this.cy = (face.heightFt - padBottom + padTop) / 2 - 0.5;
  }

  toScreen(x: number, y: number, viewW: number, viewH: number): [number, number] {
    return [
      (x - this.cx) * this.scale + viewW / 2,
      viewH / 2 - (y - this.cy) * this.scale,
    ];
  }

  toWorld(sx: number, sy: number, viewW: number, viewH: number): [number, number] {
    return [
      (sx - viewW / 2) / this.scale + this.cx,
      this.cy - (sy - viewH / 2) / this.scale,
    ];
  }

  zoomAt(sx: number, sy: number, factor: number, viewW: number, viewH: number) {
    const [wx, wy] = this.toWorld(sx, sy, viewW, viewH);
    this.scale = clamp(this.scale * factor, 15, 220);
    // keep the world point under the cursor fixed
    const [nsx, nsy] = this.toScreen(wx, wy, viewW, viewH);
    this.cx += (nsx - sx) / this.scale;
    this.cy -= (nsy - sy) / this.scale;
  }

  panPx(dx: number, dy: number) {
    this.cx -= dx / this.scale;
    this.cy += dy / this.scale;
  }
}
