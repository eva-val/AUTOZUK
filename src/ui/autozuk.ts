import { createRegion } from '../core/region';
import { isSpawnCodeError, parseSpawnCode } from '../core/spawnCode';
import { ARENA_X_MAX, ARENA_X_MIN, ARENA_Y_MAX, ARENA_Y_MIN } from '../data/arena';
import { MOB_DEFS } from '../data/mobs';
import { checkTileExcluded } from '../sim/exclusion';
import { runHeadlessSim } from '../sim/headless';
import { optimizePrayerDetailed, type PreparedSim } from '../sim/prayerOptimizer';
import type { AutozukResult, Tile } from '../types';
import { playExclusionBlip, playScoreBlip } from './audio';
import { updatePreview } from './controls';
import { byId } from './dom';
import { heatmapColor } from './heatmap';
import { stopPlay, updateLiveUI } from './liveSim';
import { render, scheduleRender } from './render';
import { TILE_BUF_LEN, TILE_STRIDE, packTile, state } from './state';
import { closeTileDetail, showTileDetail, updateLiveDetail } from './tileDetail';

const PRAYER_LABELS = { mage: 'M', range: 'R', melee: 'X' } as const;

// AUTOZUK DOM coalescer. When the per-tile loop fires faster than the browser can
// paint, queue mutations and flush them in a single RAF tick. Each field keeps only
// the latest value (rows are an exception — they need to all reach the DOM in order).
let _pendingRows: HTMLDivElement[] = [];
let _pendingDetail: { x: number; y: number; result: AutozukResult } | null = null;
let _pendingProgressPct = -1;
let _pendingStatusText: string | null = null;
let _autozukFlushScheduled = false;
function scheduleAutozukUiFlush(): void {
  if (_autozukFlushScheduled) return;
  _autozukFlushScheduled = true;
  requestAnimationFrame(() => {
    _autozukFlushScheduled = false;
    if (_pendingProgressPct >= 0) {
      byId<HTMLElement>('progressFill').style.width = `${_pendingProgressPct}%`;
      _pendingProgressPct = -1;
    }
    if (_pendingStatusText !== null) {
      byId('autozukStatus').textContent = _pendingStatusText;
      _pendingStatusText = null;
    }
    if (_pendingRows.length > 0) {
      const feedPanel = byId('liveFeedPanel');
      const frag = document.createDocumentFragment();
      for (const row of _pendingRows) frag.appendChild(row);
      _pendingRows = [];
      feedPanel.appendChild(frag);
      feedPanel.scrollTop = feedPanel.scrollHeight;
    }
    if (_pendingDetail) {
      const d = _pendingDetail;
      _pendingDetail = null;
      updateLiveDetail(d.x, d.y, d.result);
    }
  });
}

function setStatus(msg: string, type?: 'info' | 'error'): void {
  const el = byId('statusMsg');
  el.textContent = msg;
  el.className = `status-msg${type ? ` ${type}` : ''}`;
}

