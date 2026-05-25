import { isSpawnCodeError, parseSpawnCode } from '../core/spawnCode';
import { ARENA_X_MAX, ARENA_X_MIN, ARENA_Y_MAX, ARENA_Y_MIN } from '../data/arena';
import { LOADOUTS } from '../data/loadouts';
import { MOB_DEFS } from '../data/mobs';
import type { LoadoutKey, PillarKey, PreviewMob } from '../types';
import { resetAutozuk, startAutozuk, toggleHideAutozuk } from './autozuk';
import { getCanvas } from './canvas';
import { byId } from './dom';
import { exportTilemarker } from './exportTile';
import { clearLiveSimState, ensureSim, liveTick, resetSim, startPlay, stopPlay, updateLiveUI } from './liveSim';
import { render } from './render';
import { state } from './state';
import { closeTileDetail, showTileDetail } from './tileDetail';

function setStatus(msg: string, type?: 'info' | 'error'): void {
  const el = byId('statusMsg');
  el.textContent = msg;
  el.className = `status-msg${type ? ` ${type}` : ''}`;
}

export function updatePreview(): void {
  const code = byId<HTMLInputElement>('spawnCode').value;
  state.previewMobs = [];
  if (!code.trim()) {
    render();
    return;
  }
  const parsed = parseSpawnCode(code);
  if (isSpawnCodeError(parsed)) {
    render();
    return;
  }
  for (const spawn of parsed.spawns) {
    if (spawn.type === 'nothing') continue;
    const d = MOB_DEFS[spawn.type];
    const pm: PreviewMob = { x: spawn.x, y: spawn.y, size: d.size, color: d.color, letter: d.letter, type: spawn.type };
    state.previewMobs.push(pm);
  }
  render();
}

function togglePillar(key: PillarKey): void {
  state.pillars[key] = !state.pillars[key];
  byId(`pillar${key}`).classList.toggle('active');
  updatePreview();
  render();
}

function changeLoadout(): void {
  const key = byId<HTMLSelectElement>('loadoutSelect').value as LoadoutKey;
  state.currentLoadout = LOADOUTS[key];
}

function pasteSpawnCode(): void {
  void navigator.clipboard
    .readText()
    .then((text) => {
      text = text.trim();
      const stripped = text.replace(/[1-9]/g, '');
      if (
        stripped.length === 9 &&
        /^[MRXBYOmrxbyo]{9}$/i.test(stripped) &&
        text.length <= 18 &&
        /^[MRXBYOmrxbyo1-9]+$/i.test(text)
      ) {
        const input = byId<HTMLInputElement>('spawnCode');
        input.value = text.toUpperCase();
        input.dispatchEvent(new Event('input'));
      }
    })
    .catch(() => {
      /* ignore clipboard failure */
    });
}

function ensureTickGridView(): void {
  if (!byId('detailPanel').classList.contains('detail-hidden')) closeTileDetail();
}

function stepTick(): void {
  const r = ensureSim(setStatus);
  if (!r) return;
  ensureTickGridView();
  if (r === 'created') {
    updateLiveUI();
    return;
  }
  liveTick();
  updateLiveUI();
}

function togglePlay(): void {
  const r = ensureSim(setStatus);
  if (!r) return;
  ensureTickGridView();
  if (state.playing) {
    stopPlay();
  } else {
    state.playing = true;
    const btn = byId<HTMLButtonElement>('btnPlay');
    btn.textContent = '⏸ PAUSE';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
    startPlay(setStatus);
  }
}

function toggleCompass(): void {
  state.facingSouth = !state.facingSouth;
  byId('compassBtn').textContent = state.facingSouth ? 'S' : 'N';
  render();
}

function handleCanvasClick(e: MouseEvent): void {
  const canvas = getCanvas();
  const rect = canvas.getBoundingClientRect();
  const TILE = state.tileSize;
  let gx: number, gy: number;
  if (state.facingSouth) {
    gx = ARENA_X_MAX - Math.floor((e.clientX - rect.left) / TILE);
    gy = ARENA_Y_MAX - Math.floor((e.clientY - rect.top) / TILE);
  } else {
    gx = Math.floor((e.clientX - rect.left) / TILE) + ARENA_X_MIN;
    gy = Math.floor((e.clientY - rect.top) / TILE) + ARENA_Y_MIN;
  }
  if (gx < ARENA_X_MIN || gx > ARENA_X_MAX || gy < ARENA_Y_MIN || gy > ARENA_Y_MAX) return;
  state.playerPlacement = { x: gx, y: gy };
  if (state.autozukMode && !state.autozukRunning) {
    const key = `${gx},${gy}`;
    if (state.autozukResults[key]) {
      state.selectedTile = { x: gx, y: gy };
      state.activePrayerSeq = state.autozukResults[key]!.prayer;
      showTileDetail(gx, gy, closeTileDetail);
      setStatus(`Player placed at (${gx}, ${gy}) — click STEP/PLAY to sim`, 'info');
      render();
      return;
    } else if (state.excludedTiles.has(key)) {
      setStatus(`Player placed at (${gx}, ${gy}) — excluded tile`, 'info');
      render();
      return;
    }
  }
  setStatus(`Player placed at (${gx}, ${gy})`, 'info');
  render();
}

export function wireControls(): void {
  byId('btnPaste').addEventListener('click', pasteSpawnCode);
  byId('pillarS').addEventListener('click', () => togglePillar('S'));
  byId('pillarW').addEventListener('click', () => togglePillar('W'));
  byId('pillarN').addEventListener('click', () => togglePillar('N'));
  byId('btnReset').addEventListener('click', () => resetSim(setStatus));
  byId('btnStep').addEventListener('click', stepTick);
  byId('btnPlay').addEventListener('click', togglePlay);
  byId('btnAutozuk').addEventListener('click', () => {
    void startAutozuk();
  });
  byId('btnResetAutozuk').addEventListener('click', resetAutozuk);
  byId('btnHideAZ').addEventListener('click', toggleHideAutozuk);
  byId('loadoutSelect').addEventListener('change', changeLoadout);
  byId('compassBtn').addEventListener('click', toggleCompass);
  byId('btnExportTilemarker').addEventListener('click', exportTilemarker);

  byId<HTMLInputElement>('speedSlider').addEventListener('input', function (this: HTMLInputElement) {
    byId('speedLabel').textContent = `${this.value} t/s`;
    if (state.playing) {
      if (state.playInterval) clearInterval(state.playInterval);
      startPlay(setStatus);
    }
  });

  byId<HTMLInputElement>('spawnCode').addEventListener('input', () => {
    if (state.sim) {
      clearLiveSimState();
    }
    state.autozukMode = false;
    state.autozukResults = {};
    state.excludedTiles = new Set();
    state.selectedTile = null;
    byId('detailPanel').classList.add('detail-hidden');
    byId('phase1Panel').style.display = '';
    updatePreview();
  });

  getCanvas().addEventListener('click', handleCanvasClick);
}
