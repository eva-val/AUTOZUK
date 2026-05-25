import { PRAYER_IMG_DATA } from '../data/prayerIcons';
import type { PrayerType } from '../types';
import { byId } from './dom';
import { getActivePrayerSeq } from './state';

const PRAYER_COLORS: Record<PrayerType, string> = {
  mage: '#4488ff',
  range: '#44cc44',
  melee: '#888',
};

export function updatePrayerStrip(): void {
  const strip = byId('prayerStrip');
  const seq = getActivePrayerSeq();
  if (!seq) {
    strip.style.display = 'none';
    return;
  }
  strip.style.display = 'flex';
  const displayOrder = [1, 2, 3, 0] as const;
  const labels = ['START', 'T1', 'T2', 'T3'] as const;
  let html = '';
  for (let i = 0; i < 4; i++) {
    const p = seq[displayOrder[i]!]!;
    html +=
      `<div style="display:flex;flex-direction:column;align-items:center;gap:1px">` +
      `<img src="${PRAYER_IMG_DATA[p]}" style="width:20px;height:20px;image-rendering:pixelated">` +
      `<span style="font-size:7px;font-weight:700;color:${PRAYER_COLORS[p]};letter-spacing:0.5px">${labels[i]}</span>` +
      `</div>`;
  }
  strip.innerHTML = html;
}
