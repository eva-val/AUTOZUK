import { resolveMonsterAttackStats } from '../core/projectiles';
import { isSpawnCodeError, parseSpawnCode } from '../core/spawnCode';
import type {
  AttackEvent,
  AttackStyle,
  DamageResult,
  Loadout,
  MobType,
  ParsedSpawnCode,
  PillarConfig,
  PrayerSequence,
  PrayerSolution,
  PrayerType,
  SimResult,
} from '../types';

const isStyleBlocked = (style: AttackStyle | null, pray: PrayerType): boolean => {
  if (style === 'magic' && pray === 'mage') return true;
  if (style === 'range' && pray === 'range') return true;
  if (style === 'melee' && pray === 'melee') return true;
  return false;
};

// Discriminated kinds for PreparedAttack records. Numeric tags are cheaper to branch on
// than string tags in the inner combo loop.
enum AKind {
  RegularNonBlob = 0,
  RegularBlob = 1,
  Player = 2,
  Revive = 3,
  Scan = 4, // ignored at apply time
}

interface PrepNonBlob {
  kind: AKind.RegularNonBlob;
  tick: number;
  tickMod4: number;
  hitTick: number;
  mobId: number;
  atkStyle: AttackStyle; // 'magic' | 'range' | 'melee'
  hit: boolean;
  dmg: number;
  recoilTick: number;
  ringDmg: number;
  echoEligible: boolean;
}

interface PrepBlob {
  kind: AKind.RegularBlob;
  tick: number;
  tickMod4: number;
  scanTickMod4: number;
  hitTick: number;
  mobId: number;
  // For each candidate style derived from prayOnScan:
  //   prayOnScan === 'mage'  → atkStyle 'range'
  //   prayOnScan != 'mage'   → atkStyle 'magic'
  hitMag: boolean;
  dmgMag: number;
  ringDmgMag: number;
  hitRng: boolean;
  dmgRng: number;
  ringDmgRng: number;
  recoilTick: number;
  echoEligible: boolean;
}

interface PrepPlayer {
  kind: AKind.Player;
  playerDmg: number;
  targetMobId: number | undefined;
  hitTick: number;
}

interface PrepRevive {
  kind: AKind.Revive;
  mobId: number;
  reviveHp: number;
}

interface PrepScan {
  kind: AKind.Scan;
}

type Prepared = PrepNonBlob | PrepBlob | PrepPlayer | PrepRevive | PrepScan;

export interface PreparedSim {
  events: Prepared[];
  // Flat HP / dead arrays sized to maxMobId+1 for cache-friendly inner loop.
  maxIdPlus1: number;
  initialMobHP: Int32Array;
  hasRecoil: boolean;
}

// Resolve atkStats per (mobType, style) lazily once per prepare call.
function getStats(
  loadout: Loadout,
  cache: Map<number, { acc: number; maxPlus1: number } | null>,
  mobType: MobType,
  style: AttackStyle
): { acc: number; maxPlus1: number } | null {
  // Pack key: mobType as small int (string hash via Map key would alloc) — just use string.
  // Keep an object cache keyed by `${mobType}|${style}` to avoid the resolveMonsterAttackStats
  // shape-dispatch on every call.
  const k = mobTypeStyleKey(mobType, style);
  const cached = cache.get(k);
  if (cached !== undefined) return cached;
  const stats = resolveMonsterAttackStats(loadout, mobType, style);
  const out = stats ? { acc: stats.acc, maxPlus1: stats.max + 1 } : null;
  cache.set(k, out);
  return out;
}

// Pack (mobType, style) into a small integer. The set of mob types and styles is fixed
// and tiny; an inline switch is simpler than a string concat.
function mobTypeStyleKey(mobType: MobType, style: AttackStyle): number {
  let m: number;
  switch (mobType) {
    case 'mager':
      m = 0;
      break;
    case 'ranger':
      m = 1;
      break;
    case 'meleer':
      m = 2;
      break;
    case 'blob':
      m = 3;
      break;
    case 'bat':
      m = 4;
      break;
    case 'nibbler':
      m = 5;
      break;
    case 'blobletMage':
      m = 6;
      break;
    case 'blobletRange':
      m = 7;
      break;
    case 'blobletMelee':
      m = 8;
      break;
  }
  let s: number;
  switch (style) {
    case 'magic':
      s = 0;
      break;
    case 'range':
      s = 1;
      break;
    case 'melee':
      s = 2;
      break;
    case 'blob':
      s = 3;
      break;
  }
  return (m << 2) | s;
}

