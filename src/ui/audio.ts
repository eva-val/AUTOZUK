let audioCtx: AudioContext | null = null;

function ensureAudio(): AudioContext {
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

export function playExclusionBlip(): void {
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
