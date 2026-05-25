import { ARENA_W, ARENA_X_MIN, ARENA_Y_MIN } from '../data/arena';
import { LOADOUTS } from '../data/loadouts';
import type {
  AutozukResult,
  GridMobColumn,
  Loadout,
  PillarConfig,
  PrayerSequence,
  PreviewMob,
  SimState,
  TickHit,
  TickLogEvent,
  Tile,
} from '../types';

// Packed tile-key helpers. Power-of-two stride keeps the divide-free shift simple and
// covers ARENA_H = 30 with room to spare.
export const TILE_STRIDE = 32;
export const TILE_BUF_LEN = ARENA_W * TILE_STRIDE;
export const packTile = (x: number, y: number): number =>
  ((x - ARENA_X_MIN) << 5) | (y - ARENA_Y_MIN);

// All formerly-global UI state lives here as a single mutable singleton.
// The sim engine never imports from this file — UI controllers read/write it directly.
export interface UIState {
  sim: SimState | null;
  pillars: PillarConfig;
  playerPlacement: Tile | null;
  playing: boolean;
  playInterval: ReturnType<typeof setInterval> | null;
  tickEvents: TickLogEvent[];
  tickHits: Record<number, TickHit[]>;
  gridMobColumns: GridMobColumn[];
  previewMobs: PreviewMob[];
  tickGridUserScrolled: boolean;
  eventListUserScrolled: boolean;

  // Phase 2 / AUTOZUK — both lookups are keyed by packTile(x, y).
  autozukRunning: boolean;
  autozukResults: (AutozukResult | undefined)[];
  autozukMode: boolean;
  autozukHidden: boolean;
  selectedTile: Tile | null;
  excludedTiles: Uint8Array;
  excludedTilesCount: number;
  activePrayerSeq: PrayerSequence | null;

  currentLoadout: Loadout;
  facingSouth: boolean;

  // Canvas
  tileSize: number;
}

export const state: UIState = {
  sim: null,
  pillars: { S: true, W: true, N: true },
  playerPlacement: null,
  playing: false,
  playInterval: null,
  tickEvents: [],
  tickHits: {},
  gridMobColumns: [],
  previewMobs: [],
  tickGridUserScrolled: false,
  eventListUserScrolled: false,

  autozukRunning: false,
  autozukResults: new Array(TILE_BUF_LEN),
  autozukMode: false,
  autozukHidden: false,
  selectedTile: null,
  excludedTiles: new Uint8Array(TILE_BUF_LEN),
  excludedTilesCount: 0,
  activePrayerSeq: null,

  currentLoadout: LOADOUTS.blowpipe,
  facingSouth: true,

  tileSize: 20,
};

export function getActivePrayerSeq(): PrayerSequence | null {
  if (state.activePrayerSeq) return state.activePrayerSeq;
  if (state.playerPlacement) {
    const r = state.autozukResults[packTile(state.playerPlacement.x, state.playerPlacement.y)];
    if (r) return r.prayer;
  }
  return null;
}