export function prepareSimDamage(
  attacks: AttackEvent[],
  loadout: Loadout,
  mobInitHP: Record<number, { hp: number; type: MobType }>
): PreparedSim {
  const hasRecoil = loadout.hasRecoil === true && mobInitHP !== undefined;
  let maxId = -1;
  for (const id in mobInitHP) {
    const v = +id;
    if (v > maxId) maxId = v;
  }
  // Also bound by max id appearing in attacks (bloblets spawned mid-sim show up there).
  for (const a of attacks) {
    if (a.mobId > maxId) maxId = a.mobId;
    if (a.targetMobId !== undefined && a.targetMobId > maxId) maxId = a.targetMobId;
  }
  const maxIdPlus1 = maxId + 1;
  const initialMobHP = new Int32Array(maxIdPlus1);
  if (hasRecoil) {
    // Sentinel: -1 indicates the id was never seen in mobInitHP (e.g. an id that only
    // appears as a target via revive). The hot loop checks against >= 0 before applying.
    initialMobHP.fill(-1);
    for (const id in mobInitHP) initialMobHP[+id] = mobInitHP[+id]!.hp;
  }

  const statsCache = new Map<number, { acc: number; maxPlus1: number } | null>();
  const events: Prepared[] = new Array(attacks.length);
  for (let i = 0; i < attacks.length; i++) {
    const atk = attacks[i]!;
    if (atk.isPlayerAttack) {
      events[i] = {
        kind: AKind.Player,
        playerDmg: atk.playerDmg ?? 0,
        targetMobId: atk.targetMobId,
        hitTick: atk.hitTick ?? atk.tick,
      };
      continue;
    }
    if (atk.isRevive) {
      events[i] = {
        kind: AKind.Revive,
        mobId: atk.mobId,
        reviveHp:
          atk.reviveHp !== undefined
            ? atk.reviveHp
            : mobInitHP[atk.mobId]
              ? Math.floor(mobInitHP[atk.mobId]!.hp / 2)
              : 0,
      };
      continue;
    }
    if (atk.isScan) {
      events[i] = { kind: AKind.Scan };
      continue;
    }
    // Regular mob attack.
    const tickMod4 = atk.tick & 3;
    const dist = atk.distAtFire ?? 99;
    const echoEligible = dist <= 1;
    const recoilTick = (atk.hitTick !== undefined ? atk.hitTick : atk.tick + 1) + 1;
    if (atk.style !== null) {
      // Fixed style — fully precompute hit and damage.
      const stats = getStats(loadout, statsCache, atk.mobType, atk.style);
      let hit = false;
      let dmg = 0;
      if (stats) {
        hit = atk.accRoll < stats.acc;
        if (hit) dmg = Math.floor(atk.dmgRoll * stats.maxPlus1);
      }
      const ringDmg = dmg > 0 ? Math.floor(dmg * 0.1 + 1) : 0;
      events[i] = {
        kind: AKind.RegularNonBlob,
        tick: atk.tick,
        tickMod4,
        hitTick: atk.hitTick ?? atk.tick,
        mobId: atk.mobId,
        atkStyle: atk.style,
        hit,
        dmg,
        recoilTick,
        ringDmg,
        echoEligible,
      };
    } else {
      // Blob attack — atkStyle depends on prayer at scanTick & 3.
      const scanTickMod4 = atk.scanTick & 3;
      const magStats = getStats(loadout, statsCache, atk.mobType, 'magic');
      const rngStats = getStats(loadout, statsCache, atk.mobType, 'range');
      let hitMag = false;
      let dmgMag = 0;
      if (magStats) {
        hitMag = atk.accRoll < magStats.acc;
        if (hitMag) dmgMag = Math.floor(atk.dmgRoll * magStats.maxPlus1);
      }
      let hitRng = false;
      let dmgRng = 0;
      if (rngStats) {
        hitRng = atk.accRoll < rngStats.acc;
        if (hitRng) dmgRng = Math.floor(atk.dmgRoll * rngStats.maxPlus1);
      }
      events[i] = {
        kind: AKind.RegularBlob,
        tick: atk.tick,
        tickMod4,
        scanTickMod4,
        hitTick: atk.hitTick ?? atk.tick,
        mobId: atk.mobId,
        hitMag,
        dmgMag,
        ringDmgMag: dmgMag > 0 ? Math.floor(dmgMag * 0.1 + 1) : 0,
        hitRng,
        dmgRng,
        ringDmgRng: dmgRng > 0 ? Math.floor(dmgRng * 0.1 + 1) : 0,
        recoilTick,
        echoEligible,
      };
    }
  }
  return { events, maxIdPlus1, initialMobHP, hasRecoil };
}

