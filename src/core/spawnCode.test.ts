import { describe, expect, it } from 'vitest';
import { isSpawnCodeError, parseSpawnCode } from './spawnCode';

describe('parseSpawnCode', () => {
  it('parses single-letter codes at sequential spawn locations', () => {
    const p = parseSpawnCode('MRX');
    if (isSpawnCodeError(p)) throw new Error('expected ok');
    expect(p.spawns.map((s) => s.type)).toEqual(['mager', 'ranger', 'meleer']);
    expect(p.hasIndexInfo).toBe(false);
    expect(p.spawns[0]!.x).toBe(2);
    expect(p.spawns[0]!.y).toBe(6);
  });

  it('skips "nothing" entries with O', () => {
    const p = parseSpawnCode('MOR');
    if (isSpawnCodeError(p)) throw new Error('expected ok');
    expect(p.spawns.map((s) => s.type)).toEqual(['mager', 'nothing', 'ranger']);
  });

  it('parses inferno-scouter index digits', () => {
    const p = parseSpawnCode('M3R1X2');
    if (isSpawnCodeError(p)) throw new Error('expected ok');
    expect(p.hasIndexInfo).toBe(true);
    expect(p.spawns.find((s) => s.type === 'mager')!.infNum).toBe(3);
    expect(p.spawns.find((s) => s.type === 'ranger')!.infNum).toBe(1);
    expect(p.spawns.find((s) => s.type === 'meleer')!.infNum).toBe(2);
  });

  it('assigns implied indices in descending order to unmarked mobs', () => {
    // M takes 1 explicitly. R and X get remaining: {2,3} assigned highest-first → R=3, X=2.
    const p = parseSpawnCode('M1RX');
    if (isSpawnCodeError(p)) throw new Error('expected ok');
    expect(p.spawns.find((s) => s.type === 'ranger')!.infNum).toBe(3);
    expect(p.spawns.find((s) => s.type === 'meleer')!.infNum).toBe(2);
  });

  it('errors on unknown character', () => {
    const p = parseSpawnCode('MQ');
    expect(isSpawnCodeError(p)).toBe(true);
  });

  it('errors on empty input', () => {
    expect(isSpawnCodeError(parseSpawnCode(''))).toBe(true);
    expect(isSpawnCodeError(parseSpawnCode('   '))).toBe(true);
  });
});