export async function startAutozuk(): Promise<void> {
  if (state.autozukRunning) return;
  const code = byId<HTMLInputElement>('spawnCode').value;
  if (!code.trim()) {
    setStatus('Enter a spawn code first', 'error');
    return;
  }
  const parsed = parseSpawnCode(code);
  if (isSpawnCodeError(parsed)) {
    setStatus(parsed.error, 'error');
    return;
  }

  // Stop any Phase 1 sim and reset tick state
  stopPlay();
  state.sim = null;
  state.tickEvents = [];
  state.tickHits = {};
  state.gridMobColumns = [];
  state.tickGridUserScrolled = false;
  state.eventListUserScrolled = false;
  byId('tickGridHead').innerHTML = '<tr><th class="tick-col">T</th></tr>';
  byId('tickGridBody').innerHTML = '';
  byId('tickGridCount').textContent = '0 hits';
  byId('tickDisplay').innerHTML = '<span>TICK</span><br>—';

  state.autozukRunning = true;
  state.autozukMode = true;
  state.autozukResults = new Array(TILE_BUF_LEN);
  state.excludedTiles = new Uint8Array(TILE_BUF_LEN);
  state.excludedTilesCount = 0;
  state.selectedTile = null;
  state.activePrayerSeq = null;
  state.autozukHidden = false;
  byId<HTMLButtonElement>('btnHideAZ').textContent = 'HIDE';
  byId<HTMLButtonElement>('btnHideAZ').style.background = '';
  const btnAutozuk = byId<HTMLButtonElement>('btnAutozuk');
  btnAutozuk.disabled = true;
  btnAutozuk.textContent = 'RUNNING...';
  byId('detailPanel').classList.add('detail-hidden');
  byId('phase1Panel').style.display = 'none';
  const liveDetailPanel = byId('liveDetailPanel');
  liveDetailPanel.style.display = 'flex';
  liveDetailPanel.innerHTML =
    '<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:11px;font-family:JetBrains Mono,monospace">Excluding tiles...</div>';
  const liveFeedPanel = byId('liveFeedPanel');
  liveFeedPanel.style.display = 'block';
  liveFeedPanel.innerHTML = '';

  const maxSims = parseInt(byId<HTMLInputElement>('maxSims').value, 10) || 1000;
  let maxTicks = parseInt(byId<HTMLInputElement>('maxTicks').value, 10) || 400;
  const loadout = state.currentLoadout;
  if (loadout.isBloodBarrage) maxTicks += 50;
  const hasMager = parsed.spawns.some((s) => s.type === 'mager');
  if (!hasMager && maxTicks > 150) maxTicks = 150;

  // Preview mobs for the exclusion check
  updatePreview();
  const testMobs = parsed.spawns
    .filter((s) => s.type !== 'nothing')
    .map((s) => ({
      x: s.x,
      y: s.y,
      size: MOB_DEFS[s.type as keyof typeof MOB_DEFS].size,
      type: s.type as keyof typeof MOB_DEFS,
      range: MOB_DEFS[s.type as keyof typeof MOB_DEFS].range,
      dead: false,
    }));
  const testRegion = createRegion(state.pillars);

  // STEP 1: exclusion sweep. The arena is ~870 tiles and each checkTileExcluded call
  // is sub-millisecond, so the whole sweep runs synchronously in one tick. The previous
  // 20-tile / 100ms animated batching added ~4s of artificial wall-clock delay and is
  // a hard cap once the rest of the pipeline is fast. The exclusion blip is already
  // rate-limited by audio.ts so synchronous calls produce at most a couple of audible
  // hits, not a buzzsaw.
  byId('autozukStatus').textContent = 'Phase 1: Excluding tiles...';
  const eligibleTiles: Tile[] = [];
  let totalChecked = 0;
  for (let y = ARENA_Y_MIN; y <= ARENA_Y_MAX; y++) {
    for (let x = ARENA_X_MIN; x <= ARENA_X_MAX; x++) {
      totalChecked++;
      if (checkTileExcluded(x, y, testMobs, testRegion)) {
        state.excludedTiles[packTile(x, y)] = 1;
        state.excludedTilesCount++;
        playExclusionBlip();
      } else {
        eligibleTiles.push({ x, y });
      }
    }
  }
  _pendingProgressPct = 20;
  _pendingStatusText = `Excluding: ${totalChecked}/${totalChecked} tiles checked, ${eligibleTiles.length} eligible`;
  scheduleAutozukUiFlush();
  scheduleRender();

  setStatus(`${eligibleTiles.length} tiles to simulate, ${state.excludedTilesCount} excluded`, 'info');

  // STEP 2: simulate each eligible tile
  const totalTiles = eligibleTiles.length;
  let completedTiles = 0;
  const cachedRegion = createRegion(state.pillars);
  for (let ti = 0; ti < totalTiles; ti++) {
    const tile = eligibleTiles[ti]!;
    const tileIdx = packTile(tile.x, tile.y);
    _pendingStatusText = `Simulating tile ${ti + 1}/${totalTiles} (${tile.x},${tile.y})...`;
    scheduleAutozukUiFlush();

    // The 30-tick per-tile live preview animation has been removed: at faster solver
    // speeds it added a hard ~80ms RAF tax per tile (~8s across 100 tiles). The heatmap
    // filling in tile-by-tile is the progress signal.

    // Headless sims. `prepared` is built incrementally inside optimizePrayerDetailed
    // (we pass it back in on each call), so prepareSimDamage runs at most once per sim.
    type ValidResult = NonNullable<ReturnType<typeof runHeadlessSim>>;
    const validResults: ValidResult[] = [];
    const prepared: PreparedSim[] = [];
    for (let s = 0; s < maxSims; s++) {
      const result = runHeadlessSim(code, tile, state.pillars, loadout, maxTicks, cachedRegion);
      if (result) validResults.push(result);
      // Early death termination — at s=2 verify all sims died under the locally-best prayer.
      if (s === 2 && validResults.length >= 3) {
        const quick = optimizePrayerDetailed(validResults, code, state.pillars, loadout, undefined, prepared);
        let allDead = true;
        for (let i = 0; i < quick.perSimLen; i++) {
          if (quick.perSimDied[i] === 0) {
            allDead = false;
            break;
          }
        }
        if (allDead) break;
      }
      if (s === 9 && validResults.length >= 10) {
        const quick = optimizePrayerDetailed(validResults, code, state.pillars, loadout, undefined, prepared);
        let sum = 0;
        for (let i = 0; i < quick.perSimLen; i++) sum += quick.perSimDamage[i]!;
        const quickAvg = sum / quick.perSimLen;
        if (quickAvg > 80) break;
      }
    }

    if (validResults.length > 0) {
      const detailed = optimizePrayerDetailed(validResults, code, state.pillars, loadout, undefined, prepared);
      const prayer = { sequence: detailed.sequence, avgDamage: detailed.avgDamage };
      const damages: number[] = [];
      const completionTicks: number[] = [];
      let invalidCount = 0;
      let deathCount = 0;
      for (let i = 0; i < validResults.length; i++) {
        const r = validResults[i]!;
        if (r.status === 'invalid') {
          invalidCount++;
          continue;
        }
        if (detailed.perSimDied[i]) deathCount++;
        damages.push(detailed.perSimDamage[i]!);
        completionTicks.push(r.completedTick);
      }
      const deathPct = damages.length > 0 ? (deathCount / damages.length) * 100 : 0;
      const avgDmg = damages.length > 0 ? damages.reduce((a, b) => a + b, 0) / damages.length : 999;
      const over50 = damages.filter((d) => d > 50).length;
      const avgTicks =
        completionTicks.length > 0 ? completionTicks.reduce((a, b) => a + b, 0) / completionTicks.length : maxTicks;
      const isMostlyDead = deathPct > 30;
      const invalidPct = validResults.length > 0 ? (invalidCount / validResults.length) * 100 : 0;
      const isMostlyInvalid = invalidPct > 20;
      const tileResult: AutozukResult = {
        avgDamage: avgDmg,
        damages,
        completionTicks,
        over50Pct: damages.length > 0 ? (over50 / damages.length) * 100 : 100,
        avgTicks,
        avgTime: (avgTicks * 0.6).toFixed(1),
        prayer: prayer.sequence,
        invalidPct,
        totalSims: validResults.length,
        deathPct,
        markedDead: isMostlyDead || isMostlyInvalid,
      };
      state.autozukResults[tileIdx] = tileResult;
      playScoreBlip(avgDmg);
      _pendingDetail = { x: tile.x, y: tile.y, result: tileResult };
      const dmgRound = Math.round(avgDmg);
      const dmgColor = heatmapColor(avgDmg, 1);
      const prayHtml = ([1, 2, 3, 0] as const)
        .map((i) => prayer.sequence[i]!)
        .map((p) => `<div class="fp ${p}">${PRAYER_LABELS[p]}</div>`)
        .join('');
      const barW = Math.min(100, avgDmg);
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.style.borderLeftColor = dmgColor;
      const deathLabel = isMostlyDead ? ` ☠${Math.round(deathPct)}%` : '';
      row.innerHTML =
        `<span class="feed-tile">(${tile.x},${tile.y})</span>` +
        `<span class="feed-dmg" style="color:${dmgColor}">${dmgRound}${deathLabel}</span>` +
        `<div class="feed-bar"><div class="feed-bar-inner" style="width:${barW}%;background:${dmgColor}"></div></div>` +
        `<div class="feed-prayer">${prayHtml}</div>` +
        `<span class="feed-sims">${validResults.length}</span>`;
      _pendingRows.push(row);
    }
    completedTiles++;
    const pct = 20 + Math.floor((completedTiles / totalTiles) * 80);
    _pendingProgressPct = pct;
    scheduleAutozukUiFlush();
    scheduleRender();
    await new Promise<void>((r) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => r();
      ch.port2.postMessage('');
    });
  }

  // Flush any straggler queued UI writes synchronously before the Done block runs,
  // so the inline "100%" progress + panel resets below aren't overwritten by a stale
  // RAF flush after the loop exits.
  if (_pendingRows.length > 0) {
    const feedPanel = byId('liveFeedPanel');
    const frag = document.createDocumentFragment();
    for (const row of _pendingRows) frag.appendChild(row);
    _pendingRows = [];
    feedPanel.appendChild(frag);
  }
  if (_pendingDetail) {
    const d = _pendingDetail;
    _pendingDetail = null;
    updateLiveDetail(d.x, d.y, d.result);
  }
  _pendingProgressPct = -1;
  _pendingStatusText = null;

  // Done
  state.autozukRunning = false;
  state.sim = null;
  btnAutozuk.disabled = false;
  btnAutozuk.textContent = 'START AUTOZUK';
  byId<HTMLElement>('progressFill').style.width = '100%';
  byId('liveDetailPanel').style.display = 'none';
  byId('liveFeedPanel').style.display = 'none';
  byId('phase1Panel').style.display = '';

  // Best tile
  let bestIdx = -1;
  let bestResult: AutozukResult | undefined;
  let bestDmg = Infinity;
  for (let idx = 0; idx < state.autozukResults.length; idx++) {
    const r = state.autozukResults[idx];
    if (r && r.avgDamage < bestDmg) {
      bestDmg = r.avgDamage;
      bestIdx = idx;
      bestResult = r;
    }
  }
  if (bestIdx >= 0 && bestResult) {
    const bx = (bestIdx >> 5) + ARENA_X_MIN;
    const by = (bestIdx & (TILE_STRIDE - 1)) + ARENA_Y_MIN;
    state.selectedTile = { x: bx, y: by };
    state.playerPlacement = { x: bx, y: by };
    state.activePrayerSeq = bestResult.prayer;
    showTileDetail(bx, by, closeTileDetail);
    const scoreName = state.currentLoadout.isBloodBarrage ? 'max HP deficit' : 'dmg';
    byId('autozukStatus').textContent = `Done! Best tile: (${bx},${by}) — avg ${Math.round(bestDmg)} ${scoreName}`;
    setStatus(`Best tile: (${bx},${by}) with ~${Math.round(bestDmg)} avg ${scoreName}`, 'info');
  } else {
    byId('autozukStatus').textContent = 'Done! No valid tiles found.';
    setStatus('No valid tiles found', 'error');
  }
  updateLiveUI();
  render();
}

