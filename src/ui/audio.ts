/** Tiny procedural sound effects — no audio files needed. */
let ac: AudioContext | null = null;

export function initAudioOnGesture() {
  const init = () => {
    if (!ac) {
      try { ac = new AudioContext(); } catch { /* no audio */ }
    }
    ac?.resume();
  };
  window.addEventListener('pointerdown', init, { once: false });
  window.addEventListener('keydown', init, { once: false });
}

/** Wood crack: short filtered noise burst with a pitch drop. */
export function playCrack(intensity = 1) {
  if (!ac || ac.state !== 'running') return;
  const dur = 0.18;
  const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 9);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1800, ac.currentTime);
  filter.frequency.exponentialRampToValueAtTime(300, ac.currentTime + dur);
  filter.Q.value = 0.8;
  const gain = ac.createGain();
  gain.gain.value = Math.min(0.5, 0.25 * intensity);
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start();
}

/** Heavy thud for bricks landing. */
export function playThud() {
  if (!ac || ac.state !== 'running') return;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(90, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(40, ac.currentTime + 0.15);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.3, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.16);
  osc.connect(gain).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + 0.18);
}