// Scratch buffers reused across applyPrayer calls. Sized lazily up to the current sim's
// requirement; this saves all four allocations per combo (typical 16 combos × N sims).
let SC_mobHP: Int32Array = new Int32Array(0);
let SC_deadMobs: Uint8Array = new Uint8Array(0);
// Pending lists as parallel SoA arrays (tick + mobId + damage). We compact in place by
// rewriting indices < writeIdx, then truncating length via a counter.
let SC_playerHitTick: Int32Array = new Int32Array(0);
let SC_playerHitMobId: Int32Array = new Int32Array(0);
let SC_playerHitDmg: Int32Array = new Int32Array(0);
let SC_mobRmTick: Int32Array = new Int32Array(0);
let SC_mobRmMobId: Int32Array = new Int32Array(0);
let SC_recoilTick: Int32Array = new Int32Array(0);
let SC_recoilMobId: Int32Array = new Int32Array(0);
let SC_recoilDmg: Int32Array = new Int32Array(0);

function ensureCap(arr: Int32Array, n: number): Int32Array {
  if (arr.length >= n) return arr;
  let cap = arr.length || 32;
  while (cap < n) cap <<= 1;
  return new Int32Array(cap);
}
function ensureCapU8(arr: Uint8Array, n: number): Uint8Array {
  if (arr.length >= n) return arr;
  let cap = arr.length || 32;
  while (cap < n) cap <<= 1;
  return new Uint8Array(cap);
}

