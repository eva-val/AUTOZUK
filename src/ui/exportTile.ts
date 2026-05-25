import { byId } from './dom';
import { state } from './state';

export function exportTilemarker(): void {
  const pos = state.playerPlacement;
  const statusEl = byId('exportStatus');
  if (!pos) {
    statusEl.textContent = 'No tile selected';
    return;
  }
  // RuneLite tilemarker mapping: regionX = gameX + 16, regionY = 47 - gameY
  const regionX = pos.x + 16;
  const regionY = 47 - pos.y;
  const marker = [{ regionId: 9043, regionX, regionY, z: 0, color: '#FF51B4BA', label: 'Start' }];
  const json = JSON.stringify(marker);
  const success = () => {
    statusEl.textContent = 'Copied to clipboard!';
    statusEl.style.color = 'var(--accent)';
    setTimeout(() => {
      statusEl.textContent = '';
      statusEl.style.color = '';
    }, 2000);
  };
  navigator.clipboard
    .writeText(json)
    .then(success)
    .catch(() => {
      // execCommand fallback
      const ta = document.createElement('textarea');
      ta.value = json;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      success();
    });
}
