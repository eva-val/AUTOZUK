import { createRegion } from '../core/region';
import { isSpawnCodeError, parseSpawnCode } from '../core/spawnCode';
import { ARENA_X_MAX, ARENA_X_MIN, ARENA_Y_MAX, ARENA_Y_MIN } from '../data/arena';
import { MOB_DEFS } from '../data/mobs';
import { initSimState } from '../sim/engine';
import { checkTileExcluded } from '../sim/exclusion';
import { runHeadlessSim } from '../sim/headless';
import { calcSimDamage, optimizePrayer } from '../sim/prayerOptimizer';
import type { AutozukResult, Tile } from '../types';
import { playExclusionBlip, playScoreBlip } from './audio';
import { updatePreview } from './controls';
import { byId } from './dom';
import { heatmapColor } from './heatmap';
import { liveTick, stopPlay, updateLiveUI } from './liveSim';
import { render } from './render';
import { state } from './state';
import { closeTileDetail, showTileDetail, updateLiveDetail } from './tileDetail';

const PRAYER_LABELS = { mage: 'M', range: 'R', melee: 'X' } as const;

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
  state.autozukResults = {};
  state.excludedTiles = new Set();
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

  // STEP 1: exclusion sweep (animated batches)
  byId('autozukStatus').textContent = 'Phase 1: Excluding tiles...';
  const allTiles: Tile[] = [];
  for (let y = ARENA_Y_MIN; y <= ARENA_Y_MAX; y++)
    for (let x = ARENA_X_MIN; x <= ARENA_X_MAX; x++) allTiles.push({ x, y });

  const eligibleTiles: Tile[] = [];
  let exIdx = 0;
  await new Promise<void>((resolve) => {
    function sweepBatch(): void {
      let count = 0;
      while (exIdx < allTiles.length && count < 20) {
        const t = allTiles[exIdx]!;
        if (checkTileExcluded(t.x, t.y, testMobs, testRegion)) {
          state.excludedTiles.add(`${t.x},${t.y}`);
          playExclusionBlip();
        } else {
          eligibleTiles.push(t);
        }
        exIdx++;
        count++;
      }
      const pct = Math.floor((exIdx / allTiles.length) * 100);
      byId<HTMLElement>('progressFill').style.width = `${pct * 0.2}%`;
      byId('autozukStatus').textContent =
        `Excluding: ${exIdx}/${allTiles.length} tiles checked, ${eligibleTiles.length} eligible`;
      render();
      if (exIdx < allTiles.length) setTimeout(sweepBatch, 100);
      else resolve();
    }
    sweepBatch();
  });

  setStatus(`${eligibleTiles.length} tiles to simulate, ${state.excludedTiles.size} excluded`, 'info');

  // STEP 2: simulate each eligible tile
  const totalTiles = eligibleTiles.length;
  let completedTiles = 0;
  const cachedRegion = createRegion(state.pillars);
  for (let ti = 0; ti < totalTiles; ti++) {
    const tile = eligibleTiles[ti]!;
    const key = `${tile.x},${tile.y}`;
    byId('autozukStatus').textContent = `Simulating tile ${ti + 1}/${totalTiles} (${tile.x},${tile.y})...`;

    // Quick live preview (30 ticks, batched into 5 animation frames of 6 ticks each)
    const initial = initSimState(code, tile, state.pillars, loadout, 'live');
    if (initial) {
      state.sim = initial;
      await new Promise<void>((resolve) => {
        let vt = 0;
        function animFrame(): void {
          if (!state.sim || vt >= 30) {
            state.sim = null;
            state.tickEvents = [];
            state.tickHits = {};
            state.gridMobColumns = [];
            resolve();
            return;
          }
          for (let i = 0; i < 6 && vt < 30; i++) {
            liveTick();
            vt++;
            if (state.sim?.mobs.every((m) => m.dead)) {
              vt = 30;
              break;
            }
          }
          render();
          requestAnimationFrame(animFrame);
        }
        requestAnimationFrame(animFrame);
      });
    }

    // Headless sims
    const allResults: Array<ReturnType<typeof runHeadlessSim>> = [];
    for (let s = 0; s < maxSims; s++) {
      const result = runHeadlessSim(code, tile, state.pillars, loadout, maxTicks, cachedRegion);
      if (result) allResults.push(result);
      // Early death termination
      if (s === 2 && allResults.length >= 3) {
        const quickPrayer = optimizePrayer(
          allResults.filter((r) => r !== null) as Exclude<typeof result, null>[],
          code,
          state.pillars,
          loadout
        );
        const allDead = allResults.every(
          (r) => r && calcSimDamage(r.attacks, quickPrayer.sequence, loadout, r.mobInitHP).died
        );
        if (allDead) break;
      }
      if (s === 9 && allResults.length >= 10) {
        const validResults = allResults.filter((r) => r !== null) as Exclude<typeof result, null>[];
        const quickPrayer = optimizePrayer(validResults, code, state.pillars, loadout);
        const quickDmgs = validResults.map(
          (r) => calcSimDamage(r.attacks, quickPrayer.sequence, loadout, r.mobInitHP).damage
        );
        const quickAvg = quickDmgs.reduce((a, b) => a + b, 0) / quickDmgs.length;
        if (quickAvg > 80) break;
      }
    }

    const validResults = allResults.filter((r) => r !== null) as NonNullable<(typeof allResults)[number]>[];
    if (validResults.length > 0) {
      const prayer = optimizePrayer(validResults, code, state.pillars, loadout);
      const damages: number[] = [];
      const completionTicks: number[] = [];
      let invalidCount = 0;
      let deathCount = 0;
      for (const r of validResults) {
        if (r.status === 'invalid') {
          invalidCount++;
          continue;
        }
        const res = calcSimDamage(r.attacks, prayer.sequence, loadout, r.mobInitHP);
        if (res.died) deathCount++;
        damages.push(res.damage);
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
      state.autozukResults[key] = tileResult;
      playScoreBlip(avgDmg);
      updateLiveDetail(tile.x, tile.y, tileResult);
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
      const feedPanel = byId('liveFeedPanel');
      feedPanel.appendChild(row);
      feedPanel.scrollTop = feedPanel.scrollHeight;
    }
    completedTiles++;
    const pct = 20 + Math.floor((completedTiles / totalTiles) * 80);
    byId<HTMLElement>('progressFill').style.width = `${pct}%`;
    render();
    await new Promise<void>((r) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => r();
      ch.port2.postMessage('');
    });
  }

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
  let bestKey: string | null = null;
  let bestDmg = Infinity;
  for (const key in state.autozukResults) {
    const r = state.autozukResults[key]!;
    if (r.avgDamage < bestDmg) {
      bestDmg = r.avgDamage;
      bestKey = key;
    }
  }
  if (bestKey) {
    const parts = bestKey.split(',').map(Number);
    const bx = parts[0]!;
    const by = parts[1]!;
    state.selectedTile = { x: bx, y: by };
    state.playerPlacement = { x: bx, y: by };
    state.activePrayerSeq = state.autozukResults[bestKey]!.prayer;
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
  state.autozukResults = {};
  state.excludedTiles = new Set();
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