export function applyPrayer(prepared: PreparedSim, prayerSeq: PrayerSequence, loadout: Loadout): DamageResult {
  const events = prepared.events;
  const hasRecoil = prepared.hasRecoil;
  const maxIdPlus1 = prepared.maxIdPlus1;
  const isBloodBarrage = loadout.isBloodBarrage === true;

  let hp = 99;
  const maxHp = 99;
  let minHp = 99;
  let died = false;

  // Mob HP + deadMob flags as flat arrays. Mob IDs are dense from 0..maxId; the -1 sentinel
  // in initialMobHP is defensive for any gaps and is honored at enqueue time via the
  // existence check on `prepared.initialMobHP`.
  if (hasRecoil) {
    SC_mobHP = ensureCap(SC_mobHP, maxIdPlus1);
    SC_deadMobs = ensureCapU8(SC_deadMobs, maxIdPlus1);
    SC_mobHP.set(prepared.initialMobHP);
    SC_deadMobs.fill(0, 0, maxIdPlus1);
  }

  // Pending queues
  let nPH = 0; // pendingPlayerHits length
  let nMR = 0; // pendingMobRemovals length
  let nRC = 0; // pendingRecoil length
  if (hasRecoil) {
    SC_playerHitTick = ensureCap(SC_playerHitTick, 32);
    SC_playerHitMobId = ensureCap(SC_playerHitMobId, 32);
    SC_playerHitDmg = ensureCap(SC_playerHitDmg, 32);
    SC_mobRmTick = ensureCap(SC_mobRmTick, 32);
    SC_mobRmMobId = ensureCap(SC_mobRmMobId, 32);
    SC_recoilTick = ensureCap(SC_recoilTick, 32);
    SC_recoilMobId = ensureCap(SC_recoilMobId, 32);
    SC_recoilDmg = ensureCap(SC_recoilDmg, 32);
  }
  let echoBootsCooldown = 0;

  // Local refs (V8 may optimize property access; aliasing helps the writebacks).
  const mobHP = SC_mobHP;
  const deadMobs = SC_deadMobs;

  // Apply pending deaths whose tick <= currentTick (forward compaction).
  const applyPendingDeaths = (currentTick: number): void => {
    if (nMR === 0) return;
    let w = 0;
    for (let i = 0; i < nMR; i++) {
      if (SC_mobRmTick[i]! <= currentTick) {
        deadMobs[SC_mobRmMobId[i]!] = 1;
      } else {
        SC_mobRmTick[w] = SC_mobRmTick[i]!;
        SC_mobRmMobId[w] = SC_mobRmMobId[i]!;
        w++;
      }
    }
    nMR = w;
  };
  const scheduleMobRemoval = (mobId: number, hitTick: number): void => {
    if (deadMobs[mobId]) return;
    const removeTick = hitTick + 1;
    // Linear scan for an existing entry — typical N is small (single digits).
    for (let i = 0; i < nMR; i++) {
      if (SC_mobRmMobId[i] === mobId) {
        if (SC_mobRmTick[i]! > removeTick) SC_mobRmTick[i] = removeTick;
        return;
      }
    }
    SC_mobRmTick = ensureCap(SC_mobRmTick, nMR + 1);
    SC_mobRmMobId = ensureCap(SC_mobRmMobId, nMR + 1);
    SC_mobRmTick[nMR] = removeTick;
    SC_mobRmMobId[nMR] = mobId;
    nMR++;
  };
  const applyPendingPlayerHits = (currentTick: number): void => {
    if (nPH === 0) return;
    let w = 0;
    for (let i = 0; i < nPH; i++) {
      const t = SC_playerHitTick[i]!;
      const mid = SC_playerHitMobId[i]!;
      const dmg = SC_playerHitDmg[i]!;
      if (t <= currentTick) {
        if (!deadMobs[mid] && mobHP[mid]! > 0) {
          mobHP[mid]! -= dmg;
          if (mobHP[mid]! <= 0) scheduleMobRemoval(mid, t);
        }
      } else {
        SC_playerHitTick[w] = t;
        SC_playerHitMobId[w] = mid;
        SC_playerHitDmg[w] = dmg;
        w++;
      }
    }
    nPH = w;
  };

  for (let ei = 0; ei < events.length; ei++) {
    const e = events[ei]!;

    if (e.kind === AKind.Scan) continue;
    if (e.kind === AKind.Player) {
      if (isBloodBarrage && e.playerDmg > 0 && hp < maxHp) {
        hp = Math.min(maxHp, hp + Math.floor(e.playerDmg * 0.25));
      }
      if (
        hasRecoil &&
        e.targetMobId !== undefined &&
        e.targetMobId < maxIdPlus1 &&
        prepared.initialMobHP[e.targetMobId]! !== -1
      ) {
        SC_playerHitTick = ensureCap(SC_playerHitTick, nPH + 1);
        SC_playerHitMobId = ensureCap(SC_playerHitMobId, nPH + 1);
        SC_playerHitDmg = ensureCap(SC_playerHitDmg, nPH + 1);
        SC_playerHitTick[nPH] = e.hitTick;
        SC_playerHitMobId[nPH] = e.targetMobId;
        SC_playerHitDmg[nPH] = e.playerDmg;
        nPH++;
      }
      continue;
    }
    if (e.kind === AKind.Revive) {
      if (hasRecoil) {
        const mid = e.mobId;
        deadMobs[mid] = 0;
        mobHP[mid] = e.reviveHp;
        // Drop all pending entries for this mob from each queue (in-place compaction).
        let w = 0;
        for (let i = 0; i < nMR; i++) {
          if (SC_mobRmMobId[i] !== mid) {
            SC_mobRmTick[w] = SC_mobRmTick[i]!;
            SC_mobRmMobId[w] = SC_mobRmMobId[i]!;
            w++;
          }
        }
        nMR = w;
        w = 0;
        for (let i = 0; i < nPH; i++) {
          if (SC_playerHitMobId[i] !== mid) {
            SC_playerHitTick[w] = SC_playerHitTick[i]!;
            SC_playerHitMobId[w] = SC_playerHitMobId[i]!;
            SC_playerHitDmg[w] = SC_playerHitDmg[i]!;
            w++;
          }
        }
        nPH = w;
        w = 0;
        for (let i = 0; i < nRC; i++) {
          if (SC_recoilMobId[i] !== mid) {
            SC_recoilTick[w] = SC_recoilTick[i]!;
            SC_recoilMobId[w] = SC_recoilMobId[i]!;
            SC_recoilDmg[w] = SC_recoilDmg[i]!;
            w++;
          }
        }
        nRC = w;
      }
      continue;
    }

    // Regular mob attack (blob or non-blob).
    const tick = e.tick;
    // Drain pending queues up to this tick.
    applyPendingPlayerHits(tick);
    applyPendingDeaths(tick);
    if (hasRecoil && nRC > 0) {
      let w = 0;
      for (let i = 0; i < nRC; i++) {
        const rt = SC_recoilTick[i]!;
        const rm = SC_recoilMobId[i]!;
        const rd = SC_recoilDmg[i]!;
        if (rt <= tick) {
          if (!deadMobs[rm] && mobHP[rm]! > 0) {
            mobHP[rm]! -= rd;
            if (mobHP[rm]! <= 0) scheduleMobRemoval(rm, rt);
          }
        } else {
          SC_recoilTick[w] = rt;
          SC_recoilMobId[w] = rm;
          SC_recoilDmg[w] = rd;
          w++;
        }
      }
      nRC = w;
      applyPendingDeaths(tick);
    }

    if (hasRecoil && deadMobs[e.mobId]) continue;

    const prayOnTick = prayerSeq[e.tickMod4]!;
    let hit = false;
    let dmg = 0;
    let ringDmg = 0;
    if (e.kind === AKind.RegularNonBlob) {
      if (isStyleBlocked(e.atkStyle, prayOnTick)) continue;
      hit = e.hit;
      dmg = e.dmg;
      ringDmg = e.ringDmg;
    } else {
      // Blob.
      const prayOnScan = prayerSeq[e.scanTickMod4]!;
      const atkStyle: AttackStyle = prayOnScan === 'mage' ? 'range' : 'magic';
      if (isStyleBlocked(atkStyle, prayOnTick)) continue;
      if (atkStyle === 'range') {
        hit = e.hitRng;
        dmg = e.dmgRng;
        ringDmg = e.ringDmgRng;
      } else {
        hit = e.hitMag;
        dmg = e.dmgMag;
        ringDmg = e.ringDmgMag;
      }
    }
    if (!hit) continue;
    if (dmg > 0) {
      hp -= dmg;
      if (hp < minHp) minHp = hp;
      if (hasRecoil) {
        const recoilTick = e.recoilTick;
        SC_recoilTick = ensureCap(SC_recoilTick, nRC + 1);
        SC_recoilMobId = ensureCap(SC_recoilMobId, nRC + 1);
        SC_recoilDmg = ensureCap(SC_recoilDmg, nRC + 1);
        SC_recoilTick[nRC] = recoilTick;
        SC_recoilMobId[nRC] = e.mobId;
        SC_recoilDmg[nRC] = ringDmg;
        nRC++;
        if (e.echoEligible && recoilTick >= echoBootsCooldown) {
          SC_recoilTick = ensureCap(SC_recoilTick, nRC + 1);
          SC_recoilMobId = ensureCap(SC_recoilMobId, nRC + 1);
          SC_recoilDmg = ensureCap(SC_recoilDmg, nRC + 1);
          SC_recoilTick[nRC] = recoilTick;
          SC_recoilMobId[nRC] = e.mobId;
          SC_recoilDmg[nRC] = 1;
          nRC++;
          echoBootsCooldown = recoilTick + 4;
        }
      }
    }
    if (hp <= 0) {
      died = true;
      break;
    }
  }

  if (hasRecoil && !died) {
    // Drain remaining player hits and recoil; mirrors the original `applyPendingPlayerHits(Infinity)`
    // sweep, then the unconditional recoil application.
    for (let i = 0; i < nPH; i++) {
      const mid = SC_playerHitMobId[i]!;
      if (!deadMobs[mid] && mobHP[mid]! > 0) {
        mobHP[mid]! -= SC_playerHitDmg[i]!;
        if (mobHP[mid]! <= 0) scheduleMobRemoval(mid, SC_playerHitTick[i]!);
      }
    }
    nPH = 0;
    for (let i = 0; i < nRC; i++) {
      const rm = SC_recoilMobId[i]!;
      if (!deadMobs[rm] && mobHP[rm]! > 0) {
        mobHP[rm]! -= SC_recoilDmg[i]!;
        if (mobHP[rm]! <= 0) scheduleMobRemoval(rm, SC_recoilTick[i]!);
      }
    }
    nRC = 0;
  }

  return {
    damage: died ? 99 : isBloodBarrage ? Math.max(0, 99 - minHp) : Math.max(0, 99 - hp),
    died,
  };
}

