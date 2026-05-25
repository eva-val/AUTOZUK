import { closestTileTo } from '../core/geometry';
import {
  ARENA_H,
  ARENA_W,
  ARENA_X_MAX,
  ARENA_X_MIN,
  ARENA_Y_MAX,
  ARENA_Y_MIN,
  PILLAR_LOCS,
  SPAWN_LOCATIONS,
} from '../data/arena';
import { FLOOR_RAW } from '../data/floor';
import type { Mob } from '../types';
import { getCanvas, getCtx } from './canvas';
import { heatmapBlended, isDarkColor } from './heatmap';
import { updatePrayerStrip } from './prayerStrip';
import { state } from './state';

function drawFlipText(t: string, x: number, y: number): void {
  const ctx = getCtx();
  if (state.facingSouth) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(-1, -1);
    ctx.fillText(t, 0, 0);
    ctx.restore();
  } else {
    ctx.fillText(t, x, y);
  }
}

function drawHealthBar(bx: number, byAbove: number, byBelow: number, bw: number, pct: number): void {
  const ctx = getCtx();
  if (state.facingSouth) {
    ctx.save();
    ctx.translate(bx + bw / 2, byBelow + 1.5);
    ctx.scale(-1, -1);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(-bw / 2, -1.5, bw, 3);
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(-bw / 2, -1.5, Math.max(0, bw * pct), 3);
    ctx.restore();
  } else {
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(bx, byAbove, bw, 3);
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(bx, byAbove, Math.max(0, bw * pct), 3);
  }
}

function drawMob(mob: Mob): void {
  const ctx = getCtx();
  const TILE = state.tileSize;
  if (mob.dying > 0) ctx.globalAlpha = 0.14;
  const s = mob.size;
  ctx.fillStyle = mob.color;
  ctx.fillRect(
    (mob.x - ARENA_X_MIN) * TILE + 1,
    (mob.y - (s - 1) - ARENA_Y_MIN) * TILE + 1,
    s * TILE - 2,
    s * TILE - 2
  );
  const cx = (mob.x + (s - 1) / 2 - ARENA_X_MIN) * TILE + TILE / 2;
  const cy = (mob.y - (s - 1) / 2 - ARENA_Y_MIN) * TILE + TILE / 2;
  ctx.fillStyle = isDarkColor(mob.color) ? '#fff' : '#000';
  ctx.font = `bold ${Math.max(10, Math.min(TILE * s * 0.4, 20))}px JetBrains Mono`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawFlipText(mob.letter, cx, cy);
  ctx.globalAlpha = 1;
}

function drawMobHPBar(mob: Mob): void {
  if (mob.dying > 0 || mob.hp >= mob.maxHp) return;
  const TILE = state.tileSize;
  const s = mob.size;
  const bx = (mob.x - ARENA_X_MIN) * TILE;
  const bw = s * TILE;
  const byAbove = (mob.y - s + 1 - ARENA_Y_MIN) * TILE - 4;
  const byBelow = (mob.y - ARENA_Y_MIN) * TILE + TILE + 1;
  drawHealthBar(bx, byAbove, byBelow, bw, mob.hp / mob.maxHp);
}

