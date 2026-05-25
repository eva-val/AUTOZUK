// Verbatim copy of the original (pre-refactor) optimizePrayer. Used ONLY by the test
// suite (optimizePrayer.test.ts) to lock in behavior equivalence with the refactored
// implementation. Delegates damage scoring to calcSimDamageOrig so the oracle is fully
// self-contained and independent of the refactored prayerOptimizer.ts.
import { isSpawnCodeError, parseSpawnCode } from '../core/spawnCode';
import type { Loadout, MobType, PillarConfig, PrayerSequence, PrayerSolution, PrayerType, SimResult } from '../types';
import { calcSimDamageOrig } from './_origCalcSimDamage';

export function optimizePrayerOrig(
  allSimResults: SimResult[],
  spawnCode: string,
  _pillarConfig: PillarConfig,
  loadout: Loadout
): PrayerSolution {
  const parsed = parseSpawnCode(spawnCode);
  const mobTypes = new Set<MobType>();
  if (!isSpawnCodeError(parsed)) {
    for (const s of parsed.spawns) if (s.type !== 'nothing') mobTypes.add(s.type);
  }
  const hasMager = mobTypes.has('mager');
  const hasRanger = mobTypes.has('ranger');
  const hasMeleer = mobTypes.has('meleer');

  const slots: (PrayerType | null)[] = [null, null, null, null];
  type Votes = Record<number, number> & { found?: boolean };
  const slotVotes: Record<'mager' | 'ranger' | 'meleer', Votes> = {
    mager: {},
    ranger: {},
    meleer: {},
  };
  for (const result of allSimResults) {
    for (const atk of result.attacks) {
      if (atk.isScan) continue;
      if (atk.mobType === 'mager' && hasMager && !slotVotes.mager.found) {
        slotVotes.mager[atk.tick % 4] = (slotVotes.mager[atk.tick % 4] ?? 0) + 1;
        slotVotes.mager.found = true;
      }
      if (atk.mobType === 'ranger' && hasRanger && !slotVotes.ranger.found) {
        slotVotes.ranger[atk.tick % 4] = (slotVotes.ranger[atk.tick % 4] ?? 0) + 1;
        slotVotes.ranger.found = true;
      }
      if (atk.mobType === 'meleer' && hasMeleer && !slotVotes.meleer.found) {
        slotVotes.meleer[atk.tick % 4] = (slotVotes.meleer[atk.tick % 4] ?? 0) + 1;
        slotVotes.meleer.found = true;
      }
    }
    delete slotVotes.mager.found;
    delete slotVotes.ranger.found;
    delete slotVotes.meleer.found;
  }
  function getBestSlot(votes: Votes): number {
    let best = -1;
    let bestCount = 0;
    for (let s = 0; s < 4; s++) {
      const c = votes[s] ?? 0;
      if (c > bestCount) {
        bestCount = c;
        best = s;
      }
    }
    return best;
  }
  if (hasMager) {
    const s = getBestSlot(slotVotes.mager);
    if (s >= 0) slots[s] = 'mage';
  }
  if (hasRanger) {
    const s = getBestSlot(slotVotes.ranger);
    if (s >= 0 && !slots[s]) slots[s] = 'range';
  }
  if (hasMeleer) {
    const s = getBestSlot(slotVotes.meleer);
    if (s >= 0 && !slots[s]) slots[s] = 'melee';
  }

  const unknowns: number[] = [];
  for (let i = 0; i < 4; i++) if (!slots[i]) unknowns.push(i);

  let bestSeq: PrayerSequence | null = null;
  let bestDmg = Infinity;
  const combos = 1 << unknowns.length;
  for (let c = 0; c < combos; c++) {
    const seq: (PrayerType | null)[] = [...slots];
    for (let i = 0; i < unknowns.length; i++) {
      seq[unknowns[i]!] = (c >> i) & 1 ? 'range' : 'mage';
    }
    const finalSeq = seq.map((s) => s ?? 'mage') as PrayerType[];
    let totalDmg = 0;
    for (const result of allSimResults) {
      totalDmg += calcSimDamageOrig(result.attacks, finalSeq as PrayerSequence, loadout, result.mobInitHP).damage;
    }
    const avgDmg = totalDmg / allSimResults.length;
    if (avgDmg < bestDmg) {
      bestDmg = avgDmg;
      bestSeq = finalSeq as PrayerSequence;
    }
  }
  return { sequence: bestSeq ?? (['mage', 'range', 'mage', 'range'] as PrayerSequence), avgDamage: bestDmg };
}
