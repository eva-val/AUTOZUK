import { distToMob } from '../core/geometry';
import { markMobForProjectileRemoval, moveMobStep, processCorpseExpiry } from '../core/mob';
import { resolveMonsterAttackStats } from '../core/projectiles';
import { MOB_DEFS } from '../data/mobs';
import {
  applyAutoRetaliate,
  initSimState,
  mobAttackStep,
  movePlayerStep,
  playerAttackStep,
  processDelayedBlobletSpawns,
  processMobIncomingProjectiles,
  processPendingMobDeaths,
} from '../sim/engine';
import type { AttackEvent, AttackStyle, MobType, PrayerSequence, PrayerType, TickLogEvent } from '../types';
import { byId } from './dom';
import { render } from './render';
import { addGridMobColumn, rebuildTickGridHeader, sortMobColumns, updateEventList, updateTickGrid } from './rightPanel';
import { getActivePrayerSeq, state } from './state';
import { updateStatusBox } from './statusBox';

function recordTickHit(
  tick: number,
  mobId: number,
  mobType: MobType,
  style: AttackStyle | null,
  isScan: boolean
): void {
  if (!state.tickHits[tick]) state.tickHits[tick] = [];
  const d = MOB_DEFS[mobType];
  state.tickHits[tick]!.push({
    mobId,
    mobType,
    color: d ? d.color : '#888',
    letter: d ? d.letter : '?',
    style,
    isScan,
  });
  addGridMobColumn({ id: mobId, letter: d ? d.letter : '?', color: d ? d.color : '#888', type: mobType });
}

function pushTickEvent(e: TickLogEvent): void {
  state.tickEvents.push(e);
}

function getPrayerType(seq: PrayerSequence | null, tick: number): PrayerType | undefined {
  return seq ? seq[tick % 4] : undefined;
}

// Live tick: composes engine helpers, then applies mob projectile damage on land using current prayer.
// Also emits TickLogEvent entries for the right-panel event list & tick grid.
export function liveTick(): void {
  const sim = state.sim;
  if (!sim) return;
  sim.tick++;
  const t = sim.tick;
  const region = sim.region;
  const mobs = sim.mobs;
  const player = sim.player;

  processCorpseExpiry(sim, t);
  processPendingMobDeaths(sim, t);
  const newBloblets = processDelayedBlobletSpawns(sim, t);
  for (const bl of newBloblets) {
    addGridMobColumn({ id: bl.id, letter: bl.letter, color: bl.color, type: bl.type });
    if (bl.parentBlobId !== undefined) {
      // Find original blob for the death message
      pushTickEvent({
        tick: t,
        type: 'blob',
        detail: `Bloblets spawn (frozen this tick)`,
        mobId: bl.parentBlobId,
      });
      break; // log once
    }
  }

  // Process recoil queue (Blood Barrage loadout)
  if (player.recoilQueue.length > 0) {
    const rem: typeof player.recoilQueue = [];
    for (const r of player.recoilQueue) {
      if (r.tick <= t) {
        const mob = mobs.find((m) => m.id === r.mobId && !m.dead && m.dying <= 0 && m.pendingRemovalTick === undefined);
        if (mob && mob.dying === -1 && mob.pendingRemovalTick === undefined) {
          mob.hp -= r.damage;
          if (mob.hp <= 0) markMobForProjectileRemoval(mob, t);
          pushTickEvent({
            tick: t,
            type: mob.type,
            detail: `${r.source === 'ring' ? 'Ring of Suffering' : 'Echo Boots'} recoil ${r.damage} → ${mob.type} #${mob.id}`,
            mobId: mob.id,
            isHit: true,
          });
        }
      } else {
        rem.push(r);
      }
    }
    player.recoilQueue = rem;
  }

  // Move mobs
  for (const mob of mobs) {
    if (mob.dead || mob.dying > 0) continue;
    if (mob.stunned > 0) {
      mob.stunned--;
      continue;
    }
    if (mob.frozen > 0) {
      mob.frozen--;
      continue;
    }
    moveMobStep(mob, player, region, mobs, sim.mobGrid);
  }

  // Mob attacks
  const praySeq = getActivePrayerSeq();
  for (const mob of mobs) {
    if (mob.dead || mob.dying > 0 || mob.stunned > 0) continue;
    mob.attackDelay--;
    const outcome = mobAttackStep(mob, sim, t, (tk) => getPrayerType(praySeq, tk));
    if (outcome.kind === 'fire') {
      const ev = outcome.event;
      const style = (ev.style ?? mob.currentStyle ?? 'magic') as AttackStyle;
      recordTickHit(t, ev.mobId, ev.mobType, style, false);
      pushTickEvent({
        tick: t,
        type: ev.mobType,
        detail: `${ev.mobType} attacks (${style}), pray T${t}`,
        mobId: ev.mobId,
        isAttack: true,
        hitTick: ev.hitTick,
      });
    } else if (outcome.kind === 'scan') {
      const ev = outcome.event;
      recordTickHit(t, ev.mobId, 'blob', outcome.style, true);
      pushTickEvent({
        tick: t,
        type: 'blob',
        detail: `Blob SCAN (id:${ev.mobId}) → ${outcome.style}`,
        mobId: ev.mobId,
        isScan: true,
      });
    } else if (outcome.kind === 'revive') {
      pushTickEvent({
        tick: t,
        type: 'mager',
        detail: `Mager resurrected ${outcome.revived.type}!`,
        mobId: mob.id,
        isResurrect: true,
      });
      addGridMobColumn({
        id: outcome.revived.id,
        letter: outcome.revived.letter,
        color: outcome.revived.color,
        type: outcome.revived.type,
      });
    }
  }

  // Player attack projectiles landing on mobs (damage already rolled at fire time)
  processMobIncomingProjectiles(sim, t);

  // Mob projectiles landing on player: apply damage using stored rolls + current prayer
  applyMobProjectilesLanding(t);

  // Player attack
  player.attackDelay--;
  movePlayerStep(sim);
  const result = playerAttackStep(sim, t);
  for (const ev of result.events) {
    if (ev.targetMobType) {
      pushTickEvent({
        tick: t,
        type: 'player-atk',
        detail: `Player → ${ev.targetMobType} #${ev.targetMobId}, ${ev.playerDmg}dmg hits T${ev.hitTick}`,
        mobId: ev.targetMobId,
        isPlayerAttack: true,
      });
    }
  }
}

