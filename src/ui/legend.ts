import { byId, maybeById } from './dom';

const LEGEND_CONTENT_HTML = `
  <div class="legend-item"><div class="legend-swatch" style="background:var(--mager-color)">M</div>Mager</div>
  <div class="legend-item"><div class="legend-swatch" style="background:var(--ranger-color)">R</div>Ranger</div>
  <div class="legend-item"><div class="legend-swatch" style="background:var(--meleer-color);border:1px solid #888">X</div>Meleer</div>
  <div class="legend-item"><div class="legend-swatch" style="background:var(--blob-color)">B</div>Blob</div>
  <div class="legend-item"><div class="legend-swatch" style="background:var(--bat-color)">Y</div>Bat</div>
  <div class="legend-item"><div class="legend-swatch" style="background:var(--nibbler-color)">N</div>Nibbler</div>
  <div class="legend-item"><div class="legend-swatch" style="background:var(--bloblet-mage)">a</div>Bloblet-M</div>
  <div class="legend-item"><div class="legend-swatch" style="background:var(--bloblet-range)">b</div>Bloblet-R</div>
  <div class="legend-item"><div class="legend-swatch" style="background:var(--bloblet-melee)">c</div>Bloblet-X</div>
  <div class="legend-item"><div class="legend-swatch" style="background:var(--player-color)">P</div>Player</div>`;

function toggleLegend(): void {
  const popup = byId('legendPopup');
  const btn = byId('legendBtn');
  if (btn.style.display !== 'none') {
    btn.style.display = 'none';
    const content = document.createElement('div');
    content.className = 'legend-content';
    content.id = 'legendContent';
    content.onclick = toggleLegend;
    content.innerHTML = LEGEND_CONTENT_HTML;
    popup.appendChild(content);
  } else {
    btn.style.display = '';
    const content = maybeById('legendContent');
    if (content) content.remove();
  }
}

export function wireLegend(): void {
  byId('legendBtn').addEventListener('click', toggleLegend);
}
