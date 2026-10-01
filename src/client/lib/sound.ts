// Sonido sintetizado con Web Audio: sin archivos que descargar por el wifi de la casa.
// El juego funciona igual sin sonido. Desactivado por defecto.
export type SoundName = 'tick' | 'mission' | 'danger' | 'coins' | 'reveal' | 'victory' | 'tap';

const KEY = 'casa-rural:sound';
let ctx: AudioContext | null = null;
let ambient: { stop: () => void } | null = null;
const listeners = new Set<(on: boolean) => void>();

export const soundEnabled = (): boolean => localStorage.getItem(KEY) === 'on';

export function setSoundEnabled(on: boolean): void {
  localStorage.setItem(KEY, on ? 'on' : 'off');
  if (on) {
    audio();
    startAmbient();
    play('tap');
  } else stopAmbient();
  listeners.forEach((l) => l(on));
}

export function onSoundChange(l: (on: boolean) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function audio(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, opts: { type?: OscillatorType; gain?: number; slideTo?: number } = {}) {
  const a = audio();
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, a.currentTime + start);
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, a.currentTime + start + dur);
  g.gain.setValueAtTime(0.0001, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.18, a.currentTime + start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  osc.connect(g).connect(a.destination);
  osc.start(a.currentTime + start);
  osc.stop(a.currentTime + start + dur + 0.05);
}

export function play(name: SoundName): void {
  if (!soundEnabled()) return;
  switch (name) {
    case 'tick':
      tone(1250, 0, 0.06, { type: 'square', gain: 0.05 });
      break;
    case 'tap':
      tone(520, 0, 0.08, { type: 'triangle', gain: 0.08 });
      break;
    case 'mission':
      tone(660, 0, 0.18, { type: 'triangle' });
      tone(990, 0.12, 0.3, { type: 'triangle' });
      break;
    case 'coins':
      [1320, 1760, 2093].forEach((f, i) => tone(f, i * 0.07, 0.16, { type: 'triangle', gain: 0.1 }));
      break;
    case 'danger':
      tone(180, 0, 0.5, { type: 'sawtooth', gain: 0.1, slideTo: 90 });
      tone(185, 0.02, 0.5, { type: 'sawtooth', gain: 0.07, slideTo: 92 });
      break;
    case 'reveal':
      [392, 494, 587, 740].forEach((f, i) => tone(f, i * 0.11, 0.5, { gain: 0.09 }));
      break;
    case 'victory':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.45, { type: 'triangle', gain: 0.12 }));
      break;
  }
}

/** Ambiente: zumbido grave de casa vieja + viento filtrado. Muy bajo. */
function startAmbient(): void {
  if (ambient || !soundEnabled()) return;
  const a = audio();
  const master = a.createGain();
  master.gain.value = 0.035;
  master.connect(a.destination);

  const drone = a.createOscillator();
  drone.type = 'sine';
  drone.frequency.value = 55;
  const drone2 = a.createOscillator();
  drone2.type = 'sine';
  drone2.frequency.value = 82.4;
  drone.connect(master);
  drone2.connect(master);

  const buffer = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = a.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 400;
  filter.Q.value = 0.6;
  const lfo = a.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = a.createGain();
  lfoGain.gain.value = 250;
  lfo.connect(lfoGain).connect(filter.frequency);
  noise.connect(filter).connect(master);

  [drone, drone2, noise, lfo].forEach((n) => n.start());
  ambient = { stop: () => [drone, drone2, noise, lfo].forEach((n) => n.stop()) };
}

function stopAmbient(): void {
  ambient?.stop();
  ambient = null;
}

/** Los navegadores exigen un gesto del usuario antes de sonar. */
export function resumeOnGesture(): void {
  const handler = () => {
    if (soundEnabled()) startAmbient();
    window.removeEventListener('pointerdown', handler);
  };
  window.addEventListener('pointerdown', handler);
}

export function vibrate(pattern: number | number[]): void {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}