function applyMobProjectilesLanding(tick: number): void {
  const sim = state.sim;
  if (!sim) return;
  const player = sim.player;
  const loadout = sim.loadout;
  const praySeq = getActivePrayerSeq();
  const incoming = player.incomingProjectiles;
  const rem: typeof incoming = [];
  let anyArrived = false;
  // Match the attack event (stored in sim.attacks at fire tick) so we can use its rolls.
  // The projectile carries fireTick + mobId, so we can find its matching AttackEvent.
  for (const p of incoming) {
    p.delay--;
    if (p.delay > 0) {
      rem.push(p);
      continue;
    }
    anyArrived = true;
    pushTickEvent({
      tick,
      type: p.mobType,
      detail: `${p.style} hit from ${p.mobType} (id:${p.mobId})`,
      mobId: p.mobId,
      isHit: true,
    });
    // Prayer block check
    let blocked = false;
    if (praySeq) {
      const prayTick = p.fireTick ?? tick;
      const pray = praySeq[prayTick % 4]!;
      if (p.style === 'magic' && pray === 'mage') blocked = true;
      if (p.style === 'range' && pray === 'range') blocked = true;
      if (p.style === 'melee' && pray === 'melee') blocked = true;
    }
    if (blocked) continue;
    // Find the matching attack event for stored rolls
    const event = findFiredEvent(sim.attacks, p.mobId, p.fireTick);
    if (!event) continue;
    const stats = resolveMonsterAttackStats(loadout, p.mobType, p.style);
    if (!stats) continue;
    if (event.accRoll < stats.acc) {
      const dmg = Math.floor(event.dmgRoll * (stats.max + 1));
      if (dmg > 0) {
        player.hp -= dmg;
        if (loadout.hasRecoil) {
          const attackerMob = sim.mobs.find(
            (m) => m.id === p.mobId && !m.dead && m.dying <= 0 && m.pendingRemovalTick === undefined
          );
          if (attackerMob) {
            const ringDmg = Math.floor(dmg * 0.1 + 1);
            player.recoilQueue.push({ tick: tick + 1, mobId: p.mobId, damage: ringDmg, source: 'ring' });
            const mobDist = distToMob(player.x, player.y, attackerMob);
            if (mobDist <= 1 && tick >= player.echoBootsCooldown) {
              player.recoilQueue.push({ tick: tick + 1, mobId: p.mobId, damage: 1, source: 'echo' });
              player.echoBootsCooldown = tick + 4;
            }
          }
        }
      }
    }
  }
  player.incomingProjectiles = rem;
  if (anyArrived) {
    applyAutoRetaliate(sim, tick, true);
  }
}

