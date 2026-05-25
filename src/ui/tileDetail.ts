import type { AutozukResult } from '../types';
import { byId } from './dom';
import { histogramColor } from './heatmap';
import { state } from './state';

const PRAYER_NAMES = { mage: 'MAGE', range: 'RANGE', melee: 'MELEE' } as const;
const SLOT_LABELS = ['START', 'T1', 'T2', 'T3'] as const;
const DISPLAY_ORDER = [1, 2, 3, 0] as const;

function buildPrayerSequenceHtml(result: AutozukResult): string {
  let html = '<div class="prayer-sequence">';
  for (let i = 0; i < 4; i++) {
    const p = result.prayer[DISPLAY_ORDER[i]!]!;
    html += `<div class="prayer-slot ${p}"><div class="slot-num">${SLOT_LABELS[i]}</div>${PRAYER_NAMES[p]}</div>`;
  }
  html += '</div>';
  return html;
}

function drawHistogram(canvasId: string, damages: number[]): void {
  const hc = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!hc) return;
  const hctx = hc.getContext('2d');
  if (!hctx) return;
  hc.width = hc.parentElement!.clientWidth;
  hc.height = 70;
  const buckets = new Array<number>(20).fill(0);
  const maxDmg = Math.max(...damages, 100);
  for (const d of damages) {
    const b = Math.min(Math.floor((d / maxDmg) * 20), 19);
    buckets[b] = (buckets[b] ?? 0) + 1;
  }
  const maxB = Math.max(...buckets, 1);
  const bw = hc.width / 20;
  for (let i = 0; i < 20; i++) {
    const h = ((buckets[i] ?? 0) / maxB) * 60;
    const dmgVal = ((i + 0.5) / 20) * maxDmg;
    hctx.fillStyle = histogramColor(dmgVal);
    hctx.fillRect(i * bw + 1, 70 - h, bw - 2, h);
  }
  const x50 = (50 / maxDmg) * hc.width;
  if (x50 < hc.width) {
    hctx.strokeStyle = '#ff0000';
    hctx.lineWidth = 2;
    hctx.setLineDash([4, 2]);
    hctx.beginPath();
    hctx.moveTo(x50, 0);
    hctx.lineTo(x50, 70);
    hctx.stroke();
    hctx.setLineDash([]);
  }
}

export function showTileDetail(x: number, y: number, onClose: () => void): void {
  const key = `${x},${y}`;
  const result = state.autozukResults[key];
  if (!result) {
    byId('detailPanel').classList.add('detail-hidden');
    return;
  }
  byId('phase1Panel').style.display = 'none';
  byId('liveDetailPanel').style.display = 'none';
  byId('eventlistSection').style.display = 'none';
  byId('resizeHandle').style.display = 'none';
  const dp = byId('detailPanel');
  dp.classList.remove('detail-hidden');

  const dmgClass = result.avgDamage < 15 ? 'good' : result.avgDamage < 30 ? 'warn' : 'bad';
  const o50Class = result.over50Pct < 10 ? 'good' : result.over50Pct < 30 ? 'warn' : 'bad';
  const scoreLabel = state.currentLoadout.isBloodBarrage ? 'Avg Max HP Deficit' : 'Avg Damage';
  const over50Label = state.currentLoadout.isBloodBarrage ? 'Runs > 50 deficit' : 'Runs > 50 dmg';

  dp.innerHTML = `
    <h3>Tile (${x}, ${y})</h3>
    <div style="margin-bottom:8px"><label style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px">Prayer Sequence (repeating)</label></div>
    ${buildPrayerSequenceHtml(result)}
    <div class="detail-stat"><span class="label">${scoreLabel}</span><span class="value ${dmgClass}">${result.avgDamage.toFixed(1)}</span></div>
    <div class="detail-stat"><span class="label">${over50Label}</span><span class="value ${o50Class}">${result.over50Pct.toFixed(1)}%</span></div>
    <div class="detail-stat"><span class="label">Avg Completion</span><span class="value">${Math.round(result.avgTicks)} ticks (${result.avgTime}s)</span></div>
    <div class="detail-stat"><span class="label">Invalid Runs</span><span class="value">${result.invalidPct.toFixed(1)}%</span></div>
    <div class="detail-stat"><span class="label">Total Sims</span><span class="value">${result.totalSims}</span></div>
    ${result.deathPct !== undefined ? `<div class="detail-stat"><span class="label">Death Rate</span><span class="value ${result.deathPct > 30 ? 'bad' : result.deathPct > 10 ? 'warn' : 'good'}">${result.deathPct.toFixed(1)}%</span></div>` : ''}
    <div style="margin-top:12px"><label style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px">Damage Distribution</label></div>
    <div class="histogram"><canvas id="histCanvas" width="340" height="70"></canvas></div>
    <div style="margin-top:8px;text-align:center">
      <button class="btn btn-secondary" id="btnCloseTileDetail" style="font-size:10px;padding:6px 16px">← Back to Tick Grid</button>
    </div>
  `;
  byId('btnCloseTileDetail').addEventListener('click', onClose);
  requestAnimationFrame(() => drawHistogram('histCanvas', result.damages));
}

export function updateLiveDetail(x: number, y: number, result: AutozukResult): void {
  const dp = byId('liveDetailPanel');
  const dmgClass = result.avgDamage < 15 ? 'good' : result.avgDamage < 30 ? 'warn' : 'bad';
  const o50Class = result.over50Pct < 10 ? 'good' : result.over50Pct < 30 ? 'warn' : 'bad';
  const scoreLabel = state.currentLoadout.isBloodBarrage ? 'Avg Max HP Deficit' : 'Avg Damage';
  const over50Label = state.currentLoadout.isBloodBarrage ? 'Runs > 50 deficit' : 'Runs > 50 dmg';
  dp.innerHTML = `
    <h3 style="font-family:'JetBrains Mono',monospace;color:var(--accent);font-size:13px;font-weight:800;margin-bottom:6px;letter-spacing:1px">Tile (${x}, ${y})</h3>
    <div class="detail-stat"><span class="label">${scoreLabel}</span><span class="value ${dmgClass}">${result.avgDamage.toFixed(1)}</span></div>
    <div class="detail-stat"><span class="label">${over50Label}</span><span class="value ${o50Class}">${result.over50Pct.toFixed(1)}%</span></div>
    <div class="detail-stat"><span class="label">Avg Completion</span><span class="value">${Math.round(result.avgTicks)} ticks (${result.avgTime}s)</span></div>
    <div class="detail-stat"><span class="label">Sims</span><span class="value">${result.totalSims}</span></div>
    <div style="margin-top:8px"><label style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px">Prayer Sequence</label></div>
    ${buildPrayerSequenceHtml(result)}
    <div style="margin-top:8px"><label style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px">Damage Distribution</label></div>
    <div class="histogram"><canvas id="liveHistCanvas" width="340" height="70"></canvas></div>
  `;
  requestAnimationFrame(() => drawHistogram('liveHistCanvas', result.damages));
}

export function closeTileDetail(): void {
  byId('detailPanel').classList.add('detail-hidden');
  byId('phase1Panel').style.display = '';
  byId('eventlistSection').style.display = '';
  byId('resizeHandle').style.display = '';
  byId('exportSection').style.display = '';
  state.selectedTile = null;
  state.activePrayerSeq = null;
}
