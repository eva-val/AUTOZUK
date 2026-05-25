import './styles.css';
import { resizeCanvas } from './ui/canvas';
import { updatePreview, wireControls } from './ui/controls';
import { wireLegend } from './ui/legend';
import { render } from './ui/render';
import { wireRightPanel } from './ui/rightPanel';

function bootstrap(): void {
  wireControls();
  wireRightPanel();
  wireLegend();
  resizeCanvas(render);
  window.addEventListener('resize', () => resizeCanvas(render));
  updatePreview();
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