function findFiredEvent(attacks: AttackEvent[], mobId: number, fireTick: number | undefined): AttackEvent | null {
  if (fireTick === undefined) return null;
  for (let i = attacks.length - 1; i >= 0; i--) {
    const a = attacks[i]!;
    if (a.tick < fireTick) break;
    if (a.tick === fireTick && a.mobId === mobId && !a.isScan && !a.isPlayerAttack && !a.isRevive) return a;
  }
  return null;
}

// ===== Live-sim control surface =====

export function updateLiveUI(): void {
  if (!state.sim) {
    byId('tickDisplay').innerHTML = '<span>TICK</span><br>—';
    updateStatusBox();
    render();
    return;
  }
  byId('tickDisplay').innerHTML = `<span>TICK</span><br>${state.sim.tick}`;
  updateStatusBox();
  updateTickGrid();
  updateEventList();
  render();
}

export function ensureSim(setStatus: (m: string, type?: 'info' | 'error') => void): 'created' | true | false {
  if (state.sim) return true;
  const code = byId<HTMLInputElement>('spawnCode').value;
  if (!code.trim()) {
    setStatus('Enter a spawn code first', 'error');
    return false;
  }
  if (!state.playerPlacement) {
    setStatus('Click the grid to place the player first', 'error');
    return false;
  }
  const sim = initSimState(code, state.playerPlacement, state.pillars, state.currentLoadout, 'live');
  if (!sim) {
    setStatus('Failed to create sim', 'error');
    return false;
  }
  state.sim = sim;
  // Populate grid mob columns from initial mobs
  state.gridMobColumns = [];
  for (const m of sim.mobs) {
    state.gridMobColumns.push({ id: m.id, letter: m.letter, color: m.color, type: m.type });
  }
  // sortMobColumns called by rebuild
  byId('tickGridBody').innerHTML = '';
  state.tickGridUserScrolled = false;
  state.eventListUserScrolled = false;
  sortMobColumns();
  rebuildTickGridHeader();
  updateLiveUI();
  setStatus(`Sim started! ${sim.mobs.filter((m) => !m.dead).length} mobs spawned on tick 0.`, 'info');
  return 'created';
}

export function stopPlay(): void {
  state.playing = false;
  if (state.playInterval) clearInterval(state.playInterval);
  state.playInterval = null;
  const btn = byId<HTMLButtonElement>('btnPlay');
  btn.textContent = '▶ PLAY';
  btn.classList.add('btn-primary');
  btn.classList.remove('btn-secondary');
}

export function startPlay(setStatus: (m: string, type?: 'info' | 'error') => void): void {
  const speed = parseInt(byId<HTMLInputElement>('speedSlider').value, 10);
  const interval = Math.max(16, Math.floor(1000 / speed));
  state.playInterval = setInterval(() => {
    if (!state.sim) {
      stopPlay();
      return;
    }
    liveTick();
    if (!state.autozukRunning) updateLiveUI();
    if (state.sim.mobs.every((m) => m.dead)) {
      stopPlay();
      setStatus(`All mobs dead at tick ${state.sim.tick}!`, 'info');
    }
  }, interval);
}

export function resetSim(setStatus: (m: string, type?: 'info' | 'error') => void): void {
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
  byId('eventCount').textContent = '0 events';
  byId('eventListBody').innerHTML =
    '<div style="padding:8px;text-align:center;color:var(--text-dim);font-size:10px">Load a wave to see events</div>';
  byId('detailPanel').classList.add('detail-hidden');
  byId('phase1Panel').style.display = '';
  byId('eventlistSection').style.display = '';
  byId('resizeHandle').style.display = '';
  updateLiveUI();
  setStatus(
    state.playerPlacement
      ? `Player at (${state.playerPlacement.x}, ${state.playerPlacement.y}) — ready`
      : 'Enter spawn code and click a tile'
  );
}

export function clearLiveSimState(): void {
  state.sim = null;
  state.tickEvents = [];
  state.tickHits = {};
  state.gridMobColumns = [];
  state.tickGridUserScrolled = false;
  state.eventListUserScrolled = false;
  byId('tickGridHead').innerHTML = '<tr><th class="tick-col">T</th></tr>';
  byId('tickGridBody').innerHTML = '';
  byId('tickGridCount').textContent = '0 hits';
  byId('eventCount').textContent = '0 events';
  byId('eventListBody').innerHTML =
    '<div style="padding:8px;text-align:center;color:var(--text-dim);font-size:10px">Load a wave to see events</div>';
  byId('tickDisplay').innerHTML = '<span>TICK</span><br>—';
}