export function resetAutozuk(): void {
  if (state.autozukRunning) return;
  state.autozukMode = false;
  state.autozukResults = new Array(TILE_BUF_LEN);
  state.excludedTiles = new Uint8Array(TILE_BUF_LEN);
  state.excludedTilesCount = 0;
  state.selectedTile = null;
  state.activePrayerSeq = null;
  state.autozukHidden = false;
  byId<HTMLElement>('progressFill').style.width = '0%';
  byId('autozukStatus').textContent = '';
  byId('detailPanel').classList.add('detail-hidden');
  byId('liveDetailPanel').style.display = 'none';
  byId('liveFeedPanel').style.display = 'none';
  byId('phase1Panel').style.display = '';
  byId('eventlistSection').style.display = '';
  byId('resizeHandle').style.display = '';
  byId('exportSection').style.display = '';
  const hideBtn = byId<HTMLButtonElement>('btnHideAZ');
  hideBtn.textContent = 'HIDE';
  hideBtn.style.background = '';
  setStatus('AUTOZUK data cleared', 'info');
  render();
}

export function toggleHideAutozuk(): void {
  state.autozukHidden = !state.autozukHidden;
  const btn = byId<HTMLButtonElement>('btnHideAZ');
  if (state.autozukHidden) {
    btn.textContent = 'SHOW';
    btn.style.background = 'var(--accent-dim)';
  } else {
    btn.textContent = 'HIDE';
    btn.style.background = '';
  }
  render();
}
