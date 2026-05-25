import { MOB_DEFS, MOB_TYPE_PRIORITY } from '../data/mobs';
import { PRAYER_IMG_DATA } from '../data/prayerIcons';
import type { GridMobColumn } from '../types';
import { byId } from './dom';
import { isDarkColor } from './heatmap';
import { getActivePrayerSeq, state } from './state';

export function sortMobColumns(): void {
  state.gridMobColumns.sort((a, b) => {
    const pa = MOB_TYPE_PRIORITY[a.type] ?? 99;
    const pb = MOB_TYPE_PRIORITY[b.type] ?? 99;
    return pa !== pb ? pa - pb : a.id - b.id;
  });
}

export function rebuildTickGridHeader(): void {
  let html = '<tr><th class="tick-col">T</th>';
  for (const col of state.gridMobColumns) {
    const tc = isDarkColor(col.color) ? '#fff' : '#000';
    html += `<th class="mob-col"><span class="mob-col-badge" style="background:${col.color};color:${tc}">${col.letter}</span></th>`;
  }
  html += '</tr>';
  byId('tickGridHead').innerHTML = html;
  byId('tickGridBody').innerHTML = '';
}

export function addGridMobColumn(col: GridMobColumn): void {
  if (!state.gridMobColumns.find((c) => c.id === col.id)) {
    state.gridMobColumns.push(col);
    sortMobColumns();
    rebuildTickGridHeader();
  }
}

export function updateTickGrid(): void {
  if (!state.sim) return;
  const currentTick = state.sim.tick;
  const tbody = byId<HTMLTableSectionElement>('tickGridBody');
  let hitCount = 0;
  for (const t in state.tickHits) hitCount += state.tickHits[+t]!.length;
  byId('tickGridCount').textContent = `${hitCount} hits`;
  const existingRows = tbody.rows.length;
  const startT = existingRows;
  const praySeq = getActivePrayerSeq();
  for (let t = startT; t <= currentTick; t++) {
    const tr = document.createElement('tr');
    const tdTick = document.createElement('td');
    tdTick.className = 'tick-col';
    if (praySeq) {
      const pray = praySeq[t % 4]!;
      const src = PRAYER_IMG_DATA[pray];
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.style.cssText = 'width:12px;height:12px;vertical-align:middle;margin-right:2px;image-rendering:pixelated';
        tdTick.appendChild(img);
      }
    }
    tdTick.appendChild(document.createTextNode(String(t)));
    tr.appendChild(tdTick);
    for (const col of state.gridMobColumns) {
      const td = document.createElement('td');
      const hits = (state.tickHits[t] ?? []).filter((h) => h.mobId === col.id);
      for (const h of hits) {
        const block = document.createElement('span');
        block.className = `hit-block${h.isScan ? ' scan' : ''}`;
        block.style.background = h.color;
        if (!h.isScan && h.style && praySeq) {
          const pray = praySeq[t % 4]!;
          const blocked =
            (h.style === 'magic' && pray === 'mage') ||
            (h.style === 'range' && pray === 'range') ||
            (h.style === 'melee' && pray === 'melee');
          if (!blocked) {
            block.style.background = '#ff2222';
            block.style.boxShadow = '0 0 3px #ff0000';
            block.title = `OFF PRAYER: ${h.style} vs protect ${pray}`;
          }
        }
        td.appendChild(block);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  if (currentTick >= 0 && tbody.rows[currentTick]) tbody.rows[currentTick]!.classList.add('current-tick');
  const wrapper = byId('tickGridWrapper');
  if (!state.tickGridUserScrolled) wrapper.scrollTop = wrapper.scrollHeight;
}

export function updateEventList(): void {
  const container = byId('eventListBody');
  const events = state.tickEvents.filter((e) => e.isHit || e.isScan || e.isPlayerAttack || e.isResurrect);
  byId('eventCount').textContent = `${events.length} events`;
  if (events.length === 0) {
    container.innerHTML =
      '<div style="padding:8px;text-align:center;color:var(--text-dim);font-size:10px">No events yet</div>';
    return;
  }
  let html = '';
  for (const e of events) {
    let bc = String(e.type);
    if (bc === 'blobletMage') bc = 'bloblet-mage';
    if (bc === 'blobletRange') bc = 'bloblet-range';
    if (bc === 'blobletMelee') bc = 'bloblet-melee';
    if (bc === 'player-atk') bc = 'player-atk';
    const letter = e.type in MOB_DEFS ? MOB_DEFS[e.type as keyof typeof MOB_DEFS].letter : 'P';
    html +=
      `<div class="tick-entry${e.isScan ? ' scan' : ''}">` +
      `<span class="tick-num">T${e.tick}</span>` +
      `<span class="tick-badge ${bc}">${letter}</span>` +
      `<span class="tick-detail">${e.detail}</span>` +
      `</div>`;
  }
  container.innerHTML = html;
  if (!state.eventListUserScrolled) container.scrollTop = container.scrollHeight;
}

export function wireRightPanel(): void {
  byId('tickGridWrapper').addEventListener('scroll', function (this: HTMLElement) {
    state.tickGridUserScrolled = this.scrollHeight - this.scrollTop - this.clientHeight > 30;
  });
  byId('eventListBody').addEventListener('scroll', function (this: HTMLElement) {
    state.eventListUserScrolled = this.scrollHeight - this.scrollTop - this.clientHeight > 30;
  });
  // Resize handle for event list section
  const handle = byId('resizeHandle');
  const section = byId('eventlistSection');
  let dragging = false;
  let startY = 0;
  let startH = 0;
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    dragging = true;
    startY = e.clientY;
    startH = section.offsetHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!dragging) return;
    section.style.height = `${Math.max(80, Math.min(500, startH + startY - e.clientY))}px`;
  });
  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}