export function render(): void {
  const ctx = getCtx();
  const canvas = getCanvas();
  const TILE = state.tileSize;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (state.facingSouth) {
    ctx.translate(canvas.width, canvas.height);
    ctx.scale(-1, -1);
  }
  // Floor background
  for (let fy = 0; fy < FLOOR_RAW.length && fy < ARENA_H; fy++) {
    for (let fx = 0; fx < FLOOR_RAW[fy]!.length && fx < ARENA_W; fx++) {
      ctx.fillStyle = FLOOR_RAW[fy]![fx]!;
      ctx.fillRect(fx * TILE, fy * TILE, TILE, TILE);
    }
  }
  // Grid lines
  ctx.strokeStyle = '#ffffff08';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= ARENA_W; x++) {
    ctx.beginPath();
    ctx.moveTo(x * TILE, 0);
    ctx.lineTo(x * TILE, ARENA_H * TILE);
    ctx.stroke();
  }
  for (let y = 0; y <= ARENA_H; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * TILE);
    ctx.lineTo(ARENA_W * TILE, y * TILE);
    ctx.stroke();
  }

  // Phase 2: heatmap overlay
  if (state.autozukMode && !state.autozukHidden) {
    for (let x = ARENA_X_MIN; x <= ARENA_X_MAX; x++) {
      for (let y = ARENA_Y_MIN; y <= ARENA_Y_MAX; y++) {
        const key = `${x},${y}`;
        const px = (x - ARENA_X_MIN) * TILE;
        const py = (y - ARENA_Y_MIN) * TILE;
        if (state.excludedTiles.has(key)) {
          ctx.fillStyle = '#0a0a0f88';
          ctx.fillRect(px, py, TILE, TILE);
          ctx.strokeStyle = '#ff000022';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + TILE, py + TILE);
          ctx.stroke();
          continue;
        }
        const result = state.autozukResults[key];
        if (result) {
          const fx = x - ARENA_X_MIN;
          const fy = y - ARENA_Y_MIN;
          if (result.markedDead) {
            ctx.fillStyle = heatmapBlended(99, fx, fy, 0.9);
            ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
            if (TILE >= 12) {
              ctx.fillStyle = '#888';
              ctx.font = `bold ${Math.max(8, TILE * 0.5)}px JetBrains Mono`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              drawFlipText('☠', px + TILE / 2, py + TILE / 2);
            }
          } else {
            ctx.fillStyle = heatmapBlended(result.avgDamage, fx, fy);
            ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
            if (TILE >= 16) {
              ctx.fillStyle = result.avgDamage > 60 ? '#888' : result.avgDamage < 20 ? '#000' : '#fff';
              ctx.font = `bold ${Math.max(7, TILE * 0.4)}px JetBrains Mono`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              drawFlipText(String(Math.round(result.avgDamage)), px + TILE / 2, py + TILE / 2);
            }
          }
        }
      }
    }
    if (state.selectedTile) {
      const px = (state.selectedTile.x - ARENA_X_MIN) * TILE;
      const py = (state.selectedTile.y - ARENA_Y_MIN) * TILE;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, TILE, TILE);
    }
  }

  if (!state.sim && !state.autozukMode) {
    for (const pm of state.previewMobs) {
      const s = pm.size;
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = pm.color;
      ctx.fillRect(
        (pm.x - ARENA_X_MIN) * TILE + 1,
        (pm.y - (s - 1) - ARENA_Y_MIN) * TILE + 1,
        s * TILE - 2,
        s * TILE - 2
      );
      const cx = (pm.x + (s - 1) / 2 - ARENA_X_MIN) * TILE + TILE / 2;
      const cy = (pm.y - (s - 1) / 2 - ARENA_Y_MIN) * TILE + TILE / 2;
      ctx.fillStyle = isDarkColor(pm.color) ? '#fff' : '#000';
      ctx.font = `bold ${Math.max(10, Math.min(TILE * s * 0.4, 20))}px JetBrains Mono`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      drawFlipText(pm.letter, cx, cy);
      ctx.globalAlpha = 1;
    }
    if (state.previewMobs.length === 0) {
      ctx.globalAlpha = 0.15;
      for (let i = 0; i < SPAWN_LOCATIONS.length; i++) {
        const sp = SPAWN_LOCATIONS[i]!;
        const sx = (sp.x - ARENA_X_MIN) * TILE;
        const sy = (sp.y - ARENA_Y_MIN) * TILE;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.globalAlpha = 0.3;
        ctx.font = `${Math.max(8, TILE - 4)}px JetBrains Mono`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        drawFlipText(String(i + 1), sx + TILE / 2, sy + TILE / 2);
        ctx.globalAlpha = 0.15;
      }
      ctx.globalAlpha = 1;
    }
  }

  // Pillars
  for (const key of ['S', 'W', 'N'] as const) {
    if (!state.pillars[key]) continue;
    const p = PILLAR_LOCS[key];
    let isAlive = true;
    if (state.sim) {
      const rp = state.sim.region.pillars.find((pp) => pp.id === `pillar${key}`);
      if (rp?.dead) isAlive = false;
    }
    if (!isAlive) continue;
    ctx.fillStyle = '#000000';
    ctx.fillRect(
      (p.x - ARENA_X_MIN) * TILE + 1,
      (p.y - (p.size - 1) - ARENA_Y_MIN) * TILE + 1,
      p.size * TILE - 2,
      p.size * TILE - 2
    );
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(9, TILE - 4)}px JetBrains Mono`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawFlipText(key, (p.x + 1 - ARENA_X_MIN) * TILE + TILE / 2, (p.y - 1 - ARENA_Y_MIN) * TILE + TILE / 2);
  }

  if (state.sim) {
    for (const mob of state.sim.mobs) if (!mob.dead) drawMob(mob);
    const p = state.sim.player;
    const px = (p.x - ARENA_X_MIN) * TILE;
    const py = (p.y - ARENA_Y_MIN) * TILE;
    ctx.fillStyle = '#bb88ff';
    ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(8, TILE - 6)}px JetBrains Mono`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawFlipText('P', px + TILE / 2, py + TILE / 2);
    if (p.aggro && !p.aggro.dead) {
      const ct = closestTileTo(p.aggro, p.x, p.y);
      ctx.strokeStyle = '#ff6b2b88';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(px + TILE / 2, py + TILE / 2);
      ctx.lineTo((ct.x - ARENA_X_MIN) * TILE + TILE / 2, (ct.y - ARENA_Y_MIN) * TILE + TILE / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (p.lastBarrageTarget && state.sim.tick - p.lastBarrageTarget.tick <= 1) {
      const bt = p.lastBarrageTarget;
      const splashX = (bt.x - 1 - ARENA_X_MIN) * TILE;
      const splashY = (bt.y - 1 - ARENA_Y_MIN) * TILE;
      ctx.fillStyle = 'rgba(255,0,0,0.18)';
      ctx.fillRect(splashX, splashY, TILE * 3, TILE * 3);
      ctx.strokeStyle = 'rgba(255,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(splashX, splashY, TILE * 3, TILE * 3);
    }
    // Pass 2: HP bars on top of everything
    for (const mob of state.sim.mobs) if (!mob.dead) drawMobHPBar(mob);
    if (p.hp < p.maxHp) {
      const bx = px;
      const bw = TILE;
      drawHealthBar(bx, py - 4, py + TILE + 1, bw, Math.max(0, p.hp / p.maxHp));
    }
  }

  if (!state.sim && state.playerPlacement) {
    const px = (state.playerPlacement.x - ARENA_X_MIN) * TILE;
    const py = (state.playerPlacement.y - ARENA_Y_MIN) * TILE;
    ctx.fillStyle = '#bb88ff88';
    ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(8, TILE - 6)}px JetBrains Mono`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawFlipText('P', px + TILE / 2, py + TILE / 2);
  }

  if (state.autozukMode && !state.sim) {
    for (const pm of state.previewMobs) {
      const s = pm.size;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = pm.color;
      ctx.fillRect(
        (pm.x - ARENA_X_MIN) * TILE + 1,
        (pm.y - (s - 1) - ARENA_Y_MIN) * TILE + 1,
        s * TILE - 2,
        s * TILE - 2
      );
      const cx = (pm.x + (s - 1) / 2 - ARENA_X_MIN) * TILE + TILE / 2;
      const cy = (pm.y - (s - 1) / 2 - ARENA_Y_MIN) * TILE + TILE / 2;
      ctx.fillStyle = isDarkColor(pm.color) ? '#fff' : '#000';
      ctx.font = `bold ${Math.max(10, Math.min(TILE * s * 0.4, 20))}px JetBrains Mono`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      drawFlipText(pm.letter, cx, cy);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
  updatePrayerStrip();
}
