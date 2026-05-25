import { SPAWN_LOCATIONS } from '../data/arena';
import type { MobType, ParsedSpawn, ParsedSpawnCode, SpawnCodeError } from '../types';

const CHAR_TO_TYPE: Record<string, MobType | 'nothing'> = {
  M: 'mager',
  R: 'ranger',
  X: 'meleer',
  B: 'blob',
  Y: 'bat',
  O: 'nothing',
};

export function parseSpawnCode(code: string): ParsedSpawnCode | SpawnCodeError {
  code = code.trim().toUpperCase();
  if (!code) return { error: 'Enter a spawn code' };
  const spawns: ParsedSpawn[] = [];
  let i = 0;
  let pos = 0;
  while (i < code.length && pos < 9) {
    const ch = code[i]!;
    const type = CHAR_TO_TYPE[ch];
    if (!type) return { error: `Unknown '${ch}' at pos ${i + 1}` };
    i++;
    // Check for optional infernoscouter index digit after mob char
    let infNum = 0;
    if (i < code.length) {
      const next = code[i]!;
      if (next >= '1' && next <= '9') {
        infNum = parseInt(next, 10);
        i++;
      }
    }
    const loc = SPAWN_LOCATIONS[pos]!;
    spawns.push({ type, x: loc.x, y: loc.y, infNum });
    pos++;
  }
  // Assign implied infernoscouter number to mob(s) without one
  const nonNothing = spawns.filter((s) => s.type !== 'nothing');
  const hasExplicit = nonNothing.some((s) => s.infNum > 0);
  if (hasExplicit) {
    const usedNums = new Set(nonNothing.filter((s) => s.infNum > 0).map((s) => s.infNum));
    const remaining: number[] = [];
    for (let n = 1; n <= nonNothing.length; n++) {
      if (!usedNums.has(n)) remaining.push(n);
    }
    remaining.sort((a, b) => b - a); // assign highest remaining first
    let ri = 0;
    for (const s of nonNothing) {
      if (s.infNum === 0 && ri < remaining.length) s.infNum = remaining[ri++]!;
    }
  }
  return { spawns, hasIndexInfo: hasExplicit };
}

export function isSpawnCodeError(parsed: ParsedSpawnCode | SpawnCodeError): parsed is SpawnCodeError {
  return (parsed as SpawnCodeError).error !== undefined;
}
