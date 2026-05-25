import { ARENA_H, ARENA_W } from '../data/arena';
import { byId } from './dom';
import { state } from './state';

let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;

export function getCanvas(): HTMLCanvasElement {
  if (!_canvas) _canvas = byId<HTMLCanvasElement>('grid');
  return _canvas;
}

export function getCtx(): CanvasRenderingContext2D {
  if (!_ctx) {
    const ctx = getCanvas().getContext('2d');
    if (!ctx) throw new Error('Failed to acquire 2D canvas context');
    _ctx = ctx;
  }
  return _ctx;
}

export function resizeCanvas(onResize: () => void): void {
  const c = getCanvas();
  let size = Math.min(
    Math.floor((window.innerHeight - 70) / ARENA_H),
    Math.floor((window.innerWidth - 720) / ARENA_W),
    24
  );
  size = Math.max(size, 14);
  state.tileSize = size;
  c.width = ARENA_W * size;
  c.height = ARENA_H * size;
  onResize();
}
