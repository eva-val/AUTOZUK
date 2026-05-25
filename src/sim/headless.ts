import type { Loadout, PillarConfig, Region, SimResult, Tile } from '../types';
import { headlessTick, initSimState } from './engine';
import { checkTrappedValid } from './exclusion';

export function runHeadlessSim(
  spawnCode: string,
  playerPos: Tile,
  pillarConfig: PillarConfig,
  loadout: Loadout,
  maxTicks: number,
  cachedRegion?: Region
): SimResult | null {
  const state = initSimState(spawnCode, playerPos, pillarConfig, loadout, 'headless', cachedRegion);
  if (!state) return null;
  for (let i = 0; i < maxTicks; i++) {
    headlessTick(state);
    if (state.aliveCount === 0) {
      return {
        attacks: state.attacks,
        completedTick: state.tick,
        mobs: state.mobs,
        status: 'complete',
        mobInitHP: state.mobInitHP,
      };
    }
    if (!state.player.aggro) {
      let allNoLOS = true;
      const trappedBig = [] as typeof state.mobs;
      for (const m of state.mobs) {
        if (m.dead || m.dying > 0) continue;
        if (m.noLOSTicks < 20) {
          allNoLOS = false;
          break;
        }
        if (m.type !== 'nibbler' && !m.type.startsWith('bloblet')) trappedBig.push(m);
      }
      if (allNoLOS) {
        const valid = checkTrappedValid(trappedBig);
        return {
          attacks: state.attacks,
          completedTick: state.tick,
          mobs: state.mobs,
          status: valid ? 'trapped' : 'invalid',
          mobInitHP: state.mobInitHP,
        };
      }
    }
  }
  return {
    attacks: state.attacks,
    completedTick: maxTicks,
    mobs: state.mobs,
    status: 'timeout',
    mobInitHP: state.mobInitHP,
  };
}
