/**
 * Pure geometry for the renderer: where an edge meets a node's outline
 * (ellipse, diamond, rect).
 */
import type { Point } from '../layout/index.js';
import type { NodeShape } from './styles.js';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the ray from the centre of `node` towards `anchor` crosses the
 * node's outline, pulled back towards the centre by `gap` along the ray.
 *
 * The ray is centre + t * (dx, dy); `t` is the scale at which it meets the
 * outline of the given shape, with rx, ry the half-width and half-height:
 *   - ellipse:          t = 1 / hypot(dx / rx, dy / ry)
 *   - diamond:          t = 1 / (|dx| / rx + |dy| / ry)
 *   - rect, rounded-rect: the nearer of the vertical and horizontal sides
 *     (corner rounding is ignored).
 */
export function boundaryPoint(node: Box, shape: NodeShape, anchor: Point, gap = 0): Point {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = anchor.x - cx;
  const dy = anchor.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const rx = node.width / 2;
  const ry = node.height / 2;
  let t: number;
  switch (shape) {
    case 'ellipse':
      t = 1 / Math.hypot(dx / rx, dy / ry);
      break;
    case 'diamond':
      t = 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry);
      break;
    case 'rect':
    case 'rounded-rect': {
      const tx = dx === 0 ? Infinity : rx / Math.abs(dx);
      const ty = dy === 0 ? Infinity : ry / Math.abs(dy);
      t = Math.min(tx, ty);
      break;
    }
  }
  const len = Math.hypot(dx, dy);
  return {
    x: cx + dx * t - (dx / len) * gap,
    y: cy + dy * t - (dy / len) * gap,
  };
}