// Public wrapper preserving the original API.
export function calcSimDamage(
  attacks: AttackEvent[],
  prayerSeq: PrayerSequence,
  loadout: Loadout,
  mobInitHP: Record<number, { hp: number; type: MobType }>
): DamageResult {
  const prepared = prepareSimDamage(attacks, loadout, mobInitHP);
  return applyPrayer(prepared, prayerSeq, loadout);
}

const DEFAULT_PRAYER_SEQ: PrayerSequence = ['mage', 'range', 'mage', 'range'];

export function optimizePrayer(
  allSimResults: SimResult[],
  spawnCode: string,
  _pillarConfig: PillarConfig,
  loadout: Loadout,
  parsedSpawn?: ParsedSpawnCode
): PrayerSolution {
  const parsed = parsedSpawn ?? parseSpawnCode(spawnCode);
  const mobTypes = new Set<MobType>();
  if (!isSpawnCodeError(parsed)) {
    for (const s of parsed.spawns) if (s.type !== 'nothing') mobTypes.add(s.type);
  }
  const hasMager = mobTypes.has('mager');
  const hasRanger = mobTypes.has('ranger');
  const hasMeleer = mobTypes.has('meleer');

  const slots: (PrayerType | null)[] = [null, null, null, null];
  const slotVotesMager: Record<number, number> = {};
  const slotVotesRanger: Record<number, number> = {};
  const slotVotesMeleer: Record<number, number> = {};
  const wantMager = hasMager;
  const wantRanger = hasRanger;
  const wantMeleer = hasMeleer;
  for (const result of allSimResults) {
    let foundMager = false;
    let foundRanger = false;
    let foundMeleer = false;
    for (const atk of result.attacks) {
      if (atk.isScan) continue;
      if (!foundMager && wantMager && atk.mobType === 'mager') {
        slotVotesMager[atk.tick & 3] = (slotVotesMager[atk.tick & 3] ?? 0) + 1;
        foundMager = true;
      } else if (!foundRanger && wantRanger && atk.mobType === 'ranger') {
        slotVotesRanger[atk.tick & 3] = (slotVotesRanger[atk.tick & 3] ?? 0) + 1;
        foundRanger = true;
      } else if (!foundMeleer && wantMeleer && atk.mobType === 'meleer') {
        slotVotesMeleer[atk.tick & 3] = (slotVotesMeleer[atk.tick & 3] ?? 0) + 1;
        foundMeleer = true;
      }
      if ((!wantMager || foundMager) && (!wantRanger || foundRanger) && (!wantMeleer || foundMeleer)) break;
    }
  }
  function getBestSlot(votes: Record<number, number>): number {
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
    const s = getBestSlot(slotVotesMager);
    if (s >= 0) slots[s] = 'mage';
  }
  if (hasRanger) {
    const s = getBestSlot(slotVotesRanger);
    if (s >= 0 && !slots[s]) slots[s] = 'range';
  }
  if (hasMeleer) {
    const s = getBestSlot(slotVotesMeleer);
    if (s >= 0 && !slots[s]) slots[s] = 'melee';
  }

  const unknowns: number[] = [];
  for (let i = 0; i < 4; i++) if (!slots[i]) unknowns.push(i);

  // Pre-prepare each sim once so the combo loop only pays applyPrayer cost.
  const preparedSims: PreparedSim[] = new Array(allSimResults.length);
  for (let i = 0; i < allSimResults.length; i++) {
    preparedSims[i] = prepareSimDamage(allSimResults[i]!.attacks, loadout, allSimResults[i]!.mobInitHP);
  }

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
    for (let i = 0; i < preparedSims.length; i++) {
      totalDmg += applyPrayer(preparedSims[i]!, finalSeq as PrayerSequence, loadout).damage;
    }
    const avgDmg = totalDmg / preparedSims.length;
    if (avgDmg < bestDmg) {
      bestDmg = avgDmg;
      bestSeq = finalSeq as PrayerSequence;
    }
  }
  return { sequence: bestSeq ?? DEFAULT_PRAYER_SEQ, avgDamage: bestDmg };
}
