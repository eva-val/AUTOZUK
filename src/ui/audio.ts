let audioCtx: AudioContext | null = null;

function ensureAudio(): AudioContext {
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

// Per-blip-kind min gap. When AUTOZUK runs fast, hundreds of blips per second would
// stack into noise; dropping calls within MIN_GAP_MS keeps audio crisp and audible
// without queuing or summarisation.
const MIN_GAP_MS = 50;
let lastExclusionAt = 0;
let lastScoreAt = 0;

export function playExclusionBlip(): void {
  const now = performance.now();
  if (now - lastExclusionAt < MIN_GAP_MS) return;
  lastExclusionAt = now;
  const ac = ensureAudio();
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = 'square';
  osc.frequency.setValueAtTime(1800, t);
  osc.frequency.exponentialRampToValueAtTime(800, t + 0.03);
  gain.gain.setValueAtTime(0.04, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  osc.start(t);
  osc.stop(t + 0.04);
}

export function playScoreBlip(avgDmg: number): void {
  const now = performance.now();
  if (now - lastScoreAt < MIN_GAP_MS) return;
  lastScoreAt = now;
  const ac = ensureAudio();
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  // Score 0 = 880Hz (high), score 100+ = 440Hz (low), linear in between
  const clamped = Math.max(0, Math.min(100, avgDmg));
  let freq = 880 - clamped * 4.4;
  // Perfect tile (rounds to 0): +25% pitch boost
  if (Math.round(avgDmg) === 0) freq = 880 * 1.25;
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.08, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.start(t);
  osc.stop(t + 0.08);
}
