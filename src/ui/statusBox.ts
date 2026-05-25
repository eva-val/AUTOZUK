import type { PrayerType } from '../types';
import { byId } from './dom';
import { isDarkColor } from './heatmap';
import { getActivePrayerSeq, state } from './state';

const PRAYER_NAMES: Record<PrayerType, string> = { mage: 'Mage', range: 'Range', melee: 'Melee' };

export function updateStatusBox(): void {
  const playerStatus = byId('playerStatus');
  const mobInfo = byId('mobInfo');
  if (!state.sim) {
    playerStatus.innerHTML = 'No simulation loaded';
    mobInfo.innerHTML = 'No mobs alive';
    return;
  }
  const p = state.sim.player;
  const isDead = p.hp <= 0;
  const hpColor = isDead ? '#ff4444' : p.hp > 66 ? '#00ff00' : p.hp > 33 ? '#ffff00' : '#ff4444';
  const hpText = isDead ? `☠ / ${p.maxHp}` : `${p.hp}/${p.maxHp}`;
  let prayInfo = '';
  const seq = getActivePrayerSeq();
  if (seq) {
    const pray = seq[state.sim.tick % 4]!;
    prayInfo = ` | Prayer: ${PRAYER_NAMES[pray]}`;
  }
  playerStatus.innerHTML =
    `<div class="mob-info-row">` +
    `<span class="name" style="color:#bb88ff">P Player</span>` +
    `<span class="hp" style="color:${hpColor}">${hpText}</span>` +
    `<span class="pos">(${p.x},${p.y})${prayInfo}</span>` +
    `</div>`;
  let html = '';
  const alive = state.sim.mobs.filter((m) => !m.dead && m.dying <= 0);
  for (const m of alive) {
    const nameColor = isDarkColor(m.color) ? '#aaa' : m.color;
    html +=
      `<div class="mob-info-row">` +
      `<span class="name" style="color:${nameColor}">${m.letter} #${m.id}</span>` +
      `<span class="hp">${m.hp}/${m.maxHp}</span>` +
      `<span class="pos">(${m.x},${m.y})</span>` +
      `</div>`;
  }
  mobInfo.innerHTML = html || 'No mobs alive';
}
