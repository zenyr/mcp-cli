export type Pulse = { at: number; frequency: number; decay: number; gain: number; soft?: boolean };
export type SoundRecipe = { duration: number; peak: number; pulses: Pulse[] };
const rate = 48_000;
const modalRatios = [1, 1.67, 2.43, 3.36, 4.23];
const glassWeights = [1, 0.42, 0.24, 0.14, 0.08];
const softWeights = [1, 0.21, 0.09, 0.035, 0.012];
export const synthesize = (sound: SoundRecipe) => {
  const frames = Math.ceil(sound.duration * rate);
  const pcm = new Float64Array(frames);
  let maximum = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / rate;
    let value = 0;
    for (const pulse of sound.pulses) {
      const elapsed = time - pulse.at;
      if (elapsed < 0) continue;
      const weights = pulse.soft ? softWeights : glassWeights;
      const attack = 1 - Math.exp(-elapsed / (pulse.soft ? 0.0008 : 0.00035));
      for (const [index, ratio] of modalRatios.entries()) {
        const weight = weights[index] ?? 0;
        const decay = pulse.decay / (1 + index * 0.25);
        value +=
          pulse.gain *
          weight *
          attack *
          Math.exp(-elapsed / decay) *
          Math.sin(2 * Math.PI * pulse.frequency * ratio * elapsed);
      }
    }
    const ending = Math.min(1, Math.max(0, (frames - 1 - frame) / (rate * 0.003)));
    pcm[frame] = value * ending;
    maximum = Math.max(maximum, Math.abs(pcm[frame] ?? 0));
  }
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const value = maximum ? ((pcm[frame] ?? 0) * sound.peak) / maximum : 0;
    wav.writeInt16LE(Math.round(value * 32767), 44 + frame * 2);
  }
  return wav;
};
