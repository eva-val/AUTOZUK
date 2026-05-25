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

  // Phase 2 / AUTOZUK
  autozukRunning: boolean;
  autozukResults: Record<string, AutozukResult>;
  autozukMode: boolean;
  autozukHidden: boolean;
  selectedTile: Tile | null;
  excludedTiles: Set<string>;
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
  autozukResults: {},
  autozukMode: false,
  autozukHidden: false,
  selectedTile: null,
  excludedTiles: new Set(),
  activePrayerSeq: null,

  currentLoadout: LOADOUTS.blowpipe,
  facingSouth: true,

  tileSize: 20,
};

export function getActivePrayerSeq(): PrayerSequence | null {
  if (state.activePrayerSeq) return state.activePrayerSeq;
  if (state.playerPlacement) {
    const pk = `${state.playerPlacement.x},${state.playerPlacement.y}`;
    const r = state.autozukResults[pk];
    if (r) return r.prayer;
  }
  return null;
}
